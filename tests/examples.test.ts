import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../src/check.js";
import { resolveSourceDefaults } from "../src/cli-defaults.js";
import { loadConfig } from "../src/config.js";
import type { Diagnostic } from "../src/core.js";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractSourceModel } from "../src/source.js";

const errorsOf = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((item) => item.severity === "error");

const supabaseExampleFragments = [
  "CREATE TYPE app.account_status AS ENUM ('active', 'suspended');",
  'ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "status" app.account_status DEFAULT',
  "CREATE OR REPLACE VIEW app.account_names AS SELECT",
  "COMMENT ON TABLE app.accounts IS 'Customer accounts';",
];

describe("shipped examples", () => {
  it("runs the Supabase example from config-owned source defaults", async () => {
    const cwd = "examples/supabase";
    const config = await loadConfig(cwd);

    expect(config.schemaPaths).toEqual(["supabase/schemas"]);
    expect(config.migrationsDir).toBe("supabase/migrations");
    expect(config.sources).toEqual({
      from: "dump:baseline.sql",
      to: "dir:supabase/schemas",
    });

    const sources = await resolveSourceDefaults({}, config, async () => undefined);
    expect(sources.from).toBe("dump:baseline.sql");
    expect(sources.to).toBe("dir:supabase/schemas");

    const from = await extractSourceModel(sources.from, { config, cwd });
    const to = await extractSourceModel(sources.to, { config, cwd });
    const plan = planSchemaDiff(from, to, { config });

    expect(errorsOf(plan.diagnostics)).toEqual([]);
    expect(plan.operations.some((operation) => operation.blocked)).toBe(false);

    const sql = renderMigration(plan, { config });
    for (const fragment of supabaseExampleFragments) {
      expect(sql, fragment).toContain(fragment);
    }
    expect(errorsOf(await checkMigrationSql(sql, { config }))).toEqual([]);
  });
});
