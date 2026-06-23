import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../src/check/migration.js";
import { diagnostic, formatDiagnostics } from "../src/diagnostics.js";
import { planSchemaDiff } from "../src/planner/schema.js";
import { renderMigration } from "../src/render/migration.js";
import { extractSourceModel } from "../src/source/extract.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";
import { parseSqlAst } from "../src/sql/parser.js";
import { splitSqlStatements } from "../src/sql/split.js";

describe("sql splitting", () => {
  it("does not split semicolons inside dollar-quoted function bodies", () => {
    const statements = splitSqlStatements(`
      CREATE FUNCTION app.example()
      RETURNS text
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN 'a;b';
      END;
      $$;
      CREATE TABLE app.items (id bigint);
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("RETURN 'a;b'");
  });

  it("does not split semicolons inside PostgreSQL escape strings", () => {
    const statements = splitSqlStatements(`
      SELECT E'a;b\\';c' AS value;
      SELECT 2;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("E'a;b\\';c' AS value");
    expect(statements[1]).toBe("SELECT 2");
  });

  it("does not split semicolons inside nested block comments", () => {
    const statements = splitSqlStatements(`
      /* outer comment ;
         /* nested comment ; */
         still outer comment ;
      */
      CREATE TABLE app.items (id bigint);
      SELECT 1;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE app.items");
    expect(statements[1]).toBe("SELECT 1");
  });

  it("keeps statement boundaries intact after multi-byte characters", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE SCHEMA app;

CREATE FUNCTION app.with_unicode_comment() RETURNS void
LANGUAGE plpgsql
AS $$
begin
  -- ── 1. unicode séction marker ──
  perform 1;
end;
$$;

CREATE FUNCTION app.after_unicode(p_company_id uuid) RETURNS uuid
LANGUAGE sql STABLE
AS $$
  select p_company_id
$$;
`,
      { file: "unicode.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const names = extracted.objects.map((object) => object.key);
    expect(names).toContain("function:app.with_unicode_comment()");
    expect(names).toContain("function:app.after_unicode(uuid)");
    const after = extracted.objects.find((object) => object.key.includes("after_unicode"));
    expect(after?.sql).toContain("select p_company_id");
  });
});

describe("parse cache", () => {
  it("keeps parsing correctly after crossing the cache cap", async () => {
    const first = await parseSqlAst("SELECT 0;");
    expect(first.diagnostics).toEqual([]);

    for (let index = 1; index <= 2050; index += 1) {
      const parsed = await parseSqlAst(`SELECT ${index};`);
      expect(parsed.diagnostics).toEqual([]);
    }

    const reparsed = await parseSqlAst("SELECT 0;");
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.ast).toBeDefined();
  });
});

describe("diff rendering", () => {
  it("renders deterministic replay-safe SQL for the basic fixture", async () => {
    const from = await extractSourceModel("dir:tests/fixtures/basic/from", {
      cwd: process.cwd(),
    });
    const to = await extractSourceModel("dir:tests/fixtures/basic/to", {
      cwd: process.cwd(),
    });
    const plan = planSchemaDiff(from, to);
    const errors = plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors).toEqual([]);
    const operationLabels = plan.operations.map(
      (operation) => `${operation.kind}:${operation.key}`
    );
    expect(operationLabels[0]).toBe("drop:function:app.legacy_ping()");
    expect(operationLabels).toContain("create:table:app.audit_events");
    expect(operationLabels).toContain("replace:function:app.greeting()");
    expect(operationLabels).toContain("replace:view:app.account_names");
    expect(operationLabels).toContain("replace:policy:app.accounts_select:accounts");
    expect(operationLabels.some((label) => label.startsWith("replace:comment:"))).toBe(true);

    const sql = renderMigration(plan);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app.audit_events");
    expect(sql).toContain('DROP FUNCTION IF EXISTS "app"."legacy_ping"()');
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.greeting()");
    expect(sql).toContain('DROP POLICY IF EXISTS "accounts_select" ON "app"."accounts"');
    const renderedDiagnostics = await checkMigrationSql(sql);
    expect(renderedDiagnostics.map((item) => item.code)).not.toContain("SUPA_CHECK_CASCADE");
  });

  it("blocks destructive relation drops by default", async () => {
    const from = await extractSourceModel("dir:tests/fixtures/basic/to", {
      cwd: process.cwd(),
    });
    const to = await extractSourceModel("dir:tests/fixtures/basic/from", {
      cwd: process.cwd(),
    });
    const plan = planSchemaDiff(from, to);

    expect(
      plan.diagnostics.some((item) => item.code === "SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED")
    ).toBe(true);
  });

  it("orders same-kind dependencies even when source files are reversed", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id bigint PRIMARY KEY);
      CREATE VIEW app.a_dep AS SELECT id FROM app.z_base;
      CREATE VIEW app.z_base AS SELECT id FROM app.accounts;
    `);
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };
    const labels = planSchemaDiff(from, to).operations.map(
      (operation) => `${operation.kind}:${operation.key}`
    );

    expect(labels.indexOf("create:view:app.z_base")).toBeLessThan(
      labels.indexOf("create:view:app.a_dep")
    );
  });

  it("reports dependency cycles instead of guessing an order", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE VIEW app.a AS SELECT id FROM app.b;
      CREATE VIEW app.b AS SELECT id FROM app.a;
    `);
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };
    const plan = planSchemaDiff(from, to);

    expect(plan.diagnostics.map((item) => item.code)).toContain("SUPA_PLAN_DEPENDENCY_CYCLE");
  });

  it("renders safe additive table column changes as guarded alters", async () => {
    const before = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id bigint PRIMARY KEY);
    `);
    const after = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (
        id bigint PRIMARY KEY,
        name text DEFAULT ''::text NOT NULL
      );
    `);
    const plan = planSchemaDiff(
      { diagnostics: before.diagnostics, fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: after.diagnostics, fingerprint: "", objects: after.objects, source: "to" }
    );
    const errors = plan.diagnostics.filter((item) => item.severity === "error");

    expect(errors).toEqual([]);
    expect(plan.operations.map((operation) => operation.kind)).toContain("alter");
    expect(renderMigration(plan)).toContain(
      `ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "name" text DEFAULT ''::text NOT NULL;`
    );
  });

  it("blocks unsafe additive columns that need backfill or constraint review", async () => {
    const before = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id bigint PRIMARY KEY);
    `);
    const after = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (
        id bigint PRIMARY KEY,
        email text NOT NULL
      );
    `);
    const plan = planSchemaDiff(
      { diagnostics: before.diagnostics, fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: after.diagnostics, fingerprint: "", objects: after.objects, source: "to" }
    );

    expect(plan.diagnostics.map((item) => item.code)).toContain("SUPA_PLAN_ADD_COLUMN_UNSAFE");
  });

  it("renders guarded renames only from explicit hints", async () => {
    const before = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id bigint PRIMARY KEY);
    `);
    const after = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.customers (id bigint PRIMARY KEY);
    `);
    const plan = planSchemaDiff(
      {
        diagnostics: before.diagnostics,
        fingerprint: "",
        objects: before.objects,
        source: "from",
      },
      {
        diagnostics: after.diagnostics,
        fingerprint: "",
        objects: after.objects,
        source: "to",
      },
      {
        config: {
          hints: {
            renames: [{ from: "table:app.accounts", to: "table:app.customers" }],
          },
        },
      }
    );
    const sql = renderMigration(plan);

    expect(plan.operations.map((operation) => operation.kind)).toContain("rename");
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(sql).toContain('ALTER TABLE "app"."accounts" RENAME TO "customers";');
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS app.customers");
  });
});

