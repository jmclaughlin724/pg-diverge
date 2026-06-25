import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/schema.js";
import { readMigrationContext } from "../src/migrations/context.js";
import { buildSchemaDiffPlan } from "../src/pipeline/diff.js";
import { renderMigration } from "../src/render/migration.js";

describe("migration-derived source corpus", () => {
  it("uses existing migrations to release reviewed column drops", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: `
        DROP FUNCTION app.legacy_secret(p_ciphertext bytea);
        UPDATE app.credentials SET encrypted_value = encrypted_value;
        ALTER TABLE app.credentials DROP COLUMN encrypted_value;
      `,
    });

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED"
    );
    expect(
      plan.operations.find((operation) => operation.key === "table:app.credentials")
    ).toMatchObject({
      blocked: false,
      destructive: true,
    });
    expect(
      plan.operations.find((operation) => operation.key === "function:app.legacy_secret(bytea)")
    ).toMatchObject({
      blocked: false,
      destructive: true,
    });

    const sql = renderMigration(plan, { includeHeader: false });
    expect(sql).toContain('"disposition":"migration-intent"');
    expect(sql).toContain('"key":"table:app.credentials"');
    expect(sql).toContain('"key":"function:app.legacy_secret(bytea)"');
  });

  it("does not plan independent grant cleanup for dropped function targets", async () => {
    const root = await migrationCorpusFixture({ migrationSql: "" });

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.operations.map((operation) => operation.key)).not.toContain(
      "grant:app.revoke:function:app.legacy_secret(bytea):PUBLIC"
    );
  });

  it("still blocks column drops when existing migrations do not declare them", async () => {
    const root = await migrationCorpusFixture({ migrationSql: "" });

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED"
    );
  });

  it("blocks storage transitions when the corpus lacks reviewed data movement intent", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: "ALTER TABLE app.credentials DROP COLUMN encrypted_value;",
    });

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_DATA_TRANSITION_REQUIRED"
    );
    expect(
      plan.operations.find((operation) => operation.key === "table:app.credentials")
    ).toMatchObject({
      blocked: true,
    });
  });

  it("uses the selected migrations directory for source intent", async () => {
    const root = await migrationCorpusFixture({ migrationSql: "" });
    await mkdir(join(root, "selected-migrations"), { recursive: true });
    await writeFile(
      join(root, "selected-migrations", "20260102000000_existing.sql"),
      "UPDATE app.credentials SET encrypted_value = encrypted_value;\nALTER TABLE app.credentials DROP COLUMN encrypted_value;"
    );

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      migrationsDir: "selected-migrations",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.diagnostics.map((item) => item.code)).not.toContain(
      "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED"
    );
    expect(
      plan.operations.find((operation) => operation.key === "table:app.credentials")
    ).toMatchObject({
      blocked: false,
      metadata: expect.objectContaining({ destructiveDisposition: "migration-intent" }),
    });
  });

  it("does not use stale config-dir intent when a different migrations directory is selected", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: "ALTER TABLE app.credentials DROP COLUMN encrypted_value;",
    });
    await mkdir(join(root, "selected-migrations"), { recursive: true });

    const plan = await buildSchemaDiffPlan({
      config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["to"] }),
      cwd: root,
      from: "dir:from",
      migrationsDir: "selected-migrations",
      schema: "app",
      to: "dir:to",
    });

    expect(plan.diagnostics.map((item) => item.code)).toContain(
      "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED"
    );
  });

  it("does not promote migration-corpus parse failures to plan errors", async () => {
    const root = await migrationCorpusFixture({ migrationSql: "CREATE TABLE" });

    const { corpus } = await readMigrationContext("migrations", { cwd: root });

    expect(corpus.diagnostics).toEqual([
      expect.objectContaining({
        code: "SUPA_MIGRATION_CORPUS_PARSE_SKIPPED",
        severity: "warning",
      }),
    ]);
  });

  it("treats standard DROP ROUTINE as function and procedure destructive intent", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: "DROP ROUTINE app.legacy_secret(bytea);",
    });

    const { corpus } = await readMigrationContext("migrations", { cwd: root });

    expect(corpus.destructiveKeys).toContain("function:app.legacy_secret(bytea)");
    expect(corpus.destructiveKeys).toContain("procedure:app.legacy_secret(bytea)");
  });

  it("records data, DO, generated, identity, default, constraint, type, index, and enum source facts", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: `
        DO $$ begin perform 1; end $$;
        INSERT INTO app.credentials (id) VALUES (1) ON CONFLICT DO NOTHING;
        ALTER TYPE app.status ADD VALUE IF NOT EXISTS 'active';
        ALTER TABLE app.credentials ALTER COLUMN encrypted_value TYPE text;
        ALTER TABLE app.credentials ALTER COLUMN encrypted_value SET DEFAULT '';
        ALTER TABLE app.credentials ALTER COLUMN encrypted_value ADD GENERATED ALWAYS AS IDENTITY;
        ALTER TABLE app.credentials ALTER COLUMN encrypted_value DROP EXPRESSION IF EXISTS;
        ALTER TABLE app.credentials ADD CONSTRAINT credentials_id_check CHECK (id > 0);
        CREATE INDEX IF NOT EXISTS credentials_id_idx ON app.credentials (id);
      `,
    });

    const { corpus } = await readMigrationContext("migrations", { cwd: root });
    const kinds = corpus.operations.map((operation) => operation.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        "constraint",
        "data-statement",
        "do-block",
        "enum-rewrite",
        "index",
        "table-column-default",
        "table-column-generated",
        "table-column-identity",
        "table-column-type",
      ])
    );
  });

  it("tracks generated lineage as baseline proof and later hand-authored files as unproven", async () => {
    const root = await migrationCorpusFixture({
      migrationSql: "-- supaschema: lineage from=abc to=def\nSELECT 1;",
    });
    await writeFile(join(root, "migrations", "20260102000000_hand.sql"), "SELECT 2;");

    const context = await readMigrationContext("migrations", { cwd: root });

    expect(context.latestGeneratedBaseline).toMatchObject({
      fingerprint: "def",
      version: "20260101000000",
    });
    expect(context.unprovenBaselineFiles.map((file) => file.split("/").at(-1))).toEqual([
      "20260102000000_hand.sql",
    ]);
  });
});

async function migrationCorpusFixture(options: { migrationSql: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-migration-corpus-"));
  await mkdir(join(root, "from"), { recursive: true });
  await mkdir(join(root, "to"), { recursive: true });
  await mkdir(join(root, "migrations"), { recursive: true });
  await writeFile(
    join(root, "from", "schema.sql"),
    `
      CREATE SCHEMA app;
      CREATE TABLE app.credentials (
        id uuid PRIMARY KEY,
        encrypted_value bytea
      );
      CREATE FUNCTION app.legacy_secret(p_ciphertext bytea)
      RETURNS text
      LANGUAGE sql
      AS $$ SELECT encode(p_ciphertext, 'hex') $$;
      REVOKE ALL ON FUNCTION app.legacy_secret(p_ciphertext bytea) FROM PUBLIC;
    `
  );
  await writeFile(
    join(root, "to", "schema.sql"),
    `
      CREATE SCHEMA app;
      CREATE TABLE app.credentials (
        id uuid PRIMARY KEY,
        secret_id uuid
      );
    `
  );
  await writeFile(join(root, "migrations", "20260101000000_existing.sql"), options.migrationSql);
  return root;
}
