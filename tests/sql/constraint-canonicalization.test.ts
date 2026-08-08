import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSourceModel } from "../../src/source/extract.js";

async function modelWithTable(definition: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "supa-constraint-canon-"));
  await writeFile(
    join(directory, "schema.sql"),
    `CREATE SCHEMA app;\nCREATE TABLE app.t (${definition});\n`
  );
  const model = await extractSourceModel(`dir:${directory}`);
  return model.fingerprint;
}

function modelWithCheck(check: string): Promise<string> {
  return modelWithTable(`id integer, CHECK (${check})`);
}

describe("constraint predicate canonicalization", () => {
  it("treats = ANY(...) and IN (...) as equivalent", async () => {
    const anyForm = await modelWithCheck("id = ANY(ARRAY[1, 2])");
    const inForm = await modelWithCheck("id IN (1, 2)");
    expect(anyForm).toBe(inForm);
  });

  it("treats <> ALL(...) and NOT IN (...) as equivalent", async () => {
    const allForm = await modelWithCheck("id <> ALL(ARRAY[1, 2])");
    const notInForm = await modelWithCheck("id NOT IN (1, 2)");
    expect(allForm).toBe(notInForm);
  });

  it("keeps = ALL(...) distinct from IN (...)", async () => {
    const allForm = await modelWithCheck("id = ALL(ARRAY[1, 2])");
    const inForm = await modelWithCheck("id IN (1, 2)");
    expect(allForm).not.toBe(inForm);
  });

  it("keeps <> ANY(...) distinct from NOT IN (...)", async () => {
    const anyForm = await modelWithCheck("id <> ANY(ARRAY[1, 2])");
    const notInForm = await modelWithCheck("id NOT IN (1, 2)");
    expect(anyForm).not.toBe(notInForm);
  });

  it("keeps multidimensional ANY arrays distinct from nested IN expressions", async () => {
    const anyForm = await modelWithCheck("id = ANY(ARRAY[[1, 2], [3, 4]])");
    const inForm = await modelWithCheck("id IN (ARRAY[1, 2], ARRAY[3, 4])");
    expect(anyForm).not.toBe(inForm);
  });
});

describe("constant cast canonicalization", () => {
  it("keeps distinct argument cast types separate in the constraint hash", async () => {
    const integerCast = await modelWithCheck("to_json(1::integer)::text = '1'");
    const textCast = await modelWithCheck("to_json(1::text)::text = '1'");
    expect(integerCast).not.toBe(textCast);
  });
});

describe("PostgreSQL 18 column canonicalization", () => {
  it("distinguishes enforced and not-enforced NOT NULL constraints", async () => {
    const enforced = await modelWithTable("id integer NOT NULL");
    const notEnforced = await modelWithTable("id integer NOT NULL NOT ENFORCED");
    expect(enforced).not.toBe(notEnforced);
  });

  it("treats implicit and explicit NOT NULL enforcement identically", async () => {
    const implicit = await modelWithTable("id integer NOT NULL");
    const explicit = await modelWithTable("id integer NOT NULL ENFORCED");
    expect(implicit).toBe(explicit);
  });

  it("distinguishes stored and virtual generated columns", async () => {
    const stored = await modelWithTable("id integer GENERATED ALWAYS AS (1) STORED");
    const virtual = await modelWithTable("id integer GENERATED ALWAYS AS (1) VIRTUAL");
    expect(stored).not.toBe(virtual);
  });
});
