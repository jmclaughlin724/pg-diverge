import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../src/planner.js";
import { extractSourceModel } from "../src/source.js";

const dependents = [
  "ALTER TABLE app.t ADD CONSTRAINT t_value_check CHECK (value > 0);",
  "CREATE INDEX t_value_idx ON app.t (value);",
  "ALTER TABLE app.t ENABLE ROW LEVEL SECURITY;",
  "CREATE POLICY t_read ON app.t FOR SELECT TO authenticated USING (true);",
  "GRANT SELECT ON TABLE app.t TO authenticated;",
].join("\n");

async function modelFromSql(sql: string) {
  const root = await mkdtemp(join(tmpdir(), "pgd-replace-deps-"));
  await writeFile(join(root, "001.sql"), sql);
  return await extractSourceModel(`dir:${root}`);
}

describe("replaced relation dependents", () => {
  it("re-creates unchanged dependents alongside a table replace", async () => {
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`,
    );
    const to = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\n${dependents}\n`,
    );

    const plan = planSchemaDiff(from, to, { config: { destructiveChanges: "allow" } });

    const tableReplace = plan.operations.find(
      (operation) => operation.kind === "replace" && operation.ref.kind === "table",
    );
    expect(tableReplace).toBeDefined();
    const injectedKinds = plan.operations
      .filter((operation) => operation.kind === "create")
      .map((operation) => operation.ref.kind);
    expect(injectedKinds).toContain("constraint");
    expect(injectedKinds).toContain("index");
    expect(injectedKinds).toContain("rls");
    expect(injectedKinds).toContain("policy");
    expect(injectedKinds).toContain("grant");
  });

  it("adds no dependent operations when nothing is replaced", async () => {
    const sql = `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`;
    const from = await modelFromSql(sql);
    const to = await modelFromSql(sql);

    const plan = planSchemaDiff(from, to, { config: { destructiveChanges: "allow" } });

    expect(plan.operations).toHaveLength(0);
  });

  it("does not duplicate dependents that already carry their own operation", async () => {
    const from = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint, value bigint);\n${dependents}\n`,
    );
    const to = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, value bigint);\nALTER TABLE app.t ADD CONSTRAINT t_value_check CHECK (value > 1);\nCREATE INDEX t_value_idx ON app.t (value);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\nCREATE POLICY t_read ON app.t FOR SELECT TO authenticated USING (true);\nGRANT SELECT ON TABLE app.t TO authenticated;\n`,
    );

    const plan = planSchemaDiff(from, to, { config: { destructiveChanges: "allow" } });

    const constraintOps = plan.operations.filter(
      (operation) => operation.ref.kind === "constraint",
    );
    expect(constraintOps).toHaveLength(1);
    expect(constraintOps[0]?.kind).toBe("replace");
  });
});
