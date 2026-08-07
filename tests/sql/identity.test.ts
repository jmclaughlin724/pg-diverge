import { describe, expect, it } from "vitest";
import { extractObjectsFromSql } from "../../src/sql/extract.js";
import { finalizeObject, type RenderGuardFacts } from "../../src/sql/facts.js";
import type { SchemaObject } from "../../src/types.js";

async function singleObject(
  sql: string,
  config?: { normalize?: "off" | "deparse" }
): Promise<SchemaObject> {
  const result = await extractObjectsFromSql(sql, config ? { config } : {});
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  if (result.objects.length !== 1) {
    throw new Error(`expected one extracted object, got ${result.objects.length}`);
  }
  const object = result.objects[0];
  if (!object) {
    throw new Error("expected one extracted object");
  }
  return object;
}

function renderFacts(object: SchemaObject): RenderGuardFacts {
  const facts = object.metadata.render;
  if (!facts) {
    throw new Error(`object ${object.key} has no render facts`);
  }
  return facts;
}

function splicedGuard(object: SchemaObject, insert: string): string {
  const facts = renderFacts(object);
  if (facts.offset === undefined) {
    throw new Error(`object ${object.key} has no render offset`);
  }
  return `${object.sql.slice(0, facts.offset)}${insert}${object.sql.slice(facts.offset)}`;
}

