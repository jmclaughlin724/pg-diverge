import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../../src/check/report.js";
import { resolveConfig } from "../../src/config/schema.js";
import { runRlsSafetyGate } from "../../src/pipeline/deploy-safety.js";
import {
  exposedTableWithoutRlsRule,
  grantAllPrivilegesRule,
  grantPolicyRule,
  grantToPublicRule,
  hygienePack,
  migrationSafetyRule,
  policyDeprecatedAuthRoleRule,
  policyMissingPredicateRule,
  policyRequiredColumnsRule,
  policyUnwrappedAuthUidRule,
  policyWithoutRlsRule,
  rlsEnabledNoPolicyRule,
  runRulePacks,
  securityDefinerSearchPathRule,
  tableNamingRule,
} from "../../src/scan/rules.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";
import type {
  MigrationOperation,
  MigrationPlan,
  SchemaModel,
  SchemaObject,
} from "../../src/types.js";

function tableObject(name: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${name}`,
    metadata: {},
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "table", name, schema: "public" },
    sql: "",
  };
}

function model(objects: SchemaObject[]): SchemaModel {
  return { diagnostics: [], fingerprint: "f", objects, source: "test" };
}

describe("rule engine (S0)", () => {
  it("flags a non-snake_case table name", () => {
    const diagnostics = runRulePacks([hygienePack], { model: model([tableObject("BadName")]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_TABLE_NAMING");
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("passes a snake_case table name", () => {
    const diagnostics = runRulePacks([hygienePack], { model: model([tableObject("good_name")]) });
    expect(diagnostics).toHaveLength(0);
  });

  it("ignores non-table objects", () => {
    const view: SchemaObject = {
      ...tableObject("BadView"),
      ref: { kind: "view", name: "BadView" },
    };
    const diagnostics = runRulePacks([hygienePack], { model: model([view]) });
    expect(diagnostics).toHaveLength(0);
  });

  it("renders engine diagnostics through the existing reporter", () => {
    const diagnostics = tableNamingRule.check({ model: model([tableObject("BadName")]) });
    const out = renderCheckReport("json", [{ diagnostics, file: "schema.sql" }]);
    expect(out).toContain("SUPA_RULE_TABLE_NAMING");
  });
});

function operation(destructive: boolean, blocked = false): MigrationOperation {
  return {
    blocked,
    destructive,
    diagnostics: [],
    key: "public.users",
    kind: "drop",
    metadata: {},
    ref: { kind: "table", name: "users", schema: "public" },
  };
}

function plan(operations: MigrationOperation[]): MigrationPlan {
  return {
    diagnostics: [],
    fingerprint: "f",
    from: "a",
    fromFingerprint: "fa",
    operations,
    to: "b",
    toFingerprint: "fb",
  };
}

describe("migration-safety rule (F21 seed)", () => {
  it("flags a destructive operation", () => {
    const diagnostics = migrationSafetyRule.check({
      model: model([]),
      plan: plan([operation(true)]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_DESTRUCTIVE_OP");
  });

  it("ignores a non-destructive operation", () => {
    const diagnostics = migrationSafetyRule.check({
      model: model([]),
      plan: plan([operation(false)]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("skips a blocked destructive operation (planner already errors on it)", () => {
    const diagnostics = migrationSafetyRule.check({
      model: model([]),
      plan: plan([operation(true, true)]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("returns nothing without a plan", () => {
    expect(migrationSafetyRule.check({ model: model([]) })).toHaveLength(0);
  });
});

function rlsObject(table: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${table}.rls`,
    metadata: { rlsSubtype: "AT_EnableRowSecurity" },
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "rls", name: table, schema: "public", table },
    sql: "",
  };
}

function catalogRlsObject(table: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${table}.rls`,
    metadata: { rlsEnabled: true, rlsForced: true },
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "rls", name: table, schema: "public", table },
    sql: `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
  };
}

