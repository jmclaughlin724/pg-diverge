import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { extractSourceModel } from "../../src/source/extract.js";

async function modelFromSql(sql: string) {
  const root = await mkdtemp(join(tmpdir(), "supa-replaced-rel-"));
  await writeFile(join(root, "001.sql"), sql);
  return extractSourceModel(`dir:${root}`);
}

describe("replaced relation grant handling", () => {
  it("does not emit a destructive-hint diagnostic for a grant drop suppressed by a table replace", async () => {
    const from = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT SELECT ON TABLE app.t TO authenticated;\n"
    );
    const to = await modelFromSql("CREATE SCHEMA app;\nCREATE UNLOGGED TABLE app.t (id bigint);\n");

    const plan = planSchemaDiff(from, to, { config: { hints: { destructive: ["table:app.t"] } } });

    const suppressedGrantHint = plan.diagnostics.filter(
      (item) => item.code === "SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED"
    );
    expect(suppressedGrantHint).toEqual([]);
  });

  it("recreates unchanged grants after a foreign-table replacement", async () => {
    const from = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE FOREIGN TABLE app.t (id bigint) SERVER app_server;\nGRANT SELECT ON TABLE app.t TO authenticated;\n"
    );
    const to = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE FOREIGN TABLE app.t (id integer) SERVER app_server;\nGRANT SELECT ON TABLE app.t TO authenticated;\n"
    );

    const plan = planSchemaDiff(from, to, {
      config: { hints: { destructive: ["foreign-table:app.t"] } },
    });
    const grantOperations = plan.operations.filter((operation) => operation.ref.kind === "grant");

    expect(grantOperations.map((operation) => operation.kind)).toContain("create");
  });
});
