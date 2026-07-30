import { securityDefinerSearchPathIssue } from "../sql/facts.js";
import { isSinglePrivilegeKind } from "../sql/privileges.js";
import type { Diagnostic, MigrationPlan, ObjectRef, SchemaModel, SchemaObject } from "../types.js";

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
  return object.ref.kind === "rls" && object.metadata.rlsEnabled === true;
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

export const policyMissingPredicateRule: Rule = {
  check: ({ model }) => {
    const enabled = rlsEnabledTableKeys(model);
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "policy" || !enabled.has(tableKey(object.ref))) {
        continue;
      }
      const missing = missingPolicyPredicates(object);
      if (missing.length === 0) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_POLICY_MISSING_PREDICATE",
        hint: "Add USING for visible rows and WITH CHECK for inserted or updated rows",
        message: `Policy "${object.ref.name}" on "${tableKey(object.ref)}" is missing ${missing.join(" and ")}`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC003",
};

export const policyDeprecatedAuthRoleRule: Rule = {
  check: ({ model }) => {
    const enabled = rlsEnabledTableKeys(model);
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "policy" || !enabled.has(tableKey(object.ref))) {
        continue;
      }
      if (!metadataStrings(object.metadata.functionCalls).includes("auth.role")) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_POLICY_AUTH_ROLE_DEPRECATED",
        hint: "Use the policy TO clause for anon/authenticated role targeting and keep row authorization in USING/WITH CHECK",
        message: `Policy "${object.ref.name}" on "${tableKey(object.ref)}" uses deprecated auth.role()`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC005",
};

export const policyUnwrappedAuthUidRule: Rule = {
  check: ({ model }) => {
    const enabled = rlsEnabledTableKeys(model);
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "policy" || !enabled.has(tableKey(object.ref))) {
        continue;
      }
      if (!metadataStrings(object.metadata.unwrappedFunctionCalls).includes("auth.uid")) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_POLICY_AUTH_UID_UNWRAPPED",
        hint: "Wrap auth.uid() as (select auth.uid()) in RLS predicates so PostgreSQL can initPlan the helper call",
        message: `Policy "${object.ref.name}" on "${tableKey(object.ref)}" calls auth.uid() directly`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC006",
};

export function policyRequiredColumnsRule(requiredPolicyColumns: Record<string, string[]>): Rule {
  return {
    check: ({ model }) => {
      const enabled = rlsEnabledTableKeys(model);
      const diagnostics: Diagnostic[] = [];
      for (const object of model.objects) {
        if (object.ref.kind !== "policy" || !enabled.has(tableKey(object.ref))) {
          continue;
        }
        const required = requiredPolicyColumns[tableKey(object.ref)] ?? [];
        if (required.length === 0) {
          continue;
        }
        const present = effectivePolicyColumns(object);
        const missing = required.filter((column) => !present.has(column));
        if (missing.length === 0) {
          continue;
        }
        diagnostics.push({
          code: "SUPA_RULE_POLICY_MISSING_REQUIRED_COLUMN",
          hint: `Add ${missing.join(", ")} to the effective RLS predicate or remove it from hints.requiredPolicyColumns for this table`,
          message: `Policy "${object.ref.name}" on "${tableKey(object.ref)}" is missing required column ${missing.join(", ")}`,
          ref: object.ref,
          severity: "warning",
        });
      }
      return diagnostics;
    },
    id: "SEC004",
  };
}

function missingPolicyPredicates(object: SchemaObject): string[] {
  const command = policyCommand(object);
  const hasUsing = object.metadata.hasUsingPredicate === true;
  const hasCheck = object.metadata.hasCheckPredicate === true;
  const missing: string[] = [];
  if (needsUsingPredicate(command) && !hasUsing) {
    missing.push("USING");
  }
  if (needsCheckPredicate(command) && !hasCheck) {
    missing.push("WITH CHECK");
  }
  return missing;
}

function policyCommand(object: SchemaObject): string {
  const command = object.metadata.command;
  if (
    command === "all" ||
    command === "select" ||
    command === "insert" ||
    command === "update" ||
    command === "delete"
  ) {
    return command;
  }
  return "all";
}