describe("AST object identity", () => {
  it("hashes equivalent spellings of the same definition identically", async () => {
    const upper = await singleObject(
      "CREATE TABLE App.Accounts (id INT NOT NULL, label VARCHAR(10));"
    );
    const lower = await singleObject(
      "create table if not exists app.accounts (\n  id integer not null,\n  label character varying(10)\n);"
    );

    expect(upper.key).toBe(lower.key);
    expect(upper.hash).toBe(lower.hash);
  });

  it("keeps quoted mixed-case identifiers distinct from folded identifiers", async () => {
    const quoted = await singleObject('CREATE TABLE app."Accounts" (id integer);');
    const folded = await singleObject("CREATE TABLE app.accounts (id integer);");

    expect(quoted.key).not.toBe(folded.key);
    expect(quoted.hash).not.toBe(folded.hash);
  });

  it("hashes guarded and unguarded create statements identically", async () => {
    const guarded = await singleObject("CREATE OR REPLACE VIEW app.v AS SELECT 1 AS one;");
    const bare = await singleObject("CREATE VIEW app.v AS SELECT 1 AS one;");

    expect(guarded.hash).toBe(bare.hash);
    expect(renderFacts(guarded).present).toBe(true);
    expect(renderFacts(bare).present).toBe(false);
  });

  it("hashes dump-style text casts on index string literals like the source spelling", async () => {
    const casted = await singleObject(
      "CREATE INDEX app_tasks_idx ON app.tasks ((payload ->> 'status'::text)) WHERE queue = 'ready'::text;"
    );
    const bare = await singleObject(
      "CREATE INDEX app_tasks_idx ON app.tasks ((payload ->> 'status')) WHERE queue = 'ready';"
    );

    expect(casted.hash).toBe(bare.hash);
  });

  it("preserves semantically different index literal casts", async () => {
    const text = await singleObject("CREATE INDEX app_literal_idx ON app.tasks (('1'::text));");
    const integer = await singleObject(
      "CREATE INDEX app_literal_idx ON app.tasks (('1'::integer));"
    );

    expect(text.hash).not.toBe(integer.hash);
  });

  it("preserves text casts on nonliteral index expressions", async () => {
    const casted = await singleObject(
      "CREATE INDEX app_payload_idx ON app.tasks ((payload::text));"
    );
    const bare = await singleObject("CREATE INDEX app_payload_idx ON app.tasks ((payload));");

    expect(casted.hash).not.toBe(bare.hash);
  });

  it("hashes typed NULL routine defaults like untyped NULL for the declared parameter type", async () => {
    const typed = await singleObject(
      "CREATE FUNCTION app.allowed(resource_type text DEFAULT NULL::text, resource_id uuid DEFAULT NULL::uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;"
    );
    const bare = await singleObject(
      "CREATE FUNCTION app.allowed(resource_type text DEFAULT NULL, resource_id uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;"
    );

    expect(typed.hash).toBe(bare.hash);
  });

  it("preserves a typed NULL routine default when its cast differs from the parameter type", async () => {
    const matching = await singleObject(
      "CREATE FUNCTION app.allowed(resource_type text DEFAULT NULL::text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;"
    );
    const different = await singleObject(
      "CREATE FUNCTION app.allowed(resource_type text DEFAULT NULL::uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;"
    );

    expect(matching.hash).not.toBe(different.hash);
  });

  it("canonicalizes matching typed NULL procedure defaults", async () => {
    const typed = await singleObject(
      "CREATE PROCEDURE app.refresh(resource_id uuid DEFAULT NULL::uuid) LANGUAGE sql AS $$ SELECT true $$;"
    );
    const bare = await singleObject(
      "CREATE PROCEDURE app.refresh(resource_id uuid DEFAULT NULL) LANGUAGE sql AS $$ SELECT true $$;"
    );

    expect(typed.hash).toBe(bare.hash);
  });

  it("hashes grants from canonical structured privilege metadata", async () => {
    const canonical = await singleObject(
      "GRANT SELECT(id, display_name) ON TABLE app.accounts TO authenticated;"
    );
    const reorderedSql = structuredClone(canonical);
    reorderedSql.sql =
      'GRANT SELECT ("display_name", "id") ON TABLE "app"."accounts" TO "authenticated"';

    const diagnostics = await finalizeObject(reorderedSql);

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reorderedSql.hash).toBe(canonical.hash);
  });

  it("includes every structured grant identity field in its hash", async () => {
    const canonical = await singleObject(
      "GRANT SELECT(id) ON TABLE app.accounts TO authenticated;"
    );
    const variants: Record<string, unknown>[] = [
      { columnPrivileges: { SELECT: ["other_id"] } },
      { grantee: "service_role" },
      { grantOptionColumnPrivileges: { SELECT: ["id"] } },
      { grantOptionPrivileges: ["SELECT"] },
      { kindPhrase: "VIEW" },
      { privileges: ["UPDATE"] },
      { targetIdentity: "app.other_accounts" },
      { verb: "REVOKE" },
    ];

    for (const metadata of variants) {
      const variant = structuredClone(canonical);
      Object.assign(variant.metadata, metadata);
      await finalizeObject(variant);
      expect(variant.hash).not.toBe(canonical.hash);
    }
  });

  it("distinguishes column-scoped grants from object-wide grants", async () => {
    const scoped = await singleObject("GRANT SELECT(id) ON TABLE app.accounts TO authenticated;");
    const objectWide = await singleObject("GRANT SELECT ON TABLE app.accounts TO authenticated;");

    expect(scoped.key).toBe(objectWide.key);
    expect(scoped.hash).not.toBe(objectWide.hash);
  });

  it("canonicalizes pg_catalog qualification in constraint casts", async () => {
    const implicit = await singleObject(
      "ALTER TABLE app.accounts ADD CONSTRAINT accounts_payload CHECK (payload IS NULL OR validate(payload::json));"
    );
    const explicit = await singleObject(
      "ALTER TABLE app.accounts ADD CONSTRAINT accounts_payload CHECK (payload IS NULL OR validate(payload::pg_catalog.json));"
    );

    expect(implicit.hash).toBe(explicit.hash);
  });

  it("hashes scoped ALL like PostgreSQL's explicit column privilege set", async () => {
    const all = await singleObject("GRANT ALL(id) ON TABLE app.accounts TO authenticated;");
    const explicit = await singleObject(
      "GRANT INSERT(id), REFERENCES(id), SELECT(id), UPDATE(id) ON TABLE app.accounts TO authenticated;"
    );

    expect(all.hash).toBe(explicit.hash);
  });

  it("includes the default-privilege owner role in its hash", async () => {
    const first = await singleObject(
      "ALTER DEFAULT PRIVILEGES FOR ROLE owner_a IN SCHEMA app GRANT SELECT ON TABLES TO authenticated;"
    );
    const second = await singleObject(
      "ALTER DEFAULT PRIVILEGES FOR ROLE owner_b IN SCHEMA app GRANT SELECT ON TABLES TO authenticated;"
    );

    expect(first.key).not.toBe(second.key);
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("render guard facts", () => {
  it("locates the splice offset after table prefix keywords", async () => {
    const table = await singleObject("CREATE UNLOGGED TABLE app.t (id integer);", {
      normalize: "off",
    });

    expect(renderFacts(table).guard).toBe("ifNotExists");
    expect(splicedGuard(table, "IF NOT EXISTS ")).toBe(
      "CREATE UNLOGGED TABLE IF NOT EXISTS app.t (id integer)"
    );
  });

  it("locates the splice offset after CONCURRENTLY for unique indexes", async () => {
    const index = await singleObject(
      "CREATE UNIQUE INDEX CONCURRENTLY items_idx ON app.items (id);"
    );

    expect(splicedGuard(index, "IF NOT EXISTS ")).toBe(
      "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_idx ON app.items (id)"
    );
  });

  it("locates the OR REPLACE splice offset after CREATE for views", async () => {
    const view = await singleObject("CREATE VIEW app.v2 AS SELECT 2 AS two;");

    expect(renderFacts(view).guard).toBe("orReplace");
    expect(splicedGuard(view, "OR REPLACE ")).toBe(
      "CREATE OR REPLACE VIEW app.v2 AS SELECT 2 AS two"
    );
  });

  it("skips leading comments when locating splice offsets", async () => {
    const table = await singleObject("-- owner comment\nCREATE TABLE app.t2 (id integer);", {
      normalize: "off",
    });

    expect(splicedGuard(table, "IF NOT EXISTS ")).toBe(
      "-- owner comment\nCREATE TABLE IF NOT EXISTS app.t2 (id integer)"
    );
  });
});

describe("statement facts", () => {
  it("derives view output columns and security_invoker", async () => {
    const view = await singleObject(
      "CREATE VIEW app.v3 WITH (security_invoker = true) AS SELECT a.id, a.label AS name FROM app.accounts a;"
    );

    expect(view.metadata.viewColumns).toEqual(["id", "name"]);
    expect(view.metadata.securityInvoker).toBe(true);
  });

  it("omits view columns when a target is statically unknowable", async () => {
    const view = await singleObject("CREATE VIEW app.v4 AS SELECT * FROM app.accounts;");

    expect(view.metadata.viewColumns).toBeUndefined();
  });

  it("derives routine return facts including SETOF", async () => {
    const fn = await singleObject(
      "CREATE FUNCTION app.f(a integer) RETURNS SETOF text LANGUAGE sql AS $$ SELECT 'x' $$;"
    );

    expect(fn.metadata.returns).toEqual({ setof: true, type: "text" });
  });

  it("derives OUT parameter facts", async () => {
    const fn = await singleObject(
      "CREATE FUNCTION app.g(IN a integer, OUT b text) LANGUAGE sql AS $$ SELECT 'x' $$;"
    );

    expect(fn.metadata.outParams).toEqual([{ mode: "FUNC_PARAM_OUT", name: "b", type: "text" }]);
  });
});

describe("view qualification canonicalization", () => {
  it("hashes PG15-style sole-relation qualification equal to the bare form", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT upper(accounts.name) AS name FROM app.accounts;"
    );
    const bare = await singleObject(
      "CREATE VIEW app.v AS SELECT upper(name) AS name FROM app.accounts;"
    );

    expect(qualified.hash).toBe(bare.hash);
  });

  it("hashes alias qualification equal to the bare form", async () => {
    const qualified = await singleObject("CREATE VIEW app.v AS SELECT a.name FROM app.accounts a;");
    const bare = await singleObject("CREATE VIEW app.v AS SELECT name FROM app.accounts a;");

    expect(qualified.hash).toBe(bare.hash);
  });

  it("hashes materialized view qualification equal to the bare form", async () => {
    const qualified = await singleObject(
      "CREATE MATERIALIZED VIEW app.mv AS SELECT accounts.name FROM app.accounts;"
    );
    const bare = await singleObject(
      "CREATE MATERIALIZED VIEW app.mv AS SELECT name FROM app.accounts;"
    );

    expect(qualified.hash).toBe(bare.hash);
  });

  it("preserves qualification when the scope has multiple relations", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT accounts.name FROM app.accounts, app.other;"
    );
    const bare = await singleObject(
      "CREATE VIEW app.v AS SELECT name FROM app.accounts, app.other;"
    );

    expect(qualified.hash).not.toBe(bare.hash);
  });

  it("strips inner sole-relation refs but preserves correlated outer refs", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT b.x FROM app.b WHERE b.y = accounts.name) AS x FROM app.accounts;"
    );
    const innerBare = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT x FROM app.b WHERE y = accounts.name) AS x FROM app.accounts;"
    );
    const outerBare = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT b.x FROM app.b WHERE b.y = name) AS x FROM app.accounts;"
    );

    expect(qualified.hash).toBe(innerBare.hash);
    expect(qualified.hash).not.toBe(outerBare.hash);
  });
});

