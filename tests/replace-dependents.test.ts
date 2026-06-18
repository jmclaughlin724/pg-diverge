import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractSourceModel } from "../src/source.js";

const dependents = [
  "ALTER TABLE app.t ADD CONSTRAINT t_value_check CHECK (value > 0);",
  "CREATE INDEX t_value_idx ON app.t (value);",
  "ALTER TABLE app.t ENABLE ROW LEVEL SECURITY;",
  "CREATE POLICY t_read ON app.t FOR SELECT TO authenticated USING (true);",
  "GRANT SELECT ON TABLE app.t TO authenticated;",
  "CREATE VIEW app.t_values AS SELECT id, value FROM app.t;",
  "GRANT SELECT ON TABLE app.t_values TO authenticated;",
  "COMMENT ON TABLE app.t IS 'table comment';",
  "COMMENT ON COLUMN app.t.value IS 'value comment';",
  "COMMENT ON VIEW app.t_values IS 'view comment';",
].join("\n");

async function modelFromSql(sql: string) {
  const root = await mkdtemp(join(tmpdir(), "supa-replace-deps-"));
  await writeFile(join(root, "001.sql"), sql);
  return await extractSourceModel(`dir:${root}`);
}

describe("replaced relation dependents", () => {
  it("re-creates unchanged dependents and comments alongside a hinted table replace", async () => {
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`
    );
    const to = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\n${dependents}\n`
    );

    const plan = planSchemaDiff(from, to, { config: { hints: { destructive: ["table:app.t"] } } });

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const tableReplace = plan.operations.find(
      (operation) => operation.kind === "replace" && operation.ref.kind === "table"
    );
    expect(tableReplace).toBeDefined();
    const injectedKinds = plan.operations
      .filter((operation) => operation.kind === "create")
      .map((operation) => operation.ref.kind);
    expect(injectedKinds).toContain("constraint");
    expect(injectedKinds).toContain("index");
    expect(injectedKinds).toContain("rls");
    expect(injectedKinds).toContain("policy");
    expect(injectedKinds).toContain("grant");
    expect(injectedKinds).toContain("view");
    expect(injectedKinds.filter((kind) => kind === "comment")).toHaveLength(3);

    expect(
      plan.operations.some(
        (operation) =>
          operation.kind === "drop" &&
          operation.ref.kind === "view" &&
          operation.ref.name === "t_values"
      )
    ).toBe(true);

    const sql = renderMigration(plan, { includeHeader: false });
    const dropView = sql.indexOf('DROP VIEW IF EXISTS "app"."t_values";');
    const dropTable = sql.indexOf('DROP TABLE IF EXISTS "app"."t";');
    const createTable = sql.indexOf("CREATE TABLE IF NOT EXISTS app.t");
    const createView = sql.indexOf("CREATE OR REPLACE VIEW app.t_values AS SELECT");
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(dropTable).toBeGreaterThan(dropView);
    expect(createTable).toBeGreaterThan(dropTable);
    expect(createView).toBeGreaterThan(createTable);
    expect(sql).toContain("COMMENT ON TABLE app.t IS 'table comment';");
    expect(sql).toContain("COMMENT ON COLUMN app.t.value IS 'value comment';");
    expect(sql).toContain("COMMENT ON VIEW app.t_values IS 'view comment';");
    expect(sql).toContain("GRANT SELECT ON app.t_values TO authenticated;");
  });

  it("adds no dependent operations when nothing is replaced", async () => {
    const sql = `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`;
    const from = await modelFromSql(sql);
    const to = await modelFromSql(sql);

    const plan = planSchemaDiff(from, to, { config: { destructiveChanges: "allow" } });

    expect(plan.operations).toHaveLength(0);
  });

  it("does not duplicate dependents that already carry their own operation", async () => {
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`
    );
    const to = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\nALTER TABLE app.t ADD CONSTRAINT t_value_check CHECK (value > 1);\nCREATE INDEX t_value_idx ON app.t (value);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\nCREATE POLICY t_read ON app.t FOR SELECT TO authenticated USING (true);\nGRANT SELECT ON TABLE app.t TO authenticated;\n"
    );

    const plan = planSchemaDiff(from, to, { config: { destructiveChanges: "allow" } });

    const constraintOps = plan.operations.filter(
      (operation) => operation.ref.kind === "constraint"
    );
    expect(constraintOps).toHaveLength(1);
    expect(constraintOps[0]?.kind).toBe("replace");
  });

  it("does not pre-drop a dependent view/materialized view that is new in the target", async () => {
    const from = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n"
    );
    const to = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\nCREATE MATERIALIZED VIEW app.m AS SELECT id FROM app.t;\n"
    );

    const plan = planSchemaDiff(from, to, { config: { hints: { destructive: ["table:app.t"] } } });

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(plan.operations.some((operation) => operation.kind === "drop")).toBe(false);
    const matview = plan.operations.find((operation) => operation.ref.kind === "materialized-view");
    expect(matview?.kind).toBe("create");
    expect(matview?.blocked).toBe(false);
  });

  it("drops a dependent view before the materialized view it depends on", async () => {
    const base =
      "CREATE MATERIALIZED VIEW app.m AS SELECT id, value FROM app.t;\nCREATE VIEW app.v AS SELECT id FROM app.m;";
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${base}\n`
    );
    const to = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\n${base}\n`
    );

    const plan = planSchemaDiff(from, to, {
      config: { hints: { destructive: ["table:app.t", "materialized-view:app.m"] } },
    });
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const sql = renderMigration(plan, { includeHeader: false });
    const dropView = sql.indexOf('DROP VIEW IF EXISTS "app"."v";');
    const dropMatview = sql.indexOf('DROP MATERIALIZED VIEW IF EXISTS "app"."m";');
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(dropMatview).toBeGreaterThan(dropView);
  });

  it("orders nested dependent-view pre-drops by dependency, not source order", async () => {
    const views =
      "CREATE VIEW app.v_outer AS SELECT id FROM app.v_inner;\n" +
      "CREATE VIEW app.v_inner AS SELECT id, value FROM app.t;";
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${views}\n`
    );
    const to = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\n${views}\n`
    );

    const plan = planSchemaDiff(from, to, { config: { hints: { destructive: ["table:app.t"] } } });
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const sql = renderMigration(plan, { includeHeader: false });
    const dropOuter = sql.indexOf('DROP VIEW IF EXISTS "app"."v_outer";');
    const dropInner = sql.indexOf('DROP VIEW IF EXISTS "app"."v_inner";');
    const dropTable = sql.indexOf('DROP TABLE IF EXISTS "app"."t";');
    expect(dropOuter).toBeGreaterThanOrEqual(0);
    expect(dropInner).toBeGreaterThan(dropOuter);
    expect(dropTable).toBeGreaterThan(dropInner);

    const createInner = sql.indexOf("CREATE OR REPLACE VIEW app.v_inner AS SELECT");
    const createOuter = sql.indexOf("CREATE OR REPLACE VIEW app.v_outer AS SELECT");
    expect(createInner).toBeGreaterThan(0);
    expect(createOuter).toBeGreaterThan(createInner);
  });
});
