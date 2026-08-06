import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../../src/check/migration.js";
import { resolveConfig } from "../../src/config/schema.js";
import { diagnostic, formatDiagnostics } from "../../src/diagnostics/diagnostics.js";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { renderMigration } from "../../src/render/migration.js";
import { extractSourceModel } from "../../src/source/extract.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";
import { finalizeObject } from "../../src/sql/facts.js";
import { parseSqlAst } from "../../src/sql/parser.js";
import { splitSqlStatements } from "../../src/sql/split.js";
import { makeObject } from "../../src/sql/statements.js";

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

describe("routine dependency extraction", () => {
  it("merges AST dependencies into catalog-built objects during finalization", async () => {
    const object = makeObject(
      { kind: "function", name: "auth_is_company_admin", schema: "private", signature: "" },
      `CREATE OR REPLACE FUNCTION private.auth_is_company_admin()
       RETURNS boolean
       LANGUAGE sql
       STABLE
       AS $function$
         SELECT (identity.current_user_context()).role IS NOT NULL
       $function$`,
      0
    );
    object.dependencies.push("private.explicit_dependency");

    const diagnostics = await finalizeObject(object);

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(object.dependencies).toEqual([
      "identity.current_user_context",
      "private.explicit_dependency",
    ]);
    expect(object.metadata.routineDependencyConfidence).toBe("sql-string-parsed");
  });

  it("extracts joined view column dependencies through raw table aliases", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE VIEW app.account_summary AS
      SELECT a.id, a.status, jsonb_build_object('secret', s.secret_id) AS summary
      FROM app.accounts a
      LEFT JOIN app.secrets s ON s.account_id = a.id
      GROUP BY a.id, a.status, s.secret_id;
    `);
    const view = extracted.objects.find((object) => object.key === "view:app.account_summary");

    expect(view?.dependencies).toEqual(expect.arrayContaining(["app.accounts", "app.secrets"]));
    expect(view?.metadata.columnDependencies).toEqual(
      expect.arrayContaining([
        "app.accounts.id",
        "app.accounts.status",
        "app.secrets.account_id",
        "app.secrets.secret_id",
      ])
    );
  });

  it("extracts SQL-standard function body relation and column dependencies", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.account_secret()
      RETURNS uuid
      LANGUAGE SQL
      BEGIN ATOMIC
        SELECT secret_id FROM app.accounts;
      END;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.account_secret()"
    );

    expect(routine?.dependencies).toContain("app.accounts");
    expect(routine?.metadata.routineDependencyConfidence).toBe("sql-body");
    expect(routine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
  });

  it("parses SQL string function bodies without relying on PostgreSQL dependency tracking", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.account_secret_string()
      RETURNS uuid
      LANGUAGE sql
      AS $$
        SELECT secret_id FROM app.accounts
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.account_secret_string()"
    );

    expect(routine?.dependencies).toContain("app.accounts");
    expect(routine?.metadata.routineDependencyConfidence).toBe("sql-string-parsed");
    expect(routine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
  });

  it("tracks unqualified routine relations and types without treating CTEs as relations", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.account_value()
      RETURNS integer
      LANGUAGE sql
      AS $$
        WITH recent AS (
          SELECT id::custom_type AS value FROM accounts
        )
        SELECT value::integer FROM recent
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.account_value()"
    );

    expect(routine?.metadata.routineUnqualifiedReferences).toEqual({
      relations: ["accounts"],
      types: ["custom_type"],
    });
  });

  it("tracks unqualified types and row types in PL/pgSQL declarations", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.declared_dependencies()
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        first integer;
        second first%TYPE;
        account_array accounts%ROWTYPE[];
        account_id_array accounts.id%TYPE ARRAY[4];
        qualified_account app.accounts%ROWTYPE[];
        qualified_account_id app.accounts.id%TYPE ARRAY[4];
        quoted_account app."Accounts"%ROWTYPE;
        status custom_type[];
        qualified_status app.custom_type;
        quoted_status app."CustomType";
        collated app.custom_type COLLATE "C";
        required_count bigint NOT NULL DEFAULT 1;
        assigned_count bigint := 2;
        equal_assigned_count bigint = 3;
      BEGIN
        DECLARE
          nested_account accounts%ROWTYPE;
          nested_status CONSTANT custom_type := NULL;
          "first value" integer;
          nested_copy "first value"%TYPE;
        BEGIN
          NULL;
        END;
        RETURN second;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.declared_dependencies()"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-static");
    expect(routine?.metadata.routineUnqualifiedReferences).toEqual({
      relations: ["accounts"],
      types: ["custom_type"],
    });
    expect(extracted.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY"
    );
  });

  it("extracts static PL/pgSQL statements and parseable dynamic SQL", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.touch_secret()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM secret_id FROM app.accounts WHERE id = 1;
      END;
      $$;

      CREATE FUNCTION app.dynamic_lookup()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        EXECUTE 'select secret_id from app.accounts';
      END;
      $$;
    `);
    const staticRoutine = extracted.objects.find(
      (object) => object.key === "function:app.touch_secret()"
    );
    const dynamicRoutine = extracted.objects.find(
      (object) => object.key === "function:app.dynamic_lookup()"
    );

    expect(staticRoutine?.dependencies).toContain("app.accounts");
    expect(staticRoutine?.metadata.routineDependencyConfidence).toBe("plpgsql-static");
    expect(staticRoutine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
    expect(dynamicRoutine?.dependencies).toContain("app.accounts");
    expect(dynamicRoutine?.metadata.routineDependencyConfidence).toBe("plpgsql-dynamic-parsed");
    expect(dynamicRoutine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
    expect(extracted.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_ROUTINE_DYNAMIC_SQL_DEPENDENCY_UNKNOWN"
    );
  });

  it("parses PL/pgSQL EXECUTE format templates whose SQL shape is static", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.dynamic_format_lookup()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        EXECUTE format('select secret_id from app.accounts order by %I %s', 'created_at', 'desc');
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.dynamic_format_lookup()"
    );

    expect(routine?.dependencies).toContain("app.accounts");
    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-dynamic-parsed");
    expect(routine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
    expect(extracted.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_ROUTINE_DYNAMIC_SQL_DEPENDENCY_UNKNOWN"
    );
  });

  it("marks variable PL/pgSQL dynamic SQL as unproven", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.variable_dynamic_lookup(query_sql text)
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        EXECUTE query_sql;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.variable_dynamic_lookup(text)"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("dynamic-sql-unknown");
    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_ROUTINE_DYNAMIC_SQL_DEPENDENCY_UNKNOWN"
    );
  });

  it("extracts common static PL/pgSQL query forms", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.static_forms()
      RETURNS SETOF uuid
      LANGUAGE plpgsql
      AS $$
      DECLARE
        account_cursor CURSOR FOR SELECT secret_id FROM app.accounts;
        row_value record;
        found_secret uuid;
      BEGIN
        SELECT secret_id INTO found_secret FROM app.accounts LIMIT 1;
        INSERT INTO app.audit(account_id) SELECT id FROM app.accounts;
        UPDATE app.audit SET account_id = accounts.id FROM app.accounts WHERE audit.account_id = accounts.id;
        RETURN QUERY SELECT secret_id FROM app.accounts;
        FOR row_value IN SELECT secret_id FROM app.accounts LOOP
          PERFORM row_value.secret_id;
        END LOOP;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.static_forms()"
    );

    expect(routine?.dependencies).toEqual(expect.arrayContaining(["app.accounts", "app.audit"]));
    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-static");
    expect(routine?.metadata.routineColumnDependencies).toEqual(
      expect.arrayContaining(["app.accounts.id", "app.accounts.secret_id"])
    );
  });

  it("fails closed for PL/pgSQL cursors with arguments", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.cursor_with_arguments()
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        account_cursor CURSOR (account_id uuid) FOR
          SELECT id FROM app.accounts WHERE id = account_id;
      BEGIN
        RETURN 1;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.cursor_with_arguments()"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-partial");
    expect(extracted.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY",
          statement: expect.stringContaining("CURSOR (account_id uuid)"),
        }),
      ])
    );
  });

  it("keeps proven dependencies when a PL/pgSQL body is only partially parsed", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.partial_forms()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM secret_id FROM app.accounts;
        PERFORM FROM;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.partial_forms()"
    );

    expect(routine?.dependencies).toContain("app.accounts");
    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-partial");
    expect(routine?.metadata.routineColumnDependencies).toContain("app.accounts.secret_id");
    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY"
    );
    expect(extracted.diagnostics.map((item) => item.code)).not.toContain("SUPA_PARSE_ERROR");
  });

  it("marks unrecognized PL/pgSQL statements with embedded static SQL as partial", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.partial_assignment()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        found_secret uuid;
      BEGIN
        found_secret := (SELECT secret_id FROM app.accounts LIMIT 1);
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.partial_assignment()"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-partial");
    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY"
    );
  });

  it("does not treat PL/pgSQL distinct-from operators as hidden SQL", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.normalize_status()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.status IS DISTINCT FROM OLD.status THEN
          NEW.status := lower(NEW.status);
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.normalize_status()"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("plpgsql-static");
    expect(extracted.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY"
    );
  });

  it("rejects config-supplied routine dependency hints", () => {
    expect(() =>
      resolveConfig({
        hints: {
          routineDependencies: {
            "function:app.dynamic_lookup(bigint)": ["app.accounts.secret_id"],
          },
        },
      })
    ).toThrow("routineDependencies");
  });

  it("marks unsupported routine languages as unproven dependencies", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE FUNCTION app.python_lookup()
      RETURNS int
      LANGUAGE plpython3u
      AS $$ return 1 $$;
    `);
    const routine = extracted.objects.find(
      (object) => object.key === "function:app.python_lookup()"
    );

    expect(routine?.metadata.routineDependencyConfidence).toBe("unsupported-language");
    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_ROUTINE_BODY_DEPENDENCY_UNKNOWN"
    );
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
    const plan = planSchemaDiff(from, to, {
      config: { hints: { destructive: ["function:app.legacy_ping()"] } },
    });
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
    expect(sql).toContain('"disposition":"non-destructive-render-guard"');
    expect(sql).toContain('"key":"policy:app.accounts_select:accounts"');
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

  it("orders composite types after view row-type dependencies", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TYPE app.item_group AS (items app.v_items[]);
      CREATE VIEW app.v_items AS SELECT 1::integer AS id;
    `);
    const composite = extracted.objects.find((object) => object.key === "type:app.item_group");
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };
    const labels = planSchemaDiff(from, to).operations.map(
      (operation) => `${operation.kind}:${operation.key}`
    );

    expect(composite?.dependencies).toContain("app.v_items");
    expect(labels.indexOf("create:view:app.v_items")).toBeLessThan(
      labels.indexOf("create:type:app.item_group")
    );
  });

  it("quotes qualified SQL-function ORDER BY columns for catalog typecheck", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.credentials (
        id uuid,
        company_id uuid,
        updated_at timestamp with time zone
      );
      CREATE FUNCTION app.resolve_credential(p_company_id uuid)
      RETURNS TABLE(id uuid, updated_at timestamp with time zone)
      LANGUAGE sql STABLE
      AS $$
        SELECT c.id, c.updated_at
        FROM app.credentials c
        WHERE c.company_id = p_company_id
        ORDER BY c.updated_at DESC
        LIMIT 1;
      $$;
    `);
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };

    const sql = renderMigration(planSchemaDiff(from, to), { includeHeader: false });

    expect(sql).toContain('ORDER BY c."updated_at" DESC');
  });

  it("does not render create-table column guards that bypass add-column safety", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (
        id bigint PRIMARY KEY,
        company_id uuid NOT NULL,
        owner_id text,
        created_at timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE INDEX accounts_owner_idx
        ON app.accounts (company_id, owner_id)
        WHERE owner_id IS NOT NULL;
    `);
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };

    const sql = renderMigration(planSchemaDiff(from, to), { includeHeader: false });
    const createTable = "CREATE TABLE IF NOT EXISTS app.accounts";
    const indexSql =
      "CREATE INDEX IF NOT EXISTS accounts_owner_idx ON app.accounts (company_id, owner_id)";

    expect(sql).toContain(createTable);
    expect(sql).not.toContain('ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS');
    expect(sql.indexOf(createTable)).toBeLessThan(sql.indexOf(indexSql));
  });

  it("renders compatible create views without dependency-breaking drops", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const extracted = await extractObjectsFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id bigint PRIMARY KEY, name text);
      CREATE VIEW app.account_names AS SELECT id, name FROM app.accounts;
    `);
    const to = {
      diagnostics: extracted.diagnostics,
      fingerprint: "",
      objects: extracted.objects,
      source: "target",
    };

    const sql = renderMigration(planSchemaDiff(from, to), { includeHeader: false });
    const dropView = 'DROP VIEW IF EXISTS "app"."account_names";';
    const createView = "CREATE OR REPLACE VIEW app.account_names AS SELECT";

    expect(sql).not.toContain(dropView);
    expect(sql).not.toContain('"key":"view:app.account_names"');
    expect(sql.indexOf(createView)).toBeGreaterThanOrEqual(0);
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
  it("collapses identical rendered diagnostics with an occurrence count", () => {
    const item = diagnostic("SUPA_TEST", "warning", "same warning", {
      file: "schema.sql",
      hint: "fix it once",
    });

    const formatted = formatDiagnostics([item, item]);

    expect(formatted.split("SUPA_TEST")).toHaveLength(2);
    expect(formatted).toContain("repeated: 2 occurrences");
  });

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
      SET search_path = ''
      AS $$ SELECT 1 $$;
    `);

    expect(unsafe.map((item) => item.code)).toContain("SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH");
    expect(safe.map((item) => item.code)).not.toContain("SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH");
  });

  it("checks relation qualification when SECURITY DEFINER uses an empty search_path", async () => {
    const unqualified = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.shadowable()
      RETURNS bigint
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = ''
      AS $$ SELECT count(*) FROM accounts $$;
    `);
    const qualified = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.safe()
      RETURNS bigint
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
        WITH recent AS (SELECT id FROM app.accounts)
        SELECT count(*) FROM recent
      $$;
    `);

    expect(unqualified.map((item) => item.code)).toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
    expect(
      unqualified.find((item) => item.code === "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH")?.message
    ).toContain("pg_temp");
    expect(qualified.map((item) => item.code)).not.toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
  });

  it("checks PL/pgSQL declaration qualification with an empty search_path", async () => {
    const unqualified = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.shadowable_declaration()
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      DECLARE
        account accounts%ROWTYPE[];
        account_id accounts.id%TYPE ARRAY[4];
        status custom_type[];
      BEGIN
        RETURN 1;
      END;
      $$;
    `);
    const qualified = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.safe_declaration()
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      DECLARE
        first integer;
        second first%TYPE;
        account app.accounts%ROWTYPE[];
        account_id app.accounts.id%TYPE ARRAY[4];
        quoted_account app."Accounts"%ROWTYPE;
        status app.custom_type[];
        quoted_status app."CustomType";
        count bigint NOT NULL DEFAULT 1;
      BEGIN
        DECLARE
          nested_account app.accounts%ROWTYPE;
          nested_status CONSTANT app.custom_type := NULL;
        BEGIN
          NULL;
        END;
        RETURN second + count;
      END;
      $$;
    `);

    expect(unqualified.map((item) => item.code)).toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
    expect(qualified.map((item) => item.code)).not.toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
  });

  it("fails closed when an empty-path SECURITY DEFINER body is not statically proven", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.dynamic(query_sql text)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      BEGIN
        EXECUTE query_sql;
      END;
      $$;
    `);

    expect(diagnostics.map((item) => item.code)).toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
    expect(
      diagnostics.find((item) => item.code === "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH")?.message
    ).toContain("could not be proven safe");
  });

  it("warns when a SECURITY DEFINER function pins a non-empty search_path", async () => {
    for (const searchPath of ["public", "app, pg_temp", "'', public"]) {
      const diagnostics = await checkMigrationSql(`
        CREATE OR REPLACE FUNCTION app.risky()
        RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = ${searchPath}
        AS $$ SELECT 1 $$;
      `);

      expect(diagnostics.map((item) => item.code)).toContain(
        "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
      );
    }
  });

  it("warns when a SECURITY DEFINER function inherits search_path from the session", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.inherited()
      RETURNS int
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path FROM CURRENT
      AS $$ SELECT 1 $$;
    `);

    expect(diagnostics.map((item) => item.code)).toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
  });

  it("leaves SECURITY INVOKER functions without a search_path alone", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.invoker()
      RETURNS int
      LANGUAGE sql
      AS $$ SELECT 1 $$;
    `);

    expect(diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH"
    );
  });

  it("carries routine security facts on the extracted model", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE OR REPLACE FUNCTION app.definer_empty()
      RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 1 $$;
      CREATE OR REPLACE FUNCTION app.definer_public()
      RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
      AS $$ SELECT 1 $$;
      CREATE OR REPLACE FUNCTION app.definer_bare()
      RETURNS int LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT 1 $$;
      CREATE OR REPLACE FUNCTION app.invoker()
      RETURNS int LANGUAGE sql
      AS $$ SELECT 1 $$;
    `);
    const metadata = (name: string) =>
      extracted.objects.find((object) => object.ref.name === name)?.metadata;

    expect(metadata("definer_empty")?.securityDefiner).toBe(true);
    expect(metadata("definer_empty")?.routineSearchPath).toBe("");
    expect(metadata("definer_public")?.securityDefiner).toBe(true);
    expect(metadata("definer_public")?.routineSearchPath).toBe("pg_catalog, public");
    expect(metadata("definer_bare")?.securityDefiner).toBe(true);
    expect(metadata("definer_bare")?.routineSearchPath).toBeUndefined();
    expect(metadata("invoker")?.securityDefiner).toBe(false);
  });

  it("reads routine security facts from a pg_get_functiondef definition", async () => {
    const object = makeObject(
      { kind: "function", name: "definer", schema: "app", signature: "" },
      `CREATE OR REPLACE FUNCTION app.definer()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT 1 $function$`,
      0
    );

    const diagnostics = await finalizeObject(object);

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(object.metadata.securityDefiner).toBe(true);
    expect(object.metadata.routineSearchPath).toBe("");
  });

  it("warns when public functions do not explicitly revoke PUBLIC EXECUTE", async () => {
    const unsafe = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION public.unsafe()
      RETURNS int
      LANGUAGE sql
      AS $$ SELECT 1 $$;
    `);
    const safe = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION public.safe()
      RETURNS int
      LANGUAGE sql
      AS $$ SELECT 1 $$;
      REVOKE EXECUTE ON FUNCTION public.safe() FROM PUBLIC;
    `);

    expect(unsafe.map((item) => item.code)).toContain("SUPA_CHECK_FUNCTION_PUBLIC_EXECUTE");
    expect(safe.map((item) => item.code)).not.toContain("SUPA_CHECK_FUNCTION_PUBLIC_EXECUTE");
  });

  it("matches PUBLIC EXECUTE revokes by full routine signature", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION public.overloaded(value integer)
      RETURNS integer
      LANGUAGE sql
      AS $$ SELECT value $$;

      CREATE OR REPLACE FUNCTION public.overloaded(value text)
      RETURNS text
      LANGUAGE sql
      AS $$ SELECT value $$;

      REVOKE EXECUTE ON FUNCTION public.overloaded(integer) FROM PUBLIC;
    `);
    const publicExecuteDiagnostics = diagnostics.filter(
      (item) => item.code === "SUPA_CHECK_FUNCTION_PUBLIC_EXECUTE"
    );

    expect(publicExecuteDiagnostics).toHaveLength(1);
    expect(publicExecuteDiagnostics[0]?.statement).toContain("public.overloaded(value text)");
  });

  it("rejects routine references to columns created later in the same migration", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.read_secret()
      RETURNS uuid
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
      END;
      $$;

      ALTER TABLE app.accounts ADD COLUMN secret_id uuid;
    `);

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_FORWARD_REFERENCE_ORDER");
  });

  it("allows references to a pre-existing table that is dropped and recreated", async () => {
    const diagnostics = await checkMigrationSql(`
      GRANT SELECT ON TABLE app.accounts TO authenticated;

      DROP TABLE IF EXISTS app.accounts;

      CREATE TABLE IF NOT EXISTS app.accounts (id bigint PRIMARY KEY);
    `);

    expect(diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_CHECK_FORWARD_REFERENCE_ORDER"
    );
  });

  it("allows routine references to columns of a table that is dropped and recreated", async () => {
    const diagnostics = await checkMigrationSql(`
      CREATE OR REPLACE FUNCTION app.read_secret()
      RETURNS uuid
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN (SELECT secret_id FROM app.accounts LIMIT 1);
      END;
      $$;

      DROP TABLE IF EXISTS app.accounts;

      CREATE TABLE IF NOT EXISTS app.accounts (id bigint PRIMARY KEY, secret_id uuid);
    `);

    expect(diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_CHECK_FORWARD_REFERENCE_ORDER"
    );
  });

  it("rejects references to a table inside its own drop and recreate gap", async () => {
    const diagnostics = await checkMigrationSql(`
      DROP TABLE IF EXISTS app.accounts;

      CREATE OR REPLACE VIEW app.account_summary AS SELECT id FROM app.accounts;

      CREATE TABLE IF NOT EXISTS app.accounts (id bigint PRIMARY KEY);
    `);

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CHECK_FORWARD_REFERENCE_ORDER");
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
      GRANT app_worker TO postgres;
    `);

    expect(extracted.diagnostics.map((item) => item.code)).toContain(
      "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED"
    );
    expect(
      extracted.diagnostics.some(
        (item) =>
          item.code === "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED" &&
          item.statement?.includes("GRANT app_worker")
      )
    ).toBe(true);
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
    expect(
      extracted.objects
        .map((object) => object.metadata.grantee)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(["authenticated", "service_role"]);
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

  it("preserves column scopes when dropping grants", async () => {
    const before = await extractObjectsFromSql(
      "GRANT SELECT(display_name, id) ON TABLE app.accounts TO authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(
      `REVOKE SELECT ("display_name", "id") ON TABLE "app"."accounts" FROM "authenticated";`
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

  it("renders grant replacements as a convergent revoke then grant", async () => {
    const before = await extractObjectsFromSql(
      "GRANT SELECT, INSERT, UPDATE ON TABLE app.accounts TO authenticated;"
    );
    const after = await extractObjectsFromSql(
      "GRANT SELECT ON TABLE app.accounts TO authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "from", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "to", objects: after.objects, source: "to" }
    );
    const sql = renderMigration(plan);

    expect(sql).toContain(
      `REVOKE INSERT, SELECT, UPDATE ON TABLE "app"."accounts" FROM "authenticated";`
    );
    expect(sql).toContain('GRANT SELECT ON TABLE "app"."accounts" TO "authenticated";');
  });

  it("preserves scoped columns while replacing grants", async () => {
    const before = await extractObjectsFromSql(
      "GRANT INSERT, SELECT(id) ON TABLE app.accounts TO authenticated;"
    );
    const after = await extractObjectsFromSql(
      "GRANT INSERT, SELECT(display_name) ON TABLE app.accounts TO authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "from", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "to", objects: after.objects, source: "to" }
    );
    const sql = renderMigration(plan);
    const revoke = `REVOKE INSERT, SELECT ("id") ON TABLE "app"."accounts" FROM "authenticated";`;
    const grant = `GRANT INSERT, SELECT ("display_name") ON TABLE "app"."accounts" TO "authenticated";`;

    expect(sql).toContain(revoke);
    expect(sql).toContain(grant);
    expect(sql.indexOf(revoke)).toBeLessThan(sql.indexOf(grant));
  });

  it("renders grant creation from structured metadata", async () => {
    const after = await extractObjectsFromSql(
      "GRANT SELECT(id) ON TABLE app.accounts TO authenticated;"
    );
    const grant = after.objects[0];
    if (!grant) {
      throw new Error("expected one grant object");
    }
    grant.sql = 'GRANT ALL ON TABLE "app"."accounts" TO "authenticated"';
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "from", objects: [], source: "from" },
      { diagnostics: [], fingerprint: "to", objects: after.objects, source: "to" }
    );
    const sql = renderMigration(plan);

    expect(sql).toContain(`GRANT SELECT ("id") ON TABLE "app"."accounts" TO "authenticated";`);
    expect(sql).not.toContain("GRANT ALL ON TABLE");
  });

  it("restores a removed column-scoped REVOKE", async () => {
    const before = await extractObjectsFromSql(
      "REVOKE SELECT(id) ON TABLE app.accounts FROM authenticated;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(
      `GRANT SELECT ("id") ON TABLE "app"."accounts" TO "authenticated";`
    );
  });

  it("rejects REVOKE GRANT OPTION FOR until it has a dedicated model", async () => {
    const extracted = await extractObjectsFromSql(
      "REVOKE GRANT OPTION FOR SELECT(id) ON TABLE app.accounts FROM authenticated;"
    );
    const unsupported = extracted.diagnostics.find(
      (item) => item.code === "SUPA_EXTRACT_UNSUPPORTED"
    );

    expect(unsupported?.message).toContain("REVOKE GRANT OPTION FOR");
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "from", objects: [], source: "from" },
      { diagnostics: [], fingerprint: "to", objects: extracted.objects, source: "to" }
    );
    expect(() => renderMigration(plan)).toThrow("unsupported REVOKE GRANT OPTION FOR");
  });

  it("renders dropped builtin revokes as restored grants", async () => {
    const before = await extractObjectsFromSql("REVOKE ALL ON FUNCTION app.f() FROM PUBLIC;");
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(`GRANT EXECUTE ON FUNCTION "app"."f"() TO PUBLIC;`);
  });

  it("does not turn removed PUBLIC table revokes into GRANT ALL", async () => {
    const before = await extractObjectsFromSql("REVOKE ALL ON TABLE app.accounts FROM PUBLIC;");
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );
    const sql = renderMigration(plan);

    expect(sql).toContain("-- Manual privilege reversal required for");
    expect(sql).not.toContain("GRANT ALL ON TABLE");
  });

  it("renders dropped default privilege revokes as restored default grants", async () => {
    const before = await extractObjectsFromSql(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM PUBLIC;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );

    expect(renderMigration(plan)).toContain(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "app" GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`
    );
  });

  it("does not turn removed PUBLIC table default revokes into GRANT ALL", async () => {
    const before = await extractObjectsFromSql(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;"
    );
    const plan = planSchemaDiff(
      { diagnostics: [], fingerprint: "", objects: before.objects, source: "from" },
      { diagnostics: [], fingerprint: "", objects: [], source: "to" },
      { config: { hints: { destructive: ["*"] } } }
    );
    const sql = renderMigration(plan);

    expect(sql).toContain("-- Manual privilege reversal required for");
    expect(sql).not.toContain("GRANT ALL ON TABLES");
  });
});

