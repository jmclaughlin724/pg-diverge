import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../src/check.js";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractSourceModel } from "../src/source.js";

const messyTree =
  "create   SCHEMA app;\nCREATE TABLE app.t (\n      id   BIGINT primary key,\n  name VARCHAR(20)   default 'x'\n);\ncreate index if not exists t_name_idx on app.t (name);\nREVOKE   usage ON SCHEMA app FROM public;\nREVOKE create ON SCHEMA app FROM public;\n";
const tidyTree =
  "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint PRIMARY KEY, name varchar(20) DEFAULT 'x');\nCREATE INDEX IF NOT EXISTS t_name_idx ON app.t (name);\nREVOKE ALL ON SCHEMA app FROM PUBLIC;\n";

async function treeDir(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pgd-norm-"));
  await writeFile(join(root, "001.sql"), sql);
  return root;
}

describe("deparse normalization (tier 2, opt-in)", () => {
  it("renders byte-identical migrations from differently formatted equivalent trees", async () => {
    const config = { normalize: "deparse" as const };
    const empty = await treeDir("");
    const from = await extractSourceModel(`dir:${empty}`, { config });
    const messy = await extractSourceModel(`dir:${await treeDir(messyTree)}`, { config });
    const tidy = await extractSourceModel(`dir:${await treeDir(tidyTree)}`, { config });

    expect(messy.fingerprint).toBe(tidy.fingerprint);
    const messyOut = renderMigration(planSchemaDiff(from, messy));
    const tidyOut = renderMigration(planSchemaDiff(from, tidy));
    expect(stripHeader(messyOut)).toBe(stripHeader(tidyOut));
    expect(messyOut).toContain("CREATE TABLE IF NOT EXISTS app.t");
    expect(messyOut.match(/IF NOT EXISTS t_name_idx/gu)).toHaveLength(1);
  });

  it("does not change object hashes relative to normalize: off", async () => {
    const root = await treeDir(messyTree);
    const off = await extractSourceModel(`dir:${root}`);
    const on = await extractSourceModel(`dir:${root}`, {
      config: { normalize: "deparse" },
    });

    expect(on.fingerprint).toBe(off.fingerprint);
    const offTable = off.objects.find((object) => object.ref.kind === "table");
    const onTable = on.objects.find((object) => object.ref.kind === "table");
    expect(onTable?.hash).toBe(offTable?.hash);
    expect(onTable?.sql).not.toBe(offTable?.sql);
    expect(onTable?.sql).toContain("varchar(20)");
  });
});

describe("deparse round-trip proof (tier 1, always on)", () => {
  it("reports no fidelity findings for a rendered migration", async () => {
    const from = await extractSourceModel(`dir:${await treeDir("")}`);
    const to = await extractSourceModel("dir:tests/fixtures/realshape/tree");
    const rendered = renderMigration(planSchemaDiff(from, to));

    const diagnostics = await checkMigrationSql(rendered);

    expect(
      diagnostics.filter(
        (item) =>
          item.code === "PD_CHECK_DEPARSE_MISMATCH" || item.code === "PD_CHECK_DEPARSE_UNSUPPORTED",
      ),
    ).toEqual([]);
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});

function stripHeader(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
}
