import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../src/check-reporters.js";
import type { MigrationOperation, MigrationPlan, SchemaModel, SchemaObject } from "../src/core.js";
import {
  grantAllPrivilegesRule,
  grantToPublicRule,
  hygienePack,
  listRulePacks,
  migrationSafetyRule,
  policyWithoutRlsRule,
  registerRulePack,
  rlsEnabledNoPolicyRule,
  runRulePacks,
  tableNamingRule,
} from "../src/rules.js";

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

  it("round-trips packs through the registry", () => {
    registerRulePack(hygienePack);
    expect(listRulePacks().some((pack) => pack.id === "hygiene")).toBe(true);
  });
});

function operation(destructive: boolean): MigrationOperation {
  return {
    blocked: false,
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

function policyObject(table: string, name: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${table}.${name}`,
    metadata: {},
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
});
