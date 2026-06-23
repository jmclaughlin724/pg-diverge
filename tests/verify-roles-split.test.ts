import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import type { SchemaModel } from "../src/core.js";
import { resolveDatabaseUrl } from "../src/database/url.js";
import { planSchemaDiff } from "../src/planner/schema.js";
import { renderMigrationSplit } from "../src/render/migration.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";
import { supabaseEnvironmentStubSql } from "../src/verify/environment.js";
import { verifyMigration } from "../src/verify/migration.js";

const databaseUrl = process.env.SUPASCHEMA_TEST_DATABASE_URL ?? resolveDatabaseUrl();

async function model(sql: string, source: string): Promise<SchemaModel> {
  const extracted = await extractObjectsFromSql(sql, { config: { managedSchemas: [] } });
  const errors = extracted.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  return { diagnostics: [], fingerprint: source, objects: extracted.objects, source };
}

describe("concurrent index split rendering", () => {
  it("moves CONCURRENTLY statements to a companion script for per-statement runners", async () => {
    const from = await model("CREATE TABLE app.items (id integer);", "test:from");
    const to = await model(
      "CREATE TABLE app.items (id integer);\nCREATE INDEX CONCURRENTLY items_idx ON app.items (id);",
      "test:to"
    );
    const plan = planSchemaDiff(from, to, { config: { transactionMode: "per-statement" } });
    const rendered = renderMigrationSplit(plan, {
      config: { transactionMode: "per-statement" },
      includeHeader: false,
    });

    expect(rendered.concurrentSql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS items_idx");
    expect(rendered.concurrentSql).toContain("outside a transaction");
    expect(rendered.sql).not.toContain("CONCURRENTLY");
  });

  it("returns a single script when no concurrent statements exist", async () => {
    const from: SchemaModel = {
      diagnostics: [],
      fingerprint: "test:from",
      objects: [],
      source: "test:from",
    };
    const to = await model("CREATE TABLE app.items (id integer);", "test:to");
    const plan = planSchemaDiff(from, to);
    const rendered = renderMigrationSplit(plan, { includeHeader: false });

    expect(rendered.concurrentSql).toBeUndefined();
    expect(rendered.sql).toContain("CREATE TABLE IF NOT EXISTS app.items");
  });
});

describe.skipIf(!databaseUrl)("verify role pre-creation", () => {
  it("fails without --ensure-roles and passes with it for grants to missing roles", {
    timeout: 60_000,
  }, async () => {
    if (!databaseUrl) {
      return;
    }
    const role = `supa_wave_d_role_${process.pid}`;
    const directory = await mkdtemp(join(tmpdir(), "supa-roles-"));
    const fromSql = "CREATE SCHEMA app;";
    const toSql = [
      "CREATE SCHEMA app;",
      "CREATE TABLE app.items (id integer);",
      `GRANT SELECT ON TABLE app.items TO ${role};`,
    ].join("\n");
    await writeFile(join(directory, "from.sql"), fromSql);
    await writeFile(join(directory, "to.sql"), toSql);
    const migrationPath = join(directory, "migration.sql");
    await writeFile(
      migrationPath,
      `CREATE TABLE IF NOT EXISTS app.items (id integer);\nGRANT SELECT ON TABLE app.items TO ${role};\n`
    );
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      const baseOptions = {
        config: { managedSchemas: [] },
        databaseUrl,
        from: `dump:${join(directory, "from.sql")}`,
        migrationPath,
        to: `dump:${join(directory, "to.sql")}`,
      };
      const withoutRoles = await verifyMigration(baseOptions);
      expect(withoutRoles.some((item) => item.severity === "error")).toBe(true);

      const withRoles = await verifyMigration({ ...baseOptions, ensureRoles: true });
      expect(withRoles.filter((item) => item.severity === "error")).toEqual([]);

      const exists = await admin.query("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", [
        role,
      ]);
      expect(exists.rows).toHaveLength(1);
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch((error) => {
        console.error("wave-d role cleanup failed", error);
      });
      await admin.end();
    }
  });
});

describe("verify environment stub surface", () => {
  it("stubs the stable GoTrue auth.users column set so references resolve", () => {
    for (const column of [
      "role varchar",
      "email varchar",
      "phone text",
      "raw_app_meta_data jsonb",
      "raw_user_meta_data jsonb",
      "last_sign_in_at timestamptz",
      "is_anonymous boolean",
    ]) {
      expect(supabaseEnvironmentStubSql).toContain(column);
    }
  });
});

