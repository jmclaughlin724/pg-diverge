import { describe, expect, it } from "vitest";
import type { MigrationPlan, SchemaModel, SupaschemaConfig } from "../src/core.js";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";

async function model(sql: string, source: string): Promise<SchemaModel> {
  const extracted = await extractObjectsFromSql(sql);
  const errors = extracted.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  return { diagnostics: [], fingerprint: source, objects: extracted.objects, source };
}

async function diff(
  fromSql: string,
  toSql: string,
  config?: Partial<SupaschemaConfig>
): Promise<MigrationPlan> {
  const from = await model(fromSql, "test:from");
  const to = await model(toSql, "test:to");
  return planSchemaDiff(from, to, config ? { config } : {});
}

describe("routine replace compatibility", () => {
  const fromFn = "CREATE FUNCTION app.f(a integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;";

  it("blocks return-type changes that CREATE OR REPLACE cannot apply", async () => {
    const plan = await diff(
      fromFn,
      "CREATE FUNCTION app.f(a integer) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;"
    );

    const operation = plan.operations.find((item) => item.key === "function:app.f(integer)");
    expect(operation?.blocked).toBe(true);
    expect(operation?.destructive).toBe(true);
    expect(
      operation?.diagnostics.some((item) => item.code === "SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED")
    ).toBe(true);
  });

  it("blocks SETOF flips", async () => {
    const plan = await diff(
      fromFn,
      "CREATE FUNCTION app.f(a integer) RETURNS SETOF integer LANGUAGE sql AS $$ SELECT 1 $$;"
    );

    const operation = plan.operations.find((item) => item.key === "function:app.f(integer)");
    expect(operation?.blocked).toBe(true);
  });

  it("blocks OUT parameter renames", async () => {
    const plan = await diff(
      "CREATE FUNCTION app.g(IN a integer, OUT b text) LANGUAGE sql AS $$ SELECT 'x' $$;",
      "CREATE FUNCTION app.g(IN a integer, OUT renamed text) LANGUAGE sql AS $$ SELECT 'x' $$;"
    );

    const operation = plan.operations.find((item) => item.key === "function:app.g(integer)");
    expect(operation?.blocked).toBe(true);
  });

  it("renders guarded drop + create when the change is hinted", async () => {
    const plan = await diff(
      fromFn,
      "CREATE FUNCTION app.f(a integer) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;",
      { hints: { destructive: ["function:app.f(integer)"] } }
    );
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain('DROP FUNCTION IF EXISTS "app"."f"(integer);');
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.f(");
    expect(sql).toContain(") RETURNS text");
  });

  it("keeps body-only changes on the clean OR REPLACE path", async () => {
    const plan = await diff(
      fromFn,
      "CREATE FUNCTION app.f(a integer) RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;"
    );

    const operation = plan.operations.find((item) => item.key === "function:app.f(integer)");
    expect(operation?.blocked).toBe(false);
    expect(operation?.destructive).toBe(false);
  });
});

describe("view replace compatibility", () => {
  const fromView = "CREATE VIEW app.v AS SELECT 1 AS a, 2 AS b;";

  it("treats appended columns as clean OR REPLACE with no warning", async () => {
    const plan = await diff(fromView, "CREATE VIEW app.v AS SELECT 1 AS a, 2 AS b, 3 AS c;");

    const operation = plan.operations.find((item) => item.key === "view:app.v");
    expect(operation?.blocked).toBe(false);
    expect(operation?.diagnostics).toEqual([]);
  });

  it("blocks reordered output columns", async () => {
    const plan = await diff(fromView, "CREATE VIEW app.v AS SELECT 2 AS b, 1 AS a;");

    const operation = plan.operations.find((item) => item.key === "view:app.v");
    expect(operation?.blocked).toBe(true);
    expect(
      operation?.diagnostics.some((item) => item.code === "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE")
    ).toBe(true);
  });

  it("renders guarded drop + create for incompatible views when hinted", async () => {
    const plan = await diff(fromView, "CREATE VIEW app.v AS SELECT 2 AS b;", {
      hints: { destructive: ["view:app.v"] },
    });
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain('DROP VIEW IF EXISTS "app"."v";');
    expect(sql).toContain("CREATE OR REPLACE VIEW app.v AS SELECT 2 AS b;");
  });

  it("keeps the verify-required warning when columns are statically unknowable", async () => {
    const plan = await diff(
      "CREATE TABLE app.rows (id integer);\nCREATE VIEW app.v2 AS SELECT * FROM app.rows;",
      "CREATE TABLE app.rows (id integer);\nCREATE VIEW app.v2 AS SELECT * FROM app.rows WHERE id > 0;"
    );

    const operation = plan.operations.find((item) => item.key === "view:app.v2");
    expect(
      operation?.diagnostics.some((item) => item.code === "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED")
    ).toBe(true);
  });
});
