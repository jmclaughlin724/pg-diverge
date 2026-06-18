import type { Diagnostic, MigrationPlan, ObjectRef, SchemaModel, SchemaObject } from "./core.js";

export interface RuleContext {
  model: SchemaModel;
  plan?: MigrationPlan;
}

export interface Rule {
  check: (context: RuleContext) => Diagnostic[];
  id: string;
}

export interface RulePack {
  id: string;
  rules: Rule[];
  version: string;
}

export function runRulePacks(packs: RulePack[], context: RuleContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pack of packs) {
    for (const rule of pack.rules) {
      diagnostics.push(...rule.check(context));
    }
  }
  return diagnostics;
}

const registry = new Map<string, RulePack>();

export function registerRulePack(pack: RulePack): void {
  registry.set(pack.id, pack);
}

export function getRulePack(id: string): RulePack | undefined {
  return registry.get(id);
}

export function listRulePacks(): RulePack[] {
  return [...registry.values()];
}

function isSnakeCase(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  for (const char of name) {
    const isLower = char >= "a" && char <= "z";
    const isDigit = char >= "0" && char <= "9";
    if (!(isLower || isDigit || char === "_")) {
      return false;
    }
  }
  return true;
}

export const tableNamingRule: Rule = {
  check: ({ model }) => {
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "table" || isSnakeCase(object.ref.name)) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_TABLE_NAMING",
        ...(object.file === undefined ? {} : { file: object.file }),
        hint: "Use lowercase snake_case table names",
        message: `Table "${object.ref.name}" is not snake_case`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "HYG001",
};

export const hygienePack: RulePack = {
  id: "hygiene",
  rules: [tableNamingRule],
  version: "0.1.0",
};

export const migrationSafetyRule: Rule = {
  check: ({ plan }) => {
    if (plan === undefined) {
      return [];
    }
    const diagnostics: Diagnostic[] = [];
    for (const operation of plan.operations) {
      if (!operation.destructive || operation.blocked) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_DESTRUCTIVE_OP",
        hint: "Review for data loss and lock impact before deploy",
        message: `Destructive ${operation.kind} on ${operation.ref.kind} "${operation.ref.name}"`,
        ref: operation.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "LOCK001",
};

export const migrationSafetyPack: RulePack = {
  id: "migration-safety",
  rules: [migrationSafetyRule],
  version: "0.1.0",
};

function tableKey(ref: ObjectRef): string {
  return `${ref.schema ?? "public"}.${ref.table ?? ref.name}`;
}

function isRlsEnabledObject(object: SchemaObject): boolean {
  return (
    object.ref.kind === "rls" &&
    (object.metadata.rlsSubtype === "AT_EnableRowSecurity" ||
      object.metadata.rlsEnabled === true ||
      containsEnableRowLevelSecurity(object.sql))
  );
}

function containsEnableRowLevelSecurity(sql: string): boolean {
  const tokens = splitWhitespace(sql).map((token) => token.toUpperCase());
  for (let index = 0; index <= tokens.length - 4; index += 1) {
    if (
      tokens[index] === "ENABLE" &&
      tokens[index + 1] === "ROW" &&
      tokens[index + 2] === "LEVEL" &&
      tokens[index + 3] === "SECURITY"
    ) {
      return true;
    }
  }
  return false;
}

function splitWhitespace(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function rlsEnabledTableKeys(model: SchemaModel): Set<string> {
  const enabled = new Set<string>();
  for (const object of model.objects) {
    if (isRlsEnabledObject(object)) {
      enabled.add(tableKey(object.ref));
    }
  }
  return enabled;
}

export const rlsEnabledNoPolicyRule: Rule = {
  check: ({ model }) => {
    const policyTables = new Set(
      model.objects
        .filter((object) => object.ref.kind === "policy")
        .map((object) => tableKey(object.ref))
    );
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (!isRlsEnabledObject(object)) {
        continue;
      }
      if (!policyTables.has(tableKey(object.ref))) {
        diagnostics.push({
          code: "SUPA_RULE_RLS_NO_POLICY",
          hint: "RLS with no policy denies all access; add a policy or disable RLS",
          message: `RLS is enabled on "${tableKey(object.ref)}" but no policy exists (deny-all)`,
          ref: object.ref,
          severity: "warning",
        });
      }
    }
    return diagnostics;
  },
  id: "SEC001",
};

export const policyWithoutRlsRule: Rule = {
  check: ({ model }) => {
    const enabled = rlsEnabledTableKeys(model);
    const seen = new Set<string>();
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "policy") {
        continue;
      }
      const key = tableKey(object.ref);
      if (enabled.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      diagnostics.push({
        code: "SUPA_RULE_POLICY_NO_RLS",
        hint: "Policies are inert until ROW LEVEL SECURITY is enabled on the table",
        message: `Policy on "${key}" is inert: ROW LEVEL SECURITY is not enabled on the table`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC002",
};

export const rlsPack: RulePack = {
  id: "rls",
  rules: [rlsEnabledNoPolicyRule, policyWithoutRlsRule],
  version: "0.1.0",
};

function grantTarget(object: SchemaObject): string {
  return typeof object.metadata.target === "string" ? object.metadata.target : object.ref.name;
}

export const grantToPublicRule: Rule = {
  check: ({ model }) => {
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
        continue;
      }
      if (object.metadata.verb !== "GRANT" || object.metadata.grantee !== "PUBLIC") {
        continue;
      }
      const target = grantTarget(object);
      diagnostics.push({
        code: "SUPA_RULE_GRANT_TO_PUBLIC",
        hint: "Grant to specific roles (e.g. authenticated) rather than PUBLIC for least privilege",
        message: `GRANT to PUBLIC on ${target}`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "PRIV001",
};

export const grantAllPrivilegesRule: Rule = {
  check: ({ model }) => {
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "grant" || object.metadata.verb !== "GRANT") {
        continue;
      }
      const privileges = object.metadata.privileges;
      if (!(Array.isArray(privileges) && privileges.includes("ALL"))) {
        continue;
      }
      const target = grantTarget(object);
      diagnostics.push({
        code: "SUPA_RULE_GRANT_ALL_PRIVILEGES",
        hint: "Grant only the privileges needed (SELECT/INSERT/...), not ALL",
        message: `Over-broad grant: ALL privileges on ${target}`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "PRIV002",
};

export function grantPolicyRule(allowedGrantees: string[]): Rule {
  const allowed = new Set(allowedGrantees);
  return {
    check: ({ model }) => {
      if (allowed.size === 0) {
        return [];
      }
      const diagnostics: Diagnostic[] = [];
      for (const object of model.objects) {
        if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
          continue;
        }
        if (object.metadata.verb !== "GRANT") {
          continue;
        }
        const grantee = object.metadata.grantee;
        if (typeof grantee !== "string" || grantee === "PUBLIC" || allowed.has(grantee)) {
          continue;
        }
        diagnostics.push({
          code: "SUPA_RULE_GRANT_UNDECLARED_ROLE",
          hint: "Add the role to hints.allowedGrantees or revoke the grant (least privilege)",
          message: `Grant to undeclared role "${grantee}" on ${grantTarget(object)}`,
          ref: object.ref,
          severity: "warning",
        });
      }
      return diagnostics;
    },
    id: "PRIV003",
  };
}

export const grantPack: RulePack = {
  id: "grants",
  rules: [grantToPublicRule, grantAllPrivilegesRule],
  version: "0.1.0",
};