describe.skipIf(!databaseUrl)("verify managed-schema stub", () => {
  it("flags a failure referencing an un-stubbed managed schema", {
    timeout: 60_000,
  }, async () => {
    if (!databaseUrl) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "supa-stub-storage-"));
    const policy =
      "CREATE POLICY items_select ON app.items FOR SELECT TO public USING (EXISTS (SELECT 1 FROM storage.objects));";
    await writeFile(join(directory, "from.sql"), "CREATE SCHEMA app;");
    await writeFile(
      join(directory, "to.sql"),
      [
        "CREATE SCHEMA app;",
        "CREATE TABLE app.items (id integer);",
        "ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;",
        policy,
      ].join("\n")
    );
    const migrationPath = join(directory, "migration.sql");
    await writeFile(
      migrationPath,
      [
        "CREATE TABLE IF NOT EXISTS app.items (id integer);",
        "ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS items_select ON app.items;",
        policy,
      ].join("\n")
    );
    const diagnostics = await verifyMigration({
      config: { managedSchemas: ["auth", "storage"] },
      databaseUrl,
      ensureEnvironment: true,
      from: `dump:${join(directory, "from.sql")}`,
      migrationPath,
      to: `dump:${join(directory, "to.sql")}`,
    });
    const stub = diagnostics.find((item) => item.code === "SUPA_VERIFY_STUB_REFERENCE");
    expect(stub).toBeDefined();
    expect(stub?.message).toContain("storage");
  });
});

describe.skipIf(!databaseUrl)("verify policy subquery reconvergence", () => {
  it("converges a policy whose subquery references its own relation", {
    timeout: 60_000,
  }, async () => {
    if (!databaseUrl) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "supa-policy-subq-"));
    const policy =
      "CREATE POLICY items_sel ON app.items FOR SELECT TO public USING (id IN (SELECT item_id FROM app.members));";
    await writeFile(join(directory, "from.sql"), "CREATE SCHEMA app;");
    await writeFile(
      join(directory, "to.sql"),
      [
        "CREATE SCHEMA app;",
        "CREATE TABLE app.members (item_id integer);",
        "CREATE TABLE app.items (id integer);",
        "ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;",
        policy,
      ].join("\n")
    );
    const migrationPath = join(directory, "migration.sql");
    await writeFile(
      migrationPath,
      [
        "CREATE TABLE IF NOT EXISTS app.members (item_id integer);",
        "CREATE TABLE IF NOT EXISTS app.items (id integer);",
        "ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS items_sel ON app.items;",
        policy,
      ].join("\n")
    );
    const diagnostics = await verifyMigration({
      config: { managedSchemas: [] },
      databaseUrl,
      from: `dump:${join(directory, "from.sql")}`,
      migrationPath,
      to: `dump:${join(directory, "to.sql")}`,
    });
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});

describe("verify remote-database guard", () => {
  it("refuses non-local hosts without SUPASCHEMA_VERIFY_ALLOW_REMOTE", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supa-remote-guard-"));
    await writeFile(join(directory, "from.sql"), "CREATE SCHEMA app;");
    await writeFile(join(directory, "to.sql"), "CREATE SCHEMA app;");
    const migrationPath = join(directory, "migration.sql");
    await writeFile(migrationPath, "CREATE SCHEMA IF NOT EXISTS app;\n");

    const diagnostics = await verifyMigration({
      databaseUrl: "postgresql://postgres:postgres@db.example.com:5432/postgres",
      from: `dump:${join(directory, "from.sql")}`,
      migrationPath,
      to: `dump:${join(directory, "to.sql")}`,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_VERIFY_FAILED");
    expect(diagnostics[0]?.message).toContain("db.example.com");
    expect(diagnostics[0]?.hint).toContain("SUPASCHEMA_VERIFY_ALLOW_REMOTE");
  });
});

describe.skipIf(!databaseUrl)("CLI concurrent companion file", () => {
  it("writes the .concurrent.sql companion when diffing to a file", {
    timeout: 30_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "supa-split-"));
    await writeFile(join(directory, "from.sql"), "CREATE TABLE app.items (id integer);");
    await writeFile(
      join(directory, "to.sql"),
      "CREATE TABLE app.items (id integer);\nCREATE INDEX CONCURRENTLY items_idx ON app.items (id);"
    );
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const outPath = join(directory, "migration.sql");
    const configPath = join(directory, "supaschema.config.json");
    await writeFile(configPath, JSON.stringify({ transactionMode: "per-statement" }));
    await run("node", [
      "dist/cli.js",
      "--config",
      configPath,
      "diff",
      "--from",
      `dump:${join(directory, "from.sql")}`,
      "--to",
      `dump:${join(directory, "to.sql")}`,
      "--out",
      outPath,
    ]);

    const main = await readFile(outPath, "utf8");
    const concurrent = await readFile(join(directory, "migration.concurrent.sql"), "utf8");
    expect(main).not.toContain("CONCURRENTLY");
    expect(concurrent).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS items_idx");
  });
});
