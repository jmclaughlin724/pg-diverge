import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/schema.js";
import { readMigrationIntent } from "../src/migrations/intent.js";
import { buildSchemaDiffPlan } from "../src/pipeline/diff.js";
import { renderMigration } from "../src/render/migration.js";

describe("migration-derived source intent", () => {
  it("uses existing migrations to release reviewed column drops", async () => {
    const root = await migrationIntentFixture({
      migrationSql: `
        DROP FUNCTION app.legacy_secret(p_ciphertext bytea);
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
    const root = await migrationIntentFixture({ migrationSql: "" });

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
    const root = await migrationIntentFixture({ migrationSql: "" });

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

  it("does not promote migration-intent parse failures to plan errors", async () => {
    const root = await migrationIntentFixture({ migrationSql: "CREATE TABLE" });

    const intent = await readMigrationIntent("migrations", { cwd: root });

    expect(intent.diagnostics).toEqual([
      expect.objectContaining({
        code: "SUPA_MIGRATION_INTENT_PARSE_SKIPPED",
        severity: "warning",
      }),
    ]);
  });

  it("treats standard DROP ROUTINE as function and procedure destructive intent", async () => {
    const root = await migrationIntentFixture({
      migrationSql: "DROP ROUTINE app.legacy_secret(bytea);",
    });

    const intent = await readMigrationIntent("migrations", { cwd: root });

    expect(intent.destructiveKeys).toContain("function:app.legacy_secret(bytea)");
    expect(intent.destructiveKeys).toContain("procedure:app.legacy_secret(bytea)");
  });
});

async function migrationIntentFixture(options: { migrationSql: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-migration-intent-"));
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
