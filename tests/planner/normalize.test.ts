import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../../src/check/migration.js";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { renderMigration } from "../../src/render/migration.js";
import { extractSourceModel } from "../../src/source/extract.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";

const messyTree =
  "create   SCHEMA app;\nCREATE TABLE app.t (\n      id   BIGINT primary key,\n  name VARCHAR(20)   default 'x'\n);\ncreate index if not exists t_name_idx on app.t (name);\nREVOKE   usage ON SCHEMA app FROM public;\nREVOKE create ON SCHEMA app FROM public;\n";
const tidyTree =
  "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint PRIMARY KEY, name varchar(20) DEFAULT 'x');\nCREATE INDEX IF NOT EXISTS t_name_idx ON app.t (name);\nREVOKE ALL ON SCHEMA app FROM PUBLIC;\n";

async function treeDir(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-norm-"));
  await writeFile(join(root, "001.sql"), sql);
  return root;
}

describe("deparse normalization (tier 2, opt-in)", () => {
  it("renders byte-identical migrations from differently formatted equivalent trees", async () => {
    const config = { normalize: "deparse" };
    const empty = await treeDir("");
    const from = await extractSourceModel(`dir:${empty}`, { config });
    const messy = await extractSourceModel(`dir:${await treeDir(messyTree)}`, { config });
    const tidy = await extractSourceModel(`dir:${await treeDir(tidyTree)}`, { config });

    expect(messy.fingerprint).toBe(tidy.fingerprint);
    const messyOut = renderMigration(planSchemaDiff(from, messy));
    const tidyOut = renderMigration(planSchemaDiff(from, tidy));
    expect(stripHeader(messyOut)).toBe(stripHeader(tidyOut));
    expect(messyOut).toContain("CREATE TABLE IF NOT EXISTS app.t");
    expect(countOccurrences(messyOut, "IF NOT EXISTS t_name_idx")).toBe(1);
  });

  it("does not change object hashes relative to normalize: off", async () => {
    const root = await treeDir(messyTree);
    const off = await extractSourceModel(`dir:${root}`, {
      config: { normalize: "off" },
    });
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

  it("does not warn for known third-party deparser gaps", async () => {
    const extracted = await extractObjectsFromSql(
      `
      CREATE SCHEMA app;
      CREATE TYPE app.mood AS ENUM ('ok');
      GRANT USAGE ON TYPE app.mood TO authenticated;
      CREATE FOREIGN DATA WRAPPER "app_fdw" HANDLER "extensions"."fdw_handler" VALIDATOR "extensions"."fdw_validator";
      CREATE TABLE app.events (
        id bigint NOT NULL,
        created_at timestamp with time zone NOT NULL,
        payload jsonb,
        CONSTRAINT events_payload_shape CHECK (((payload IS NULL) OR app.jsonb_matches_schema('{"type":"object"}', payload)))
      ) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (
        id bigint NOT NULL,
        created_at timestamp with time zone NOT NULL,
        payload jsonb
      );
      ALTER TABLE app.events ATTACH PARTITION app.events_2026_01
        FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
    `,
      { config: { normalize: "deparse" } }
    );

    expect(
      extracted.diagnostics.filter(
        (item) =>
          item.code === "SUPA_NORMALIZE_FIDELITY" || item.code === "SUPA_NORMALIZE_UNSUPPORTED"
      )
    ).toEqual([]);
  });
});

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    const found = value.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
  return count;
}

describe("deparse round-trip proof (tier 1, always on)", () => {
  it("reports no fidelity findings for a rendered migration", async () => {
    const from = await extractSourceModel(`dir:${await treeDir("")}`);
    const to = await extractSourceModel("dir:tests/fixtures/realshape/tree");
    const rendered = renderMigration(planSchemaDiff(from, to));

    const diagnostics = await checkMigrationSql(rendered);

    expect(
      diagnostics.filter(
        (item) =>
          item.code === "SUPA_CHECK_DEPARSE_MISMATCH" ||
          item.code === "SUPA_CHECK_DEPARSE_UNSUPPORTED"
      )
    ).toEqual([]);
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("does not warn for known deparser gaps during migration checks", async () => {
    const diagnostics = await checkMigrationSql(`
      DROP POLICY IF EXISTS "tenant read" ON "app"."accounts";
      GRANT ALL ON TYPE "app"."mood" TO "authenticated";
    `);

    expect(
      diagnostics.filter(
        (item) =>
          item.code === "SUPA_CHECK_DEPARSE_MISMATCH" ||
          item.code === "SUPA_CHECK_DEPARSE_UNSUPPORTED"
      )
    ).toEqual([]);
  });
});

function stripHeader(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
}
