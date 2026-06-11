import { describe, expect, it } from "vitest";
import { extractObjectsFromSql } from "../src/sql/extract.js";

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
      { config: { adapter: "postgres" }, file: "t.sql" },
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

  it("synthesizes named inline constraints without the CONSTRAINT prefix doubled", async () => {
    const extracted = await extractObjectsFromSql(
      `CREATE TABLE app.accounts (
  id bigint CONSTRAINT "accounts pk" PRIMARY KEY,
  score integer CONSTRAINT score_positive CHECK (score >= 0)
);`,
      { config: { adapter: "postgres" }, file: "t.sql" },
    );

    expect(extracted.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const check = extracted.objects.find((object) => object.key.includes("score_positive"));
    expect(check?.sql).toBe(
      'ALTER TABLE ONLY "app"."accounts" ADD CONSTRAINT "score_positive" CHECK (score >= 0)',
    );
    const pk = extracted.objects.find((object) => object.key.includes("accounts pk"));
    expect(pk?.sql).toBe(
      'ALTER TABLE ONLY "app"."accounts" ADD CONSTRAINT "accounts pk" PRIMARY KEY ("id")',
    );
  });

  it("rebuilds columns-only table SQL with PK-implied NOT NULL preserved", async () => {
    const extracted = await extractObjectsFromSql(
      "CREATE TABLE app.accounts (id bigint PRIMARY KEY, name text NOT NULL);",
      { config: { adapter: "postgres" }, file: "t.sql" },
    );

    const table = extracted.objects.find((object) => object.key === "table:app.accounts");
    expect(table?.sql).not.toContain("PRIMARY KEY");
    expect(table?.sql).toContain("id bigint NOT NULL");
  });

  it("hashes a declared constraint equal to its ALTER-declared spelling", async () => {
    const inline = await extractObjectsFromSql(
      "CREATE TABLE app.a (id bigint, CONSTRAINT a_pkey PRIMARY KEY (id));",
      { config: { adapter: "postgres" }, file: "inline.sql" },
    );
    const altered = await extractObjectsFromSql(
      `CREATE TABLE app.a (id bigint NOT NULL);
ALTER TABLE ONLY app.a ADD CONSTRAINT a_pkey PRIMARY KEY (id);`,
      { config: { adapter: "postgres" }, file: "alter.sql" },
    );

    const inlineConstraint = inline.objects.find((object) => object.key.startsWith("constraint:"));
    const alteredConstraint = altered.objects.find((object) =>
      object.key.startsWith("constraint:"),
    );
    expect(inlineConstraint?.key).toBe(alteredConstraint?.key);
    expect(inlineConstraint?.hash).toBe(alteredConstraint?.hash);
    const inlineTable = inline.objects.find((object) => object.key === "table:app.a");
    const alteredTable = altered.objects.find((object) => object.key === "table:app.a");
    expect(inlineTable?.hash).toBe(alteredTable?.hash);
  });
});
