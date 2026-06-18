import { describe, expect, it } from "vitest";
import type { SchemaModel } from "../src/core.js";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";
import { hasUnqualifiedCatalogName } from "./helpers/catalog-qualification.js";

function emptyModel(): SchemaModel {
  return { diagnostics: [], fingerprint: "empty", objects: [], source: "test:empty" };
}

async function renderCreates(
  sql: string,
  config?: { transactionMode?: "per-migration" | "per-statement" }
): Promise<string> {
  const spliceConfig = { normalize: "off", ...config };
  const extracted = await extractObjectsFromSql(sql, { config: spliceConfig });
  const errors = extracted.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  const to: SchemaModel = {
    diagnostics: [],
    fingerprint: "to",
    objects: extracted.objects,
    source: "test:to",
  };
  const plan = planSchemaDiff(emptyModel(), to, { config: spliceConfig });
  return renderMigration(plan, { includeHeader: false });
}

describe("AST-spliced create guards", () => {
  it("splices IF NOT EXISTS after table prefix keywords", async () => {
    const sql = await renderCreates("CREATE UNLOGGED TABLE app.t (id integer);");

    expect(sql).toContain("CREATE UNLOGGED TABLE IF NOT EXISTS app.t (id integer);");
  });

  it("splices IF NOT EXISTS after CONCURRENTLY for per-statement runners", async () => {
    const sql = await renderCreates(
      "CREATE TABLE app.items (id integer);\nCREATE UNIQUE INDEX CONCURRENTLY items_idx ON app.items (id);",
      { transactionMode: "per-statement" }
    );

    expect(sql).toContain("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_idx");
  });

  it("blocks concurrent index creation under per-migration runners", async () => {
    const sql = await renderCreates(
      "CREATE TABLE app.items (id integer);\nCREATE UNIQUE INDEX CONCURRENTLY items_idx ON app.items (id);"
    );

    expect(sql).toContain("SUPA_PLAN_CONCURRENT_INDEX_UNSUPPORTED");
    expect(sql).not.toContain("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_idx");
  });

  it("does not double-guard statements that already carry the guard", async () => {
    const sql = await renderCreates(
      "CREATE TABLE IF NOT EXISTS app.t (id integer);\nCREATE OR REPLACE VIEW app.v AS SELECT 1 AS one;"
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app.t (id integer);");
    expect(sql).not.toContain("IF NOT EXISTS IF NOT EXISTS");
    expect(sql).toContain("CREATE OR REPLACE VIEW app.v AS SELECT 1 AS one;");
    expect(sql).not.toContain("OR REPLACE OR REPLACE");
  });

  it("preserves leading comments while guarding the statement", async () => {
    const sql = await renderCreates("-- owner comment\nCREATE TABLE app.t2 (id integer);");

    expect(sql).toContain("-- owner comment\nCREATE TABLE IF NOT EXISTS app.t2 (id integer);");
  });

  it("guards functions and materialized views from AST facts", async () => {
    const sql = await renderCreates(
      "CREATE FUNCTION app.f() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\nCREATE MATERIALIZED VIEW app.mv AS SELECT 1 AS one;"
    );

    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.f()");
    expect(sql).toContain("CREATE MATERIALIZED VIEW IF NOT EXISTS app.mv");
  });
});

describe("catalog-qualified DO guards", () => {
  it("schema-qualifies enum and constraint guard catalog lookups", async () => {
    const sql = await renderCreates(
      [
        "CREATE TYPE app.mood AS ENUM ('happy', 'sad');",
        "CREATE TABLE app.moods (id integer);",
        "ALTER TABLE app.moods ADD CONSTRAINT moods_id_check CHECK (id >= 0);",
      ].join("\n")
    );

    expect(sql).toContain("pg_catalog.pg_type");
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("pg_catalog.pg_class");
    expect(hasUnqualifiedCatalogName(sql, ["pg_type", "pg_constraint", "pg_namespace"])).toBe(
      false
    );
  });
});
