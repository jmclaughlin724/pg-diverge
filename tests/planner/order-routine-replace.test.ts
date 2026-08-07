import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { renderMigration } from "../../src/render/migration.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";
import type { MigrationPlan, SchemaModel, SupaschemaConfig } from "../../src/types.js";

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

describe("routine drop vs relation replace ordering", () => {
  it("drops a removed routine before replacing the relation it depends on", async () => {
    const from = `
      CREATE SCHEMA app;
      CREATE TABLE app.t (id bigint);
      CREATE FUNCTION app.f() RETURNS SETOF app.t LANGUAGE sql AS $$ SELECT * FROM app.t $$;
    `;
    const to = `
      CREATE SCHEMA app;
      CREATE UNLOGGED TABLE app.t (id bigint);
    `;

    const plan = await diff(from, to, {
      hints: { destructive: ["table:app.t", "function:app.f()"] },
      transactionMode: "per-statement",
    });

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = plan.operations.map((operation) => operation.key);
    expect(keys.indexOf("function:app.f()")).toBeLessThan(keys.indexOf("table:app.t"));

    const sql = renderMigration(plan, { includeHeader: false });
    expect(sql.indexOf('DROP FUNCTION IF EXISTS "app"."f"();')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS "app"."t";')
    );
  });

  it("pre-drops an unchanged routine before replacing the relation it depends on", async () => {
    const from = `
      CREATE SCHEMA app;
      CREATE TABLE app.t (id bigint);
      CREATE FUNCTION app.f() RETURNS app.t LANGUAGE sql AS $$ SELECT * FROM app.t LIMIT 1 $$;
    `;
    const to = `
      CREATE SCHEMA app;
      CREATE UNLOGGED TABLE app.t (id bigint);
      CREATE FUNCTION app.f() RETURNS app.t LANGUAGE sql AS $$ SELECT * FROM app.t LIMIT 1 $$;
    `;

    const plan = await diff(from, to, {
      hints: { destructive: ["table:app.t"] },
      transactionMode: "per-statement",
    });

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = plan.operations.map((operation) => operation.key);
    expect(keys.indexOf("pre-drop:function:app.f()")).toBeLessThan(keys.indexOf("table:app.t"));
    expect(keys.indexOf("table:app.t")).toBeLessThan(keys.indexOf("function:app.f()"));

    const sql = renderMigration(plan, { includeHeader: false });
    expect(sql.indexOf('DROP FUNCTION IF EXISTS "app"."f"();')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS "app"."t";')
    );
  });

  it("pre-drops a trigger on another table whose function depends on a replaced relation", async () => {
    const from = `
      CREATE SCHEMA app;
      CREATE TABLE app.t1 (id bigint);
      CREATE TABLE app.t2 (id bigint);
      CREATE FUNCTION app.tf() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM * FROM app.t1 WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg AFTER INSERT ON app.t2 FOR EACH ROW EXECUTE FUNCTION app.tf();
    `;
    const to = `
      CREATE SCHEMA app;
      CREATE UNLOGGED TABLE app.t1 (id bigint);
      CREATE TABLE app.t2 (id bigint);
      CREATE FUNCTION app.tf() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM * FROM app.t1 WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg AFTER INSERT ON app.t2 FOR EACH ROW EXECUTE FUNCTION app.tf();
    `;

    const plan = await diff(from, to, {
      hints: { destructive: ["table:app.t1"] },
      transactionMode: "per-statement",
    });

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = plan.operations.map((operation) => operation.key);
    expect(keys.indexOf("pre-drop:trigger:app.trg:t2")).toBeLessThan(
      keys.indexOf("pre-drop:function:app.tf()")
    );
    expect(keys.indexOf("pre-drop:function:app.tf()")).toBeLessThan(keys.indexOf("table:app.t1"));
    expect(keys.indexOf("table:app.t1")).toBeLessThan(keys.indexOf("function:app.tf()"));
    expect(keys.indexOf("function:app.tf()")).toBeLessThan(keys.indexOf("trigger:app.trg:t2"));

    const sql = renderMigration(plan, { includeHeader: false });
    const dropTrigger = sql.indexOf('DROP TRIGGER IF EXISTS "trg" ON "app"."t2";');
    const dropFunction = sql.indexOf('DROP FUNCTION IF EXISTS "app"."tf"();');
    const dropTable = sql.indexOf('DROP TABLE IF EXISTS "app"."t1";');
    const createFunction = sql.indexOf("CREATE OR REPLACE FUNCTION app.tf()");
    const createTrigger = sql.indexOf("CREATE TRIGGER trg");
    expect(dropTrigger).toBeGreaterThanOrEqual(0);
    expect(dropFunction).toBeGreaterThan(dropTrigger);
    expect(dropTable).toBeGreaterThan(dropFunction);
    expect(createFunction).toBeGreaterThan(dropTable);
    expect(createTrigger).toBeGreaterThan(createFunction);
  });
});
