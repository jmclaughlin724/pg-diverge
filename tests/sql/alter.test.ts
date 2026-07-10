import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../../src/check/migration.js";
import type { MigrationPlan, SchemaModel, SupaschemaConfig } from "../../src/core.js";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { renderMigration } from "../../src/render/migration.js";
import { normalizeSourceObjects } from "../../src/source/normalize.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";

async function model(sql: string, source: string): Promise<SchemaModel> {
  const extracted = await extractObjectsFromSql(sql);
  const diagnostics = [...extracted.diagnostics];
  const objects = await normalizeSourceObjects(extracted.objects, diagnostics);
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  return { diagnostics: [], fingerprint: source, objects, source };
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

  it("validates a temporary check before setting NOT NULL", async () => {
    const plan = await diff(
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10));",
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL);"
    );
    const sql = renderMigration(plan, { includeHeader: false });
    const diagnostics = await checkMigrationSql(sql);

    expect(sql).toContain(
      'ADD CONSTRAINT "supaschema_not_null_a1cb6ee106ab62fa" CHECK ("label" IS NOT NULL) NOT VALID;'
    );
    expect(sql).toContain('VALIDATE CONSTRAINT "supaschema_not_null_a1cb6ee106ab62fa";');
    expect(sql).toContain('ALTER TABLE "app"."accounts" ALTER COLUMN "label" SET NOT NULL;');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "supaschema_not_null_a1cb6ee106ab62fa";');
    expect(diagnostics.map((item) => item.code)).not.toContain("SUPA_CHECK_SET_NOT_NULL_SCAN");
  });

  it("keeps NOT NULL validation proof column-specific", async () => {
    const diagnostics = await checkMigrationSql(`
      ALTER TABLE app.accounts VALIDATE CONSTRAINT "supaschema_not_null_0fdd384885ecd3c6";
      ALTER TABLE app.accounts ALTER COLUMN "label" SET NOT NULL;
    `);

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_SET_NOT_NULL_SCAN");
  });

  it("renders dropped defaults as DROP DEFAULT", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL, score integer);"
    );
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain('ALTER TABLE "app"."accounts" ALTER COLUMN "score" DROP DEFAULT;');
  });

  it("renders identity additions behind a replay-safe catalog guard", async () => {
    const plan = await diff(
      baseTable,
      "CREATE TABLE app.accounts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label varchar(10) NOT NULL, score integer DEFAULT 0);"
    );

    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.kind).toBe("alter");
    expect(operation?.blocked).toBe(false);
    expect(operation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUPA_PLAN_COLUMN_IDENTITY_REVIEW",
          severity: "warning",
        }),
      ])
    );
    expect(sql).toContain("FROM pg_catalog.pg_attribute a");
    expect(sql).toContain("AND a.attidentity <> ''");
    expect(sql).toContain(
      'ALTER TABLE "app"."accounts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY;'
    );
    expect(sql).not.toContain("DROP TABLE");
  });

  it("replaces generated expression changes instead of rendering PG17-only SET EXPRESSION", async () => {
    const before =
      "CREATE TABLE app.people (id bigint PRIMARY KEY, first_name text, full_name text GENERATED ALWAYS AS (first_name) STORED);";
    const after =
      "CREATE TABLE app.people (id bigint PRIMARY KEY, first_name text, full_name text GENERATED ALWAYS AS (upper(first_name)) STORED);";
    const plan = await diff(before, after, {
      hints: { destructive: ["table:app.people"], renames: [] },
    });

    const operation = plan.operations.find((item) => item.key === "table:app.people");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.kind).toBe("replace");
    expect(operation?.blocked).toBe(false);
    expect(sql).not.toContain("SET EXPRESSION");
    expect(sql).toContain('DROP TABLE IF EXISTS "app"."people";');
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app.people");
  });

  it("renders generated expression drops as ALTER COLUMN DROP EXPRESSION", async () => {
    const before =
      "CREATE TABLE app.people (id bigint PRIMARY KEY, first_name text, full_name text GENERATED ALWAYS AS (upper(first_name)) STORED);";
    const after =
      "CREATE TABLE app.people (id bigint PRIMARY KEY, first_name text, full_name text);";
    const plan = await diff(before, after);
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain(
      'ALTER TABLE "app"."people" ALTER COLUMN "full_name" DROP EXPRESSION IF EXISTS;'
    );
    expect(sql).not.toContain("DROP TABLE");
  });

  it("adds generated columns without blocking", async () => {
    const plan = await diff(
      "CREATE TABLE app.people (id bigint PRIMARY KEY);",
      "CREATE TABLE app.people (id bigint PRIMARY KEY, doubled integer GENERATED ALWAYS AS (id * 2) STORED);"
    );
    const tableOperation = plan.operations.find((item) => item.key === "table:app.people");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(tableOperation?.kind).toBe("alter");
    expect(tableOperation?.blocked).toBe(false);
    expect(sql).toContain(
      'ALTER TABLE "app"."people" ADD COLUMN IF NOT EXISTS "doubled" integer GENERATED ALWAYS AS (id * 2) STORED;'
    );
  });

  it("blocks added columns with hoisted inline validating constraints", async () => {
    const plan = await diff(
      "CREATE TABLE app.people (id bigint PRIMARY KEY);",
      "CREATE TABLE app.people (id bigint PRIMARY KEY, age integer CHECK (age > 0));"
    );
    const tableOperation = plan.operations.find((item) => item.key === "table:app.people");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(tableOperation?.kind).toBe("alter");
    expect(tableOperation?.blocked).toBe(true);
    expect(tableOperation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUPA_PLAN_ADD_COLUMN_UNSAFE",
          severity: "error",
        }),
      ])
    );
    expect(sql).toContain("SUPA_PLAN_ADD_COLUMN_UNSAFE");
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS "age"');
  });

  it("orders routines using added columns after the table alter", async () => {
    const plan = await diff(
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY);",
      `
        CREATE TABLE app.accounts (id bigint PRIMARY KEY, secret_id uuid);
        CREATE FUNCTION app.read_secret()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
        END;
        $$;
      `
    );
    const order = plan.operations.map((operation) => operation.key);

    expect(order.indexOf("table:app.accounts")).toBeLessThan(
      order.indexOf("function:app.read_secret()")
    );
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("blocks destructive column alters when an existing dependent still references the column", async () => {
    const plan = await diff(
      `
        CREATE TABLE app.accounts (id bigint PRIMARY KEY, secret_id uuid);
        CREATE FUNCTION app.read_secret()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
        END;
        $$;
      `,
      `
        CREATE TABLE app.accounts (id bigint PRIMARY KEY);
        CREATE FUNCTION app.read_secret()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
        END;
        $$;
      `,
      hinted
    );
    const operation = plan.operations.find((item) => item.key === "table:app.accounts");

    expect(operation?.blocked).toBe(true);
    expect(operation?.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_COLUMN_DEPENDENT_REWRITE_REQUIRED"
    );
  });

  it("orders dependent routine replacements before destructive column alters", async () => {
    const plan = await diff(
      `
        CREATE TABLE app.accounts (id bigint PRIMARY KEY, secret_id uuid);
        CREATE FUNCTION app.read_secret()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
        END;
        $$;
      `,
      `
        CREATE TABLE app.accounts (id bigint PRIMARY KEY);
        CREATE FUNCTION app.read_secret()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN (SELECT id::uuid FROM app.accounts LIMIT 1);
        END;
        $$;
      `,
      hinted
    );
    const order = plan.operations.map((operation) => operation.key);
    const routine = plan.operations.find((item) => item.key === "function:app.read_secret()");
    const table = plan.operations.find((item) => item.key === "table:app.accounts");

    expect(table?.blocked).toBe(false);
    expect(routine?.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_DEPENDENT_ROUTINE_REORDERED"
    );
    expect(order.indexOf("function:app.read_secret()")).toBeLessThan(
      order.indexOf("table:app.accounts")
    );
  });

  it("pre-drops and recreates dependent views around destructive column type changes", async () => {
    const fromSql = `
      CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL);
      CREATE VIEW app.account_labels AS SELECT id, label FROM app.accounts;
    `;
    const plan = await diff(
      fromSql,
      fromSql.replace("label varchar(10)", "label varchar(20)"),
      hinted
    );
    const operation = plan.operations.find((item) => item.key === "table:app.accounts");
    const sql = renderMigration(plan, { includeHeader: false });
    const dropView = sql.indexOf('DROP VIEW IF EXISTS "app"."account_labels";');
    const alterTable = sql.indexOf(
      'ALTER TABLE "app"."accounts" ALTER COLUMN "label" TYPE character varying(20)'
    );
    const createView = sql.indexOf("CREATE OR REPLACE VIEW app.account_labels AS SELECT");

    expect(operation?.blocked).toBe(false);
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(alterTable).toBeGreaterThan(dropView);
    expect(createView).toBeGreaterThan(alterTable);
  });

  it("orders pre-dropped dependent view replacements after destructive column type changes", async () => {
    const fromSql = `
      CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(10) NOT NULL);
      CREATE VIEW app.account_labels AS SELECT id, label FROM app.accounts;
    `;
    const toSql = `
      CREATE TABLE app.accounts (id bigint PRIMARY KEY, label varchar(20) NOT NULL);
      CREATE VIEW app.account_labels AS SELECT id, label::text AS label FROM app.accounts;
    `;
    const plan = await diff(fromSql, toSql, {
      hints: { destructive: ["table:app.accounts", "view:app.account_labels"], renames: [] },
    });
    const sql = renderMigration(plan, { includeHeader: false });
    const dropView = sql.indexOf('DROP VIEW IF EXISTS "app"."account_labels";');
    const alterTable = sql.indexOf(
      'ALTER TABLE "app"."accounts" ALTER COLUMN "label" TYPE character varying(20)'
    );
    const createView = sql.indexOf("CREATE OR REPLACE VIEW app.account_labels AS SELECT");

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(alterTable).toBeGreaterThan(dropView);
    expect(createView).toBeGreaterThan(alterTable);
  });

  it("pre-drops and recreates partial indexes around destructive column type changes", async () => {
    const fromSql = `
      CREATE TABLE app.jobs (id bigint PRIMARY KEY, status text NOT NULL);
      CREATE INDEX jobs_status_active_idx ON app.jobs (status, id) WHERE status = ANY (ARRAY['pending'::text, 'failed'::text]);
    `;
    const toSql = `
      CREATE TYPE app.job_status AS ENUM ('pending', 'failed');
      CREATE TABLE app.jobs (id bigint PRIMARY KEY, status app.job_status NOT NULL);
      CREATE INDEX jobs_status_active_idx ON app.jobs (status, id) WHERE status = ANY (ARRAY['pending'::app.job_status, 'failed'::app.job_status]);
    `;
    const plan = await diff(fromSql, toSql, {
      hints: { destructive: ["table:app.jobs"], renames: [] },
    });
    const sql = renderMigration(plan, { includeHeader: false });
    const dropIndex = sql.indexOf('DROP INDEX IF EXISTS "app"."jobs_status_active_idx";');
    const alterTable = sql.indexOf(
      'ALTER TABLE "app"."jobs" ALTER COLUMN "status" TYPE app.job_status'
    );
    const createIndex = sql.indexOf("CREATE INDEX IF NOT EXISTS jobs_status_active_idx");

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(alterTable).toBeGreaterThan(dropIndex);
    expect(createIndex).toBeGreaterThan(alterTable);
    expect(sql.slice(dropIndex, alterTable)).not.toContain("CREATE INDEX");
  });

  it("drops and restores defaults around destructive column type changes", async () => {
    const plan = await diff(
      "CREATE TABLE app.jobs (id bigint PRIMARY KEY, status text DEFAULT 'pending'::text NOT NULL);",
      `
        CREATE TYPE app.job_status AS ENUM ('pending', 'failed');
        CREATE TABLE app.jobs (id bigint PRIMARY KEY, status app.job_status DEFAULT 'pending'::app.job_status NOT NULL);
      `,
      { hints: { destructive: ["table:app.jobs"], renames: [] } }
    );
    const sql = renderMigration(plan, { includeHeader: false });
    const dropDefault = sql.indexOf('ALTER TABLE "app"."jobs" ALTER COLUMN "status" DROP DEFAULT;');
    const alterType = sql.indexOf(
      'ALTER TABLE "app"."jobs" ALTER COLUMN "status" TYPE app.job_status'
    );
    const setDefault = sql.indexOf('ALTER TABLE "app"."jobs" ALTER COLUMN "status" SET DEFAULT');

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(dropDefault).toBeGreaterThanOrEqual(0);
    expect(alterType).toBeGreaterThan(dropDefault);
    expect(setDefault).toBeGreaterThan(alterType);
    expect(sql.slice(setDefault)).toContain("app.job_status");
  });

  it("blocks destructive column alters when view, policy, or trigger dependents still reference the column", async () => {
    const fromSql = `
      CREATE TABLE app.accounts (id bigint PRIMARY KEY, secret_id uuid);
      CREATE VIEW app.account_secrets AS SELECT id, secret_id FROM app.accounts;
      ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY accounts_secret ON app.accounts FOR SELECT USING (secret_id IS NOT NULL);
      CREATE FUNCTION app.audit_accounts()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER accounts_secret_touch
      AFTER UPDATE ON app.accounts
      FOR EACH ROW
      WHEN (OLD.secret_id IS DISTINCT FROM NEW.secret_id)
      EXECUTE FUNCTION app.audit_accounts();
    `;
    const plan = await diff(
      fromSql,
      fromSql.replace("id bigint PRIMARY KEY, secret_id uuid", "id bigint PRIMARY KEY"),
      hinted
    );
    const operation = plan.operations.find((item) => item.key === "table:app.accounts");

    expect(operation?.blocked).toBe(true);
    expect(operation?.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_COLUMN_DEPENDENT_REWRITE_REQUIRED"
    );
  });

  it("uses amended generated metadata when adding a column", async () => {
    const plan = await diff(
      "CREATE TABLE app.people (first_name text);",
      "CREATE TABLE app.people (first_name text, full_name text GENERATED ALWAYS AS (first_name) STORED); ALTER TABLE app.people ALTER COLUMN full_name SET EXPRESSION AS (upper(first_name));"
    );
    const sql = renderMigration(plan, { includeHeader: false });

    expect(sql).toContain(
      'ALTER TABLE "app"."people" ADD COLUMN IF NOT EXISTS "full_name" text GENERATED ALWAYS AS (upper(first_name)) STORED;'
    );
    expect(sql).not.toContain("GENERATED ALWAYS AS (first_name) STORED");
  });

  it("renders attached partitions without replacing the partition table", async () => {
    const before = `
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
    `;
    const after = `
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
      ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    `;
    const plan = await diff(before, after);
    const operation = plan.operations.find((item) => item.key === "table:app.events_2026_01");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.kind).toBe("alter");
    expect(operation?.blocked).toBe(false);
    expect(sql).toContain("FROM pg_catalog.pg_inherits i");
    expect(sql).toContain('pg_catalog.to_regclass(\'"app"."events_2026_01"\')');
    expect(sql).toContain('pg_catalog.to_regclass(\'"app"."events"\')');
    expect(sql).toContain(
      "ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');"
    );
    expect(sql).not.toContain("DROP TABLE");
  });

  it("does not hide other table shape changes behind partition attach", async () => {
    const before = `
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
    `;
    const after = `
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE UNLOGGED TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
      ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    `;
    const plan = await diff(before, after, {
      hints: { destructive: ["table:app.events_2026_01"], renames: [] },
    });
    const operation = plan.operations.find((item) => item.key === "table:app.events_2026_01");
    const sql = renderMigration(plan, { includeHeader: false });

    expect(operation?.kind).toBe("replace");
    expect(sql).toContain('DROP TABLE IF EXISTS "app"."events_2026_01";');
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
