import type { Diagnostic, MigrationPlan, ObjectRef, SchemaModel, SchemaObject } from "./core.js";

/**
 * Rule-engine foundation (plan `.claude/plans/40-rule-engine-foundation.md`, task S0).
 *
 * A rule reads the declarative model (and optionally the migration plan) and
 * returns `Diagnostic[]`. Diagnostics render through the existing reporter
 * (`src/check-reporters.ts`) — packs never fork a second reporter. The engine is
 * AST/model-native by construction: rules receive the parsed `SchemaModel`, not a
 * live catalog, preserving the pre-write, migration-scoped analysis position.
 */

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

/** Run every rule in the given packs and return the flattened diagnostics. */
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

/** Identifier-name format check (a name string, not SQL structure — no parser needed). */
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

/**
 * Seed hygiene rule that proves the engine end-to-end: flag tables whose name is
 * not snake_case. Real packs (RLS, type-contract, grant-drift) are separate tasks
 * (plans 10-12) built on this same interface.
 */
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

/**
 * Migration-safety seed rule (plan `12-free-packs-rls-locks.md`, task F21). Surfaces
 * operations the planner has ALREADY classified as destructive — it reuses the
 * existing `MigrationOperation.destructive` flag rather than re-deriving lock impact,
 * so it adds no false confidence. The transaction-mode-aware lock routing in the
 * plan is the follow-on; this is the plan-scoped seed proving the engine reads the
 * migration plan, not only the model.
 */
export const migrationSafetyRule: Rule = {
  check: ({ plan }) => {
    if (plan === undefined) {
      return [];
    }
    const diagnostics: Diagnostic[] = [];
    for (const operation of plan.operations) {
      if (!operation.destructive) {
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

/**
 * RLS audit pack (plan `12-free-packs-rls-locks.md`, task F20). Grounded in the
 * model's actual RLS representation: `rls` objects carry `metadata.rlsSubtype`
 * (`AT_EnableRowSecurity`) and `ref.table`; `policy` objects carry `ref.table`.
 * These mirror Supabase Splinter's presence/absence checks but run over the AST
 * model inside the migration pipeline — the differentiation is integration, not
 * rule count (pgrls covers breadth on the free tier).
 */
function tableKey(ref: ObjectRef): string {
  return `${ref.schema ?? "public"}.${ref.table ?? ref.name}`;
}

const ENABLE_ROW_LEVEL_SECURITY_SQL = /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i;

function isRlsEnabledObject(object: SchemaObject): boolean {
  return (
    object.ref.kind === "rls" &&
    (object.metadata.rlsSubtype === "AT_EnableRowSecurity" ||
      object.metadata.rlsEnabled === true ||
      ENABLE_ROW_LEVEL_SECURITY_SQL.test(object.sql))
  );
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

/**
 * Grant-drift / least-privilege seed (plan `11-pack-grant-drift-gate.md`, task P11;
 * OPEN white space — Atlas announced a CI grant gate but has not shipped one).
 * Grounded in the grant object's metadata (`verb`, `grantee`). Flags
 * `GRANT ... TO PUBLIC` as an over-broad grant. The declared role-policy model in
 * config is the follow-on; this is the unambiguous, no-false-confidence seed.
 */
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

/**
 * Over-broad privilege grant (task P11; no config needed). The model normalizes a
 * full-privilege grant to `metadata.privileges === ["ALL"]`, so this is a grounded
 * least-privilege check distinct from grant-to-PUBLIC.
 */
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

/**
 * Declared role-policy drift (task P11). Given the grantees a project permits, flag
 * any `GRANT` to a role outside that set. A no-op when no policy is declared (empty
 * set), so it never fires until a project opts in via `hints.allowedGrantees`;
 * PUBLIC and over-broad ALL grants are caught by the dedicated rules above. The
 * allowed set is injected, keeping this a pure rule.
 */
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