describe("migration checks", () => {
  it("redacts common secrets from diagnostics", () => {
    const formatted = formatDiagnostics([
      diagnostic("SUPA_TEST", "error", "failed postgresql://postgres:super-secret@localhost/db", {
        hint: "service_role_key=eyJabc.def.ghi token='sb_secret_123456'",
        statement: "select 'password=plain-text'",
      }),
    ]);

    expect(formatted).toContain("postgresql://postgres:[redacted]@localhost/db");
    expect(formatted).not.toContain("super-secret");
    expect(formatted).not.toContain("sb_secret_123456");
    expect(formatted).not.toContain("eyJabc.def.ghi");
    expect(formatted).not.toContain("plain-text");
  });

  it("rejects unsafe cascade and search_path usage", async () => {
    const diagnostics = await checkMigrationSql(`
      SET search_path = app, public;
      DROP TABLE app.accounts CASCADE;
    `);

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_CASCADE");
    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_DROP_IF_EXISTS");
    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_SEARCH_PATH");
  });

  it("rejects unguarded create statements that are not replay-safe", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.unguarded (id bigint);
      CREATE VIEW app.v AS SELECT 1 AS id;
      CREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
      CREATE TYPE app.mood AS ENUM ('ok');
      ALTER TABLE app.unguarded ADD CONSTRAINT unguarded_id_check CHECK (id > 0);
    `);

    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SUPA_CHECK_CREATE_SCHEMA_GUARD",
        "SUPA_CHECK_CREATE_TABLE_GUARD",
        "SUPA_CHECK_CREATE_VIEW_REPLACE",
        "SUPA_CHECK_CREATE_ROUTINE_REPLACE",
        "SUPA_CHECK_CREATE_TYPE_GUARD",
        "SUPA_CHECK_ADD_CONSTRAINT_GUARD",
      ])
    );
  });

  it("warns when SECURITY DEFINER functions omit function-local search_path", async () => {
    const unsafe = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.unsafe()
      RETURNS int
      LANGUAGE sql
      SECURITY DEFINER
      AS $$ SELECT 1 $$;
    `);
    const safe = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.safe()
      RETURNS int
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = app, pg_temp
      AS $$ SELECT 1 $$;
    `);

    expect(unsafe.map((item) => item.code)).toContain("SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH");
    expect(safe.map((item) => item.code)).not.toContain("SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH");
  });

  it("reports unknown configured validators", async () => {
    const diagnostics = await checkMigrationSql("CREATE SCHEMA IF NOT EXISTS app;", {
      config: { validators: ["internal-parser", "definitely-not-real"] },
    });

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_VALIDATOR_UNKNOWN");
  });
});

describe("managed Supabase schemas", () => {
  it("blocks direct declarative ownership of managed schemas", async () => {
    const options = { config: { managedSchemas: ["auth", "extensions"] } };
    const schema = await extractObjectsFromSql("CREATE SCHEMA auth;", options);
    const table = await extractObjectsFromSql(
      "CREATE TABLE auth.users_shadow (id bigint);",
      options
    );
    const extension = await extractObjectsFromSql(
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      options
    );

    expect(schema.diagnostics.map((item) => item.code)).toContain("SUPA_SUPABASE_MANAGED_SCHEMA");
    expect(table.diagnostics.map((item) => item.code)).toContain("SUPA_SUPABASE_MANAGED_SCHEMA");
    expect(extension.diagnostics.map((item) => item.code)).toContain(
      "SUPA_SUPABASE_MANAGED_SCHEMA"
    );
  });
});

describe("unsupported source statements", () => {
  it("blocks side-effect statements in declarative schema input", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      INSERT INTO app.audit_events (event_name) VALUES ('created');
    `);

    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED"
    );
  });
});