function needsUsingPredicate(command: string): boolean {
  return command === "all" || command === "select" || command === "update" || command === "delete";
}

function needsCheckPredicate(command: string): boolean {
  return command === "all" || command === "insert" || command === "update";
}

function usesUsingAsCheck(command: string): boolean {
  return command === "all" || command === "update";
}

function effectivePolicyColumns(object: SchemaObject): Set<string> {
  const command = policyCommand(object);
  const usingColumns = metadataStrings(object.metadata.usingColumns);
  const checkColumns = metadataStrings(object.metadata.checkColumns);
  const columns = new Set<string>();
  if (needsUsingPredicate(command)) {
    for (const column of usingColumns) {
      columns.add(column);
    }
  }
  if (needsCheckPredicate(command)) {
    let source: string[] = [];
    if (checkColumns.length > 0) {
      source = checkColumns;
    } else if (usesUsingAsCheck(command)) {
      source = usingColumns;
    }
    for (const column of source) {
      columns.add(column);
    }
  }
  return columns;
}

function metadataStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export const exposedTableWithoutRlsRule: Rule = {
  check: ({ model }) => {
    const enabled = rlsEnabledTableKeys(model);
    const exposedTargets = exposedTableGrantTargets(model);
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "table" || (object.ref.schema ?? "public") !== "public") {
        continue;
      }
      const key = tableKey(object.ref);
      if (!exposedTargets.has(key) || enabled.has(key)) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_EXPOSED_TABLE_WITHOUT_RLS",
        hint: "Enable RLS with reviewed policies, or revoke API-facing grants before exposing this table.",
        message: `Table "${key}" is exposed by grants without RLS enabled`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC007",
};

function exposedTableGrantTargets(model: SchemaModel): Set<string> {
  const targets = new Set<string>();
  for (const object of model.objects) {
    if (object.ref.kind !== "grant" || object.metadata.verb !== "GRANT") {
      continue;
    }
    const grantee = object.metadata.grantee;
    if (!isApiFacingGrantee(grantee)) {
      continue;
    }
    const target = grantTarget(object);
    if (target.startsWith("public.")) {
      targets.add(target);
    }
  }
  return targets;
}

function isApiFacingGrantee(value: unknown): boolean {
  return (
    value === "PUBLIC" || value === "anon" || value === "authenticated" || value === "service_role"
  );
}

function routineKey(ref: ObjectRef): string {
  return `${ref.schema ?? "public"}.${ref.name}(${ref.signature ?? ""})`;
}

export const securityDefinerSearchPathRule: Rule = {
  check: ({ model }) => {
    const diagnostics: Diagnostic[] = [];
    for (const object of model.objects) {
      if (object.ref.kind !== "function" && object.ref.kind !== "procedure") {
        continue;
      }
      const issue = securityDefinerSearchPathIssue(object.metadata);
      if (!issue) {
        continue;
      }
      diagnostics.push({
        code: "SUPA_RULE_SECDEF_SEARCH_PATH",
        ...(object.file === undefined ? {} : { file: object.file }),
        hint: issue.hint,
        message: `SECURITY DEFINER routine "${routineKey(object.ref)}" ${issue.message}`,
        ref: object.ref,
        severity: "warning",
      });
    }
    return diagnostics;
  },
  id: "SEC008",
};

export const rlsPack: RulePack = {
  id: "rls",
  rules: [
    rlsEnabledNoPolicyRule,
    policyWithoutRlsRule,
    policyMissingPredicateRule,
    policyDeprecatedAuthRoleRule,
    policyUnwrappedAuthUidRule,
    exposedTableWithoutRlsRule,
    securityDefinerSearchPathRule,
  ],
  version: "0.1.0",
};

function grantTarget(object: SchemaObject): string {
  if (typeof object.metadata.targetIdentity === "string") {
    return object.metadata.targetIdentity;
  }
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
      const kindPhrase = object.metadata.kindPhrase;
      if (typeof kindPhrase === "string" && isSinglePrivilegeKind(kindPhrase)) {
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
