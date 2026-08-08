import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSourceModel } from "../../src/source/extract.js";

async function modelWithCheck(check: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "supa-constraint-canon-"));
  await writeFile(
    join(directory, "schema.sql"),
    `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer, CHECK (${check}));\n`
  );
  const model = await extractSourceModel(`dir:${directory}`);
  return model.fingerprint;
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
});

describe("constant cast canonicalization", () => {
  it("keeps distinct argument cast types separate in the constraint hash", async () => {
    const integerCast = await modelWithCheck("to_json(1::integer)::text = '1'");
    const textCast = await modelWithCheck("to_json(1::text)::text = '1'");
    expect(integerCast).not.toBe(textCast);
  });
});