describe("enum widening", () => {
  it("renders appended enum values as guarded ALTER TYPE ADD VALUE", async () => {
    const before = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TYPE app.mood AS ENUM ('ok', 'bad');
    `);
    const after = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TYPE app.mood AS ENUM ('ok', 'bad', 'meh');
    `);
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: after.objects, source: "to" }
    );
    const errors = plan.diagnostics.filter((item) => item.severity === "error");

    expect(errors).toEqual([]);
    expect(plan.operations.map((operation) => operation.kind)).toContain("alter");
    expect(renderMigration(plan)).toContain(
      `ALTER TYPE "app"."mood" ADD VALUE IF NOT EXISTS 'meh';`
    );
  });

  it("treats reordered enum values as destructive replacements", async () => {
    const before = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TYPE app.mood AS ENUM ('ok', 'bad');
    `);
    const after = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TYPE app.mood AS ENUM ('bad', 'ok');
    `);
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: after.objects, source: "to" }
    );

    expect(plan.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED"
    );
  });
});

describe("grants and default privileges", () => {
  it("splits multi-role grants into per-grantee objects with structured metadata", async () => {
    const extracted = await extractObjectsFromSql(
      "GRANT SELECT, INSERT ON TABLE app.accounts TO authenticated, service_role;"
    );

    expect(extracted.objects).toHaveLength(2);
    expect(extracted.objects.map((object) => object.metadata.grantee).sort()).toEqual([
      "authenticated",
      "service_role",
    ]);
    expect(extracted.objects[0]?.metadata.privileges).toEqual(["INSERT", "SELECT"]);
  });

  it("renders dropped grants as REVOKE statements", async () => {
    const before = await extractObjectsFromSql(
      "GRANT SELECT ON TABLE app.accounts TO authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(
      `REVOKE SELECT ON TABLE "app"."accounts" FROM "authenticated";`
    );
  });

  it("renders dropped default privileges as reverse REVOKE statements", async () => {
    const before = await extractObjectsFromSql(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "app" REVOKE SELECT ON TABLES FROM "authenticated";`
    );
  });
});

describe("comments", () => {
  it("keys comments by structured AST descriptors", async () => {
    const extracted = await extractObjectsFromSql("COMMENT ON TABLE app.accounts IS 'Accounts';");

    expect(extracted.objects).toHaveLength(1);
    expect(extracted.objects[0]?.metadata.descriptor).toBe("table app.accounts");
    expect(extracted.objects[0]?.ref.schema).toBe("app");
  });
});

describe("AST migration checks", () => {
  it("flags lock hazards and unguarded data statements", async () => {
    const diagnostics = await checkMigrationSql(`
      ALTER TABLE app.accounts ALTER COLUMN amount TYPE numeric(12, 2);
      ALTER TABLE app.accounts ALTER COLUMN amount SET NOT NULL;
      INSERT INTO app.settings (key) VALUES ('x');
      UPDATE app.settings SET key = 'y';
    `);
    const codes = diagnostics.map((item) => item.code);

    expect(codes).toContain("SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE");
    expect(codes).toContain("SUPA_CHECK_SET_NOT_NULL_SCAN");
    expect(codes).toContain("SUPA_CHECK_INSERT_ON_CONFLICT");
    expect(codes).toContain("SUPA_CHECK_DML_REVIEW");
  });

  it("accepts guarded DO-block DDL without false positives", async () => {
    const diagnostics = await checkMigrationSql(`
      DO $supaschema$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mood') THEN
          CREATE TYPE app.mood AS ENUM ('ok');
        END IF;
      END
      $supaschema$;
    `);

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});

describe("golden migration output", () => {
  it("renders the basic fixture migration deterministically", async () => {
    const from = await extractSourceModel("dir:tests/fixtures/basic/from", {
      cwd: process.cwd(),
    });
    const to = await extractSourceModel("dir:tests/fixtures/basic/to", {
      cwd: process.cwd(),
    });
    const plan = planSchemaDiff(from, to);
    const first = renderMigration(plan, { version: "test" });
    const second = renderMigration(planSchemaDiff(from, to), { version: "test" });

    expect(first).toBe(second);
    expect(first).toMatchSnapshot();
  });
});