describe("comments", () => {
  it("keys comments by structured AST descriptors", async () => {
    const extracted = await extractObjectsFromSql("COMMENT ON TABLE app.accounts IS 'Accounts';");

    expect(extracted.objects).toHaveLength(1);
    expect(extracted.objects[0]?.metadata.descriptor).toBe("table app.accounts");
    expect(extracted.objects[0]?.ref.schema).toBe("app");
  });

  it("hashes function comments by normalized descriptor and comment text", async () => {
    const first = await extractObjectsFromSql(
      "COMMENT ON FUNCTION app.f(p_value int) IS 'normalizes target syntax';"
    );
    const second = await extractObjectsFromSql(
      "COMMENT ON FUNCTION app.f(integer) IS 'normalizes target syntax';"
    );

    expect(first.objects[0]?.key).toBe(second.objects[0]?.key);
    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });
});

describe("AST canonicalization", () => {
  it("normalizes qualified columns inside set-operation view branches", async () => {
    const first = await extractObjectsFromSql(`
      CREATE VIEW app.v_status AS
      SELECT id, 'a'::text AS source FROM app.a
      UNION ALL
      SELECT id, 'b'::text FROM app.b;
    `);
    const second = await extractObjectsFromSql(`
      CREATE VIEW app.v_status AS
      SELECT a.id, 'a'::text AS source FROM app.a
      UNION ALL
      SELECT b.id, 'b'::text FROM app.b;
    `);

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });

  it("ignores nested deparser aliases without hiding view output column changes", async () => {
    const nestedAlias = await extractObjectsFromSql(`
      CREATE VIEW app.v_counts AS
      SELECT (SELECT count(*) AS count FROM app.items) AS item_count;
    `);
    const nestedNoAlias = await extractObjectsFromSql(`
      CREATE VIEW app.v_counts AS
      SELECT (SELECT count(*) FROM app.items) AS item_count;
    `);
    const outputRename = await extractObjectsFromSql(`
      CREATE VIEW app.v_counts AS
      SELECT (SELECT count(*) FROM app.items) AS total_count;
    `);

    expect(nestedAlias.objects[0]?.hash).toBe(nestedNoAlias.objects[0]?.hash);
    expect(nestedNoAlias.objects[0]?.hash).not.toBe(outputRename.objects[0]?.hash);
  });

  it("normalizes policy role ordering", async () => {
    const first = await extractObjectsFromSql(
      "CREATE POLICY p ON app.items FOR INSERT TO anon, authenticated WITH CHECK (id IS NOT NULL);"
    );
    const second = await extractObjectsFromSql(
      "CREATE POLICY p ON app.items FOR INSERT TO authenticated, anon WITH CHECK (id IS NOT NULL);"
    );

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });

  it("normalizes associative boolean grouping in view predicates", async () => {
    const first = await extractObjectsFromSql(`
      CREATE VIEW app.v_items AS
      SELECT id FROM app.items
      WHERE ready AND score >= 0 AND score <= 10;
    `);
    const second = await extractObjectsFromSql(`
      CREATE VIEW app.v_items AS
      SELECT id FROM app.items
      WHERE ready AND (score >= 0 AND score <= 10);
    `);

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });

  it("normalizes not-distinct policy spellings", async () => {
    const first = await extractObjectsFromSql(
      "CREATE POLICY p ON app.items FOR INSERT TO authenticated WITH CHECK (NOT (owner_id IS DISTINCT FROM auth.uid()));"
    );
    const second = await extractObjectsFromSql(
      "CREATE POLICY p ON app.items FOR INSERT TO authenticated WITH CHECK (owner_id IS NOT DISTINCT FROM auth.uid());"
    );

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });

  it("normalizes range-function alias column lists in policies", async () => {
    const first = await extractObjectsFromSql(`
      CREATE POLICY p ON app.items FOR INSERT TO authenticated
      WITH CHECK (owner_id = (SELECT ctx.user_id FROM app.current_context() AS ctx(user_id, company_id)));
    `);
    const second = await extractObjectsFromSql(`
      CREATE POLICY p ON app.items FOR INSERT TO authenticated
      WITH CHECK (owner_id = (SELECT ctx.user_id FROM app.current_context() AS ctx));
    `);

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
  });

  it("normalizes redundant jsonb_populate_record result casts", async () => {
    const first = await extractObjectsFromSql(`
      CREATE VIEW app.v_reviews AS
      SELECT jsonb_populate_record(NULL::app.review, payload) AS review
      FROM app.reviews;
    `);
    const second = await extractObjectsFromSql(`
      CREATE VIEW app.v_reviews AS
      SELECT jsonb_populate_record(NULL::app.review, payload)::app.review AS review
      FROM app.reviews;
    `);

    expect(first.objects[0]?.hash).toBe(second.objects[0]?.hash);
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
