import { describe, expect, it } from "vitest";
import type { SchemaObject } from "../src/core.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";
import type { RenderGuardFacts } from "../src/sql/facts.js";

async function singleObject(sql: string): Promise<SchemaObject> {
  const result = await extractObjectsFromSql(sql);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(result.objects).toHaveLength(1);
  const object = result.objects[0];
  if (!object) {
    throw new Error("expected one extracted object");
  }
  return object;
}

function renderFacts(object: SchemaObject): RenderGuardFacts {
  const facts = object.metadata.render as RenderGuardFacts | undefined;
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
      "CREATE TABLE App.Accounts (id INT NOT NULL, label VARCHAR(10));",
    );
    const lower = await singleObject(
      "create table if not exists app.accounts (\n  id integer not null,\n  label character varying(10)\n);",
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
});

describe("render guard facts", () => {
  it("locates the splice offset after table prefix keywords", async () => {
    const table = await singleObject("CREATE UNLOGGED TABLE app.t (id integer);");

    expect(renderFacts(table).guard).toBe("ifNotExists");
    expect(splicedGuard(table, "IF NOT EXISTS ")).toBe(
      "CREATE UNLOGGED TABLE IF NOT EXISTS app.t (id integer)",
    );
  });

  it("locates the splice offset after CONCURRENTLY for unique indexes", async () => {
    const index = await singleObject(
      "CREATE UNIQUE INDEX CONCURRENTLY items_idx ON app.items (id);",
    );

    expect(splicedGuard(index, "IF NOT EXISTS ")).toBe(
      "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_idx ON app.items (id)",
    );
  });

  it("locates the OR REPLACE splice offset after CREATE for views", async () => {
    const view = await singleObject("CREATE VIEW app.v2 AS SELECT 2 AS two;");

    expect(renderFacts(view).guard).toBe("orReplace");
    expect(splicedGuard(view, "OR REPLACE ")).toBe(
      "CREATE OR REPLACE VIEW app.v2 AS SELECT 2 AS two",
    );
  });

  it("skips leading comments when locating splice offsets", async () => {
    const table = await singleObject("-- owner comment\nCREATE TABLE app.t2 (id integer);");

    expect(splicedGuard(table, "IF NOT EXISTS ")).toBe(
      "-- owner comment\nCREATE TABLE IF NOT EXISTS app.t2 (id integer)",
    );
  });
});

describe("statement facts", () => {
  it("derives view output columns and security_invoker", async () => {
    const view = await singleObject(
      "CREATE VIEW app.v3 WITH (security_invoker = true) AS SELECT a.id, a.label AS name FROM app.accounts a;",
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
      "CREATE FUNCTION app.f(a integer) RETURNS SETOF text LANGUAGE sql AS $$ SELECT 'x' $$;",
    );

    expect(fn.metadata.returns).toEqual({ setof: true, type: "text" });
  });

  it("derives OUT parameter facts", async () => {
    const fn = await singleObject(
      "CREATE FUNCTION app.g(IN a integer, OUT b text) LANGUAGE sql AS $$ SELECT 'x' $$;",
    );

    expect(fn.metadata.outParams).toEqual([{ mode: "FUNC_PARAM_OUT", name: "b", type: "text" }]);
  });
});

describe("view qualification canonicalization", () => {
  it("hashes PG15-style sole-relation qualification equal to the bare form", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT upper(accounts.name) AS name FROM app.accounts;",
    );
    const bare = await singleObject(
      "CREATE VIEW app.v AS SELECT upper(name) AS name FROM app.accounts;",
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
      "CREATE MATERIALIZED VIEW app.mv AS SELECT accounts.name FROM app.accounts;",
    );
    const bare = await singleObject(
      "CREATE MATERIALIZED VIEW app.mv AS SELECT name FROM app.accounts;",
    );

    expect(qualified.hash).toBe(bare.hash);
  });

  it("preserves qualification when the scope has multiple relations", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT accounts.name FROM app.accounts, app.other;",
    );
    const bare = await singleObject(
      "CREATE VIEW app.v AS SELECT name FROM app.accounts, app.other;",
    );

    expect(qualified.hash).not.toBe(bare.hash);
  });

  it("strips inner sole-relation refs but preserves correlated outer refs", async () => {
    const qualified = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT b.x FROM app.b WHERE b.y = accounts.name) AS x FROM app.accounts;",
    );
    const innerBare = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT x FROM app.b WHERE y = accounts.name) AS x FROM app.accounts;",
    );
    const outerBare = await singleObject(
      "CREATE VIEW app.v AS SELECT (SELECT b.x FROM app.b WHERE b.y = name) AS x FROM app.accounts;",
    );

    expect(qualified.hash).toBe(innerBare.hash);
    expect(qualified.hash).not.toBe(outerBare.hash);
  });
});