describe("quantified array predicate canonicalization", () => {
  it("folds flat = ANY(ARRAY[...]) to IN (...)", async () => {
    const anyForm = await singleObject(
      "ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id = ANY(ARRAY[1, 2]));"
    );
    const inForm = await singleObject("ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id IN (1, 2));");

    expect(anyForm.key).toBe(inForm.key);
    expect(anyForm.hash).toBe(inForm.hash);
  });

  it("does not fold nested = ANY(ARRAY[[...], [...]]) to a flat IN list", async () => {
    const nestedAny = await singleObject(
      "ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id = ANY(ARRAY[[1, 2], [3, 4]]));"
    );
    const flatAny = await singleObject(
      "ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id = ANY(ARRAY[1, 2]));"
    );

    expect(nestedAny.hash).not.toBe(flatAny.hash);
  });

  it("does not fold nested <> ALL(ARRAY[[...], [...]]) to a flat NOT IN list", async () => {
    const nestedAll = await singleObject(
      "ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id <> ALL(ARRAY[[1, 2], [3, 4]]));"
    );
    const flatAll = await singleObject(
      "ALTER TABLE app.t ADD CONSTRAINT chk CHECK (id <> ALL(ARRAY[1, 2]));"
    );

    expect(nestedAll.hash).not.toBe(flatAll.hash);
  });
});
