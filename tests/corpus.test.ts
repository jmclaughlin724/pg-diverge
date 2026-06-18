import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCorpus } from "../src/corpus.js";
import { resolveDatabaseUrl } from "../src/database-url.js";

const databaseUrl = process.env.SUPASCHEMA_TEST_DATABASE_URL ?? resolveDatabaseUrl();
const committedCorpus = resolve(import.meta.dirname, "../corpus/supabase-style");

describe.skipIf(!databaseUrl)("corpus oracle", () => {
  it("converges on the committed supabase-style corpus", async () => {
    const { diagnostics, report } = await runCorpus({
      corpusDir: committedCorpus,
      databaseUrl,
    });

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(report.appliedMigrations.length).toBeGreaterThan(0);
    expect(report.idempotent).toBe(true);
    expect(report.reconvergenceResidual).toEqual([]);
  });

  it("fails loud when the tree declares state the catalog cannot reproduce", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-corpus-dirty-"));
    await mkdir(join(root, "migrations"));
    await mkdir(join(root, "tree"));
    await writeFile(
      join(root, "corpus.json"),
      JSON.stringify({ adapter: "auto", schemas: { exclude: [], include: ["app"] } })
    );
    await writeFile(
      join(root, "migrations", "20260101000000_init.sql"),
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint PRIMARY KEY);\n"
    );

    await writeFile(
      join(root, "tree", "tables.sql"),
      "create schema app;\ncreate table app.t (id bigint primary key);\ncomment on column app.missing.col is 'ghost';\n"
    );

    const { diagnostics } = await runCorpus({
      corpusDir: root,
      databaseUrl,
    });

    expect(diagnostics.some((item) => item.severity === "error")).toBe(true);
  });
});
