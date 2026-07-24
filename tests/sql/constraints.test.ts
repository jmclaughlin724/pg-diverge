import { describe, expect, it } from "vitest";
import { extractObjectsFromSql } from "../../src/sql/extract.js";

describe("in-CREATE constraint decomposition", () => {
  it("synthesizes constraint objects with PostgreSQL default names", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.accounts (
  id bigint PRIMARY KEY,
  email text UNIQUE,
  tenant_id bigint REFERENCES app.tenants (id),
  score integer CHECK (score >= 0),
  CONSTRAINT accounts_named_check CHECK (score < 100)
);`,
      { file: "t.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = extracted.objects.map((object) => object.key).sort();
    expect(keys).toEqual([
      "constraint:app.accounts_email_key:accounts",
      "constraint:app.accounts_named_check:accounts",
      "constraint:app.accounts_pkey:accounts",
      "constraint:app.accounts_score_check:accounts",
      "constraint:app.accounts_tenant_id_fkey:accounts",
      "table:app.accounts",
    ]);
  });

  it("allocates colliding unnamed constraint names with PostgreSQL suffixes", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.role_assignments (
  organization_id uuid,
  unit_id uuid,
  role_id uuid,
  CHECK ((organization_id IS NULL) <> (unit_id IS NULL)),
  CHECK ((organization_id IS NULL) OR (role_id IS NOT NULL)),
  CHECK ((unit_id IS NULL) OR (role_id IS NOT NULL))
);`,
      { file: "t.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(
      extracted.objects
        .filter((object) => object.key.startsWith("constraint:"))
        .map((object) => object.ref.name)
    ).toEqual(["role_assignments_check", "role_assignments_check1", "role_assignments_check2"]);
  });

  it("allocates generated constraint names within the owning table", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.other (
  id integer,
  CONSTRAINT accounts_check CHECK (id > 0)
);
CREATE TABLE app.accounts (minimum integer, maximum integer);
ALTER TABLE app.accounts ADD CHECK (minimum <= maximum);`,
      { file: "t.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(
      extracted.objects
        .filter((object) => object.ref.kind === "constraint")
        .map((object) => `${object.ref.table}:${object.ref.name}`)
    ).toEqual(["other:accounts_check", "accounts:accounts_check"]);
  });

  it("does not reserve explicit constraint names before PostgreSQL encounters them", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.items (
  value integer CHECK (value > 0),
  CONSTRAINT items_value_check CHECK (value < 100)
);`,
      { file: "t.sql" }
    );

    expect(
      extracted.objects
        .filter((object) => object.ref.kind === "constraint")
        .map((object) => object.ref.name)
    ).toEqual(["items_value_check", "items_value_check"]);
  });

  it("reserves explicit names and truncates generated names on UTF-8 boundaries", async () => {
    const tableName = "é".repeat(30);
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app."${tableName}" (
  first_id uuid,
  second_id uuid,
  CONSTRAINT "${"é".repeat(28)}_check" CHECK (first_id IS NOT NULL OR second_id IS NOT NULL),
  CHECK (first_id IS NULL OR second_id IS NULL)
);`,
      { file: "t.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const names = extracted.objects
      .filter((object) => object.key.startsWith("constraint:"))
      .map((object) => object.ref.name);
    expect(names).toEqual([`${"é".repeat(28)}_check`, `${"é".repeat(28)}_check1`]);
    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(true);
  });

  it("synthesizes named inline constraints without the CONSTRAINT prefix doubled", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.accounts (
  id bigint CONSTRAINT "accounts pk" PRIMARY KEY,
  score integer CONSTRAINT score_positive CHECK (score >= 0)
);`,
      { config: { normalize: "off" }, file: "t.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const check = extracted.objects.find((object) => object.key.includes("score_positive"));
    expect(check?.sql).toBe(
      'ALTER TABLE ONLY "app"."accounts" ADD CONSTRAINT "score_positive" CHECK (score >= 0)'
    );
    const pk = extracted.objects.find((object) => object.key.includes("accounts pk"));
    expect(pk?.sql).toBe(
      'ALTER TABLE ONLY "app"."accounts" ADD CONSTRAINT "accounts pk" PRIMARY KEY ("id")'
    );
  });

  it("rebuilds columns-only table SQL with PK-implied NOT NULL preserved", async () => {
    const extracted = await extractObjectsFromSql(
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, name text NOT NULL);",
      { file: "t.sql" }
    );

    const table = extracted.objects.find((object) => object.key === "table:app.accounts");
    expect(table?.sql).not.toContain("PRIMARY KEY");
    expect(table?.sql).toContain("id bigint NOT NULL");
  });

  it("hashes a declared constraint equal to its ALTER-declared spelling", async () => {
    const inline = await extractObjectsFromSql(
      "CREATE TABLE app.a (id bigint, CONSTRAINT a_pkey PRIMARY KEY (id));",
      { file: "inline.sql" }
    );
    const altered = await extractObjectsFromSql(
      `CREATE TABLE app.a (id bigint NOT NULL);
ALTER TABLE ONLY app.a ADD CONSTRAINT a_pkey PRIMARY KEY (id);`,
      { file: "alter.sql" }
    );

    const inlineConstraint = inline.objects.find((object) => object.key.startsWith("constraint:"));
    const alteredConstraint = altered.objects.find((object) =>
      object.key.startsWith("constraint:")
    );
    expect(inlineConstraint?.key).toBe(alteredConstraint?.key);
    expect(inlineConstraint?.hash).toBe(alteredConstraint?.hash);
    const inlineTable = inline.objects.find((object) => object.key === "table:app.a");
    const alteredTable = altered.objects.find((object) => object.key === "table:app.a");
    expect(inlineTable?.hash).toBe(alteredTable?.hash);
  });

  it("slices CREATE TABLE elements with PostgreSQL lexical rules", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.lexical /* comment ( before elements */ (
  body text DEFAULT $$) , not a boundary$$,
  note text DEFAULT 'literal ) value',
  CONSTRAINT lexical_body_check CHECK (body <> $$)$$)
);`,
      { config: { normalize: "off" }, file: "lexical.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(extracted.objects.map((object) => object.key).sort()).toEqual([
      "constraint:app.lexical_body_check:lexical",
      "table:app.lexical",
    ]);
    const table = extracted.objects.find((object) => object.key === "table:app.lexical");
    expect(table?.metadata.columns).toEqual([
      expect.objectContaining({
        defaultExpression: "$$) , not a boundary$$",
        name: "body",
      }),
      expect.objectContaining({
        defaultExpression: "'literal ) value'",
        name: "note",
      }),
    ]);
  });

  it("extracts every supported ALTER TABLE subcommand in one statement", async () => {
    const extracted = await extractObjectsFromSql(
      "ALTER TABLE app.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id), ENABLE ROW LEVEL SECURITY;",
      { file: "alter.sql" }
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(extracted.objects.map((object) => object.key).sort()).toEqual([
      "constraint:app.accounts_pkey:accounts",
      "rls:app.accounts:accounts",
    ]);
  });

  it("fails closed instead of partially modeling mixed unsupported ALTER TABLE subcommands", async () => {
    const extracted = await extractObjectsFromSql(
      "ALTER TABLE app.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id), ALTER COLUMN id TYPE text;",
      { file: "alter.sql" }
    );

    expect(extracted.objects).toEqual([]);
    expect(extracted.diagnostics.map((item) => item.code)).toContain("SUPA_EXTRACT_UNSUPPORTED");
  });
});
