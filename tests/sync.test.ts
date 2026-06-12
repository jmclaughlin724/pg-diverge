import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../src/database-url.js";
import { syncMigrations } from "../src/sync.js";

const databaseUrl = process.env.SUPASCHEMA_TEST_DATABASE_URL ?? resolveDatabaseUrl();

describe("sync (no target)", () => {
  it("dry-runs pending files after the replay-safety gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-"));
    await writeFile(
      join(root, "20260101000000_safe.sql"),
      "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n",
    );

    const result = await syncMigrations({ directory: root });

    expect(result.applied).toBe(false);
    expect(result.pending).toEqual(["20260101000000_safe.sql"]);
    expect(result.report).toContain("dry run");
    expect(result.report).toContain("replay-safe");
  });

  it("refuses when a pending migration fails the replay-safety check", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-bad-"));
    await writeFile(join(root, "20260101000000_unsafe.sql"), "DROP TABLE app.t;\n");

    const result = await syncMigrations({ directory: root });

    expect(result.applied).toBe(false);
    expect(result.report).toContain("refusing to sync");
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });
});

describe.skipIf(!databaseUrl)("sync (against a target)", () => {
  it("refuses on ghost history", async () => {
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    const db = `supa_sync_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const url = new URL(databaseUrl as string);
    url.pathname = `/${db}`;
    try {
      const target = new Client({ connectionString: url.toString() });
      await target.connect();
      await target.query("CREATE SCHEMA supabase_migrations");
      await target.query(
        "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY)",
      );
      await target.query(
        "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20250101000000')",
      );
      await target.end();
      const root = await mkdtemp(join(tmpdir(), "supa-sync-ghost-"));
      await writeFile(
        join(root, "20260101000000_one.sql"),
        "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n",
      );

      const result = await syncMigrations({
        databaseUrl: url.toString(),
        directory: root,
        local: true,
      });

      expect(result.applied).toBe(false);
      expect(result.report).toContain("ghost or out-of-order");
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
  });
});
