import { describe, expect, it } from "vitest";
import type { MigrationPlan, SchemaModel, SupaschemaConfig } from "../src/core.js";
import { planSchemaDiff } from "../src/planner/schema.js";
import { renderMigration } from "../src/render/migration.js";
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

const hinted = { hints: { destructive: ["table:app.accounts"], renames: [] } };

const baseTable =
  "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL, score integer DEFAULT 0);";

describe("column-level alter lane", () => {
  it("blocks column drops without a hint and names the column lane", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL);"
    );

    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    expect(operation?.kind).toBe("alter");
    expect(operation?.blocked).toBe(true);
    expect(
      operation?.diagnostics.some((item) => item.code === "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED")
    ).toBe(true);
  });

  it("renders hinted column drops as guarded DROP COLUMN instead of table replacement", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL);",
      hinted
    );
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain('ALTER TABLE "app"."accounts" DROP COLUMN IF EXISTS "score";');
    expect(sql).not.toContain("DROP TABLE");
  });

  it("renders hinted type changes as ALTER COLUMN TYPE with a USING cast", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(20) NOT NULL, score integer DEFAULT 0);",
      hinted
    );
    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.blocked).toBe(false);
    expect(operation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUPA_PLAN_COLUMN_TYPE_USING_REVIEW",
          severity: "warning",
        }),
      ])
    );
    expect(sql).toContain(
      '-- review: USING is an identity cast ("label"::character varying(20)); replace it for non-assignment-cast conversions'
    );
    expect(sql).toContain(
      'ALTER TABLE "app"."accounts" ALTER COLUMN "label" TYPE character varying(20) USING "label"::character varying(20);'
    );
    expect(sql).not.toContain("DROP TABLE");
  });

  it("renders NOT NULL and default changes without requiring a hint", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10), score integer DEFAULT 5);"
    );
    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.blocked).toBe(false);
    expect(operation?.destructive).toBe(false);
    expect(operation?.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_PLAN_COLUMN_TYPE_USING_REVIEW"
    );
    expect(sql).toContain('ALTER TABLE "app"."accounts" ALTER COLUMN "label" DROP NOT NULL;');
    expect(sql).toContain('ALTER TABLE "app"."accounts" ALTER COLUMN "score" SET DEFAULT 5;');
    expect(sql).not.toContain("-- review: USING is an identity cast");
  });

  it("renders dropped defaults as DROP DEFAULT", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL, score integer);"
    );
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain('ALTER TABLE "app"."accounts" ALTER COLUMN "score" DROP DEFAULT;');
  });

  it("falls back to the destructive replace lane for identity changes", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label varchar(10) NOT NULL, score integer DEFAULT 0);"
    );

    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    expect(operation?.kind).toBe("replace");
    expect(operation?.blocked).toBe(true);
  });

  it("plans added table constraints as constraint creates, not table replaces", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL, score integer DEFAULT 0, CHECK (score >= 0));"
    );

    const tableOperation = plan.operations.find((item) => item.key === "table:app.accounts");
    expect(tableOperation).toBeUndefined();
    const constraintOperation = plan.operations.find(
      (item) => item.key === "constraint:app.accounts_score_check:accounts"
    );
    expect(constraintOperation?.kind).toBe("create");
  });

  it("detects typemod-only changes as real changes", async () => {
    const plan = await diff(
      "CREATE TABLE app.t (label varchar(10));",
      "CREATE TABLE app.t (label varchar(20));",
      { hints: { destructive: ["table:app.t"], renames: [] } }
    );

    const operation = plan.operations.find((item) => item.key === "table:app.t");
    expect(operation?.kind).toBe("alter");
  });
});