function policyObject(
  table: string,
  name: string,
  metadata: Record<string, unknown> = {}
): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${table}.${name}`,
    metadata,
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "policy", name, schema: "public", table },
    sql: "",
  };
}

describe("RLS audit rules (F20)", () => {
  it("flags RLS enabled with no policy (deny-all)", () => {
    const diagnostics = rlsEnabledNoPolicyRule.check({ model: model([rlsObject("users")]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_RLS_NO_POLICY");
  });

  it("passes when RLS-enabled table has a policy", () => {
    const objects = [rlsObject("users"), policyObject("users", "tenant_isolation")];
    expect(rlsEnabledNoPolicyRule.check({ model: model(objects) })).toHaveLength(0);
  });

  it("flags a policy with RLS not enabled (inert policy)", () => {
    const diagnostics = policyWithoutRlsRule.check({
      model: model([policyObject("orders", "tenant_isolation")]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_POLICY_NO_RLS");
  });

  it("passes when a policy's table has RLS enabled", () => {
    const objects = [rlsObject("orders"), policyObject("orders", "tenant_isolation")];
    expect(policyWithoutRlsRule.check({ model: model(objects) })).toHaveLength(0);
  });

  it("recognizes catalog and merged RLS objects as enabled", () => {
    const objects = [catalogRlsObject("orders"), policyObject("orders", "tenant_isolation")];
    expect(policyWithoutRlsRule.check({ model: model(objects) })).toHaveLength(0);
    expect(
      rlsEnabledNoPolicyRule.check({ model: model([catalogRlsObject("users")]) })
    ).toHaveLength(1);
  });

  it("flags public tables exposed by API-facing grants without RLS", () => {
    const diagnostics = exposedTableWithoutRlsRule.check({
      model: model([tableObject("users"), grantObject("authenticated", "public.users")]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_EXPOSED_TABLE_WITHOUT_RLS");
  });

  it("flags parsed public grants whose rendered target is quoted", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE TABLE public.users (id bigint PRIMARY KEY);
      GRANT SELECT ON TABLE public.users TO authenticated;
    `);

    const diagnostics = exposedTableWithoutRlsRule.check({ model: extracted });

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_RULE_EXPOSED_TABLE_WITHOUT_RLS");
  });

  it("passes exposed public tables when RLS is enabled", () => {
    const diagnostics = exposedTableWithoutRlsRule.check({
      model: model([
        tableObject("users"),
        rlsObject("users"),
        grantObject("authenticated", "public.users"),
      ]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("flags enabled-table SELECT policies without USING predicates", () => {
    const diagnostics = policyMissingPredicateRule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_select", { command: "select" }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_POLICY_MISSING_PREDICATE");
    expect(diagnostics[0]?.message).toContain("USING");
  });

  it("flags enabled-table INSERT policies without WITH CHECK predicates", () => {
    const diagnostics = policyMissingPredicateRule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_insert", { command: "insert" }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("WITH CHECK");
  });

  it("flags UPDATE policies that rely on PostgreSQL's implicit USING write-check fallback", () => {
    const diagnostics = policyMissingPredicateRule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_update", {
          command: "update",
          hasUsingPredicate: true,
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("WITH CHECK");
  });

  it("flags deprecated Supabase auth.role() policy checks", () => {
    const diagnostics = policyDeprecatedAuthRoleRule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_select", {
          command: "select",
          functionCalls: ["auth.role"],
          hasUsingPredicate: true,
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_POLICY_AUTH_ROLE_DEPRECATED");
  });

  it("flags direct auth.uid() calls that are not wrapped in a SELECT initPlan", () => {
    const diagnostics = policyUnwrappedAuthUidRule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_select", {
          command: "select",
          hasUsingPredicate: true,
          unwrappedFunctionCalls: ["auth.uid"],
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_POLICY_AUTH_UID_UNWRAPPED");
  });

  it("flags configured required policy columns missing from the effective predicate", () => {
    const rule = policyRequiredColumnsRule({ "public.accounts": ["tenant_id"] });
    const diagnostics = rule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_select", {
          command: "select",
          hasUsingPredicate: true,
          usingColumns: ["owner_id"],
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_POLICY_MISSING_REQUIRED_COLUMN");
  });

  it("passes configured required policy columns present in a read predicate", () => {
    const rule = policyRequiredColumnsRule({ "public.accounts": ["tenant_id"] });
    const diagnostics = rule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_select", {
          command: "select",
          hasUsingPredicate: true,
          usingColumns: ["tenant_id"],
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("uses INSERT WITH CHECK columns for configured required policy columns", () => {
    const rule = policyRequiredColumnsRule({ "public.accounts": ["tenant_id"] });
    const diagnostics = rule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_insert", {
          checkColumns: ["tenant_id"],
          command: "insert",
          hasCheckPredicate: true,
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("uses UPDATE USING columns as the configured required-column fallback", () => {
    const rule = policyRequiredColumnsRule({ "public.accounts": ["tenant_id"] });
    const diagnostics = rule.check({
      model: model([
        rlsObject("accounts"),
        policyObject("accounts", "accounts_update", {
          command: "update",
          hasUsingPredicate: true,
          usingColumns: ["tenant_id"],
        }),
      ]),
    });

    expect(diagnostics).toHaveLength(0);
  });
});

function grantObject(
  grantee: string,
  target: string,
  privileges: string[] = ["SELECT"]
): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `grant:${target}:${grantee}`,
    metadata: { grantee, privileges, target, verb: "GRANT" },
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "grant", name: `grant:table:${target}:${grantee}` },
    sql: "",
  };
}

function defaultPrivilegeObject(grantee: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `default:tables:${grantee}`,
    metadata: {
      grantee,
      objectType: "TABLES",
      privileges: ["SELECT"],
      schema: "public",
      target: "default privileges on tables in public",
      verb: "GRANT",
    },
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "default-privilege", name: `grant:public:tables:${grantee}`, schema: "public" },
    sql: "",
  };
}

describe("grant least-privilege rule (P11 seed)", () => {
  it("flags GRANT to PUBLIC", () => {
    const diagnostics = grantToPublicRule.check({
      model: model([grantObject("PUBLIC", "public.users")]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_GRANT_TO_PUBLIC");
  });

  it("passes GRANT to a specific role", () => {
    const diagnostics = grantToPublicRule.check({
      model: model([grantObject("authenticated", "public.users")]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("flags default privileges granted to PUBLIC", () => {
    const diagnostics = grantToPublicRule.check({
      model: model([defaultPrivilegeObject("PUBLIC")]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_GRANT_TO_PUBLIC");
  });
});

describe("grant ALL-privileges rule (P11)", () => {
  it("flags a GRANT ALL", () => {
    const diagnostics = grantAllPrivilegesRule.check({
      model: model([grantObject("authenticated", "public.users", ["ALL"])]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_GRANT_ALL_PRIVILEGES");
  });

  it("passes a scoped privilege grant", () => {
    const diagnostics = grantAllPrivilegesRule.check({
      model: model([grantObject("authenticated", "public.users", ["SELECT"])]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("passes a single-privilege kind whose only privilege normalizes to ALL", () => {
    // EXECUTE is the only FUNCTION privilege, so `grant execute on function`
    // normalizes to ALL. Flagging it reports every legitimate function grant as
    // over-broad, which is not a signal about author intent.
    const grant = grantObject("authenticated", "public.f()", ["ALL"]);
    const diagnostics = grantAllPrivilegesRule.check({
      model: model([{ ...grant, metadata: { ...grant.metadata, kindPhrase: "FUNCTION" } }]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags ALL on a kind with multiple grantable privileges", () => {
    const grant = grantObject("authenticated", "public.users", ["ALL"]);
    const diagnostics = grantAllPrivilegesRule.check({
      model: model([{ ...grant, metadata: { ...grant.metadata, kindPhrase: "TABLE" } }]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_GRANT_ALL_PRIVILEGES");
  });
});

describe("grant role-policy drift rule (P11)", () => {
  it("flags a grant to a role outside the declared policy", () => {
    const rule = grantPolicyRule(["authenticated"]);
    const diagnostics = rule.check({ model: model([grantObject("evil_role", "public.users")]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_GRANT_UNDECLARED_ROLE");
  });

  it("passes a grant to a declared role", () => {
    const rule = grantPolicyRule(["authenticated"]);
    const diagnostics = rule.check({
      model: model([grantObject("authenticated", "public.users")]),
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("is a no-op when no policy is declared", () => {
    const rule = grantPolicyRule([]);
    const diagnostics = rule.check({ model: model([grantObject("anyone", "public.users")]) });
    expect(diagnostics).toHaveLength(0);
  });
});

function routineObject(name: string, metadata: Record<string, unknown>): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${name}()`,
    metadata,
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "function", name, schema: "public", signature: "" },
    sql: "",
  };
}

describe("SECURITY DEFINER search_path rule", () => {
  it("flags a SECURITY DEFINER routine with no pinned search_path", () => {
    const diagnostics = securityDefinerSearchPathRule.check({
      model: model([routineObject("escalate", { securityDefiner: true })]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_SECDEF_SEARCH_PATH");
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("flags a SECURITY DEFINER routine whose search_path is not empty", () => {
    // `search_path = public` passes a "does it set one at all" test but still
    // resolves unqualified references through a schema the caller may write to.
    const diagnostics = securityDefinerSearchPathRule.check({
      model: model([
        routineObject("escalate", { routineSearchPath: "public", securityDefiner: true }),
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_SECDEF_SEARCH_PATH");
  });

  it("passes a SECURITY DEFINER routine that pins an empty search_path", () => {
    const diagnostics = securityDefinerSearchPathRule.check({
      model: model([routineObject("safe", { routineSearchPath: "", securityDefiner: true })]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("passes a SECURITY INVOKER routine with no search_path", () => {
    // INVOKER routines run as the caller, so an unpinned search_path grants no
    // privilege the caller did not already have.
    const diagnostics = securityDefinerSearchPathRule.check({
      model: model([routineObject("plain", { securityDefiner: false })]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("ignores objects that are not routines", () => {
    const diagnostics = securityDefinerSearchPathRule.check({
      model: model([tableObject("users")]),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("flags and passes parsed routines end to end", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE OR REPLACE FUNCTION public.unsafe()
      RETURNS int LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT 1 $$;
      CREATE OR REPLACE FUNCTION public.safe()
      RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 1 $$;
    `);

    const diagnostics = securityDefinerSearchPathRule.check({ model: extracted });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_RULE_SECDEF_SEARCH_PATH");
    expect(diagnostics[0]?.ref.name).toBe("unsafe");
  });
});

async function sqlSource(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-rls-gate-"));
  await writeFile(join(root, "001.sql"), sql);
  return `dir:${root}`;
}

describe("RLS deploy gate", () => {
  it("promotes configured RLS findings to errors for deploy_blocking", async () => {
    const source = await sqlSource(`
CREATE TABLE public.users (id bigint PRIMARY KEY);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
`);
    const config = resolveConfig({ workflow: { rls_safety: "deploy_blocking" } });

    const result = await runRlsSafetyGate({ config, source });

    expect(result.blocked).toBe(true);
    expect(result.blockingDiagnostics.map((item) => item.code)).toContain(
      "SUPA_RULE_RLS_NO_POLICY"
    );
    expect(
      result.diagnostics.find((item) => item.code === "SUPA_RULE_RLS_NO_POLICY")?.severity
    ).toBe("error");
  });

  it("keeps configured RLS findings nonblocking for report_only", async () => {
    const source = await sqlSource(`
CREATE TABLE public.users (id bigint PRIMARY KEY);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
`);
    const config = resolveConfig({ workflow: { rls_safety: "report_only" } });

    const result = await runRlsSafetyGate({ config, source });

    expect(result.blocked).toBe(false);
    expect(result.blockingDiagnostics).toHaveLength(0);
    expect(
      result.diagnostics.find((item) => item.code === "SUPA_RULE_RLS_NO_POLICY")?.severity
    ).toBe("warning");
  });

  it("promotes configured required policy-column findings to deploy-blocking errors", async () => {
    const source = await sqlSource(`
CREATE TABLE public.accounts (id bigint PRIMARY KEY, tenant_id uuid, owner_id uuid);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_select ON public.accounts FOR SELECT USING (owner_id = auth.uid());
`);
    const config = resolveConfig({
      hints: { requiredPolicyColumns: { "public.accounts": ["tenant_id"] } },
      workflow: { rls_safety: "deploy_blocking" },
    });

    const result = await runRlsSafetyGate({ config, source });

    expect(result.blocked).toBe(true);
    expect(result.blockingDiagnostics.map((item) => item.code)).toContain(
      "SUPA_RULE_POLICY_MISSING_REQUIRED_COLUMN"
    );
  });
});
