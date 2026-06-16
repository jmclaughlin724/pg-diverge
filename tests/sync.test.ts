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
      "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n"
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

  it("refuses apply handoff when workflow.migration_sync is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-disabled-"));

    const result = await syncMigrations({
      config: { workflow: { migration_sync: "disabled" } },
      directory: root,
      local: true,
    });

    expect(result.applied).toBe(false);
    expect(result.report).toContain('workflow.migration_sync is "disabled"');
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_SYNC_DISABLED");
  });

  it.skipIf(process.platform === "win32")(
    "reports an unavailable runner when the Supabase CLI cannot be launched",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "supa-sync-no-cli-"));
      await writeFile(
        join(root, "20260101000000_safe.sql"),
        "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n"
      );
      const oldPath = process.env.PATH;
      process.env.PATH = await mkdtemp(join(tmpdir(), "supa-empty-path-"));
      try {
        const result = await syncMigrations({ directory: root, local: true });

        expect(result.applied).toBe(false);
        expect(result.diagnostics.map((item) => item.code)).toContain(
          "SUPA_SYNC_RUNNER_UNAVAILABLE"
        );
        expect(result.diagnostics.map((item) => item.code)).not.toContain(
          "SUPA_SYNC_RUNNER_FAILED"
        );
      } finally {
        process.env.PATH = oldPath;
      }
    }
  );

  it.skipIf(process.platform === "win32")(
    "preserves the generic runner-failed diagnostic for a real nonzero exit",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "supa-sync-exit-"));
      await writeFile(
        join(root, "20260101000000_safe.sql"),
        "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n"
      );
      const binDir = await mkdtemp(join(tmpdir(), "supa-sync-bin-"));
      await writeFile(join(binDir, "supabase"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
      const oldPath = process.env.PATH;
      process.env.PATH = binDir;
      try {
        const result = await syncMigrations({ directory: root, local: true });

        expect(result.applied).toBe(false);
        expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_SYNC_RUNNER_FAILED");
        expect(result.diagnostics.map((item) => item.code)).not.toContain(
          "SUPA_SYNC_RUNNER_UNAVAILABLE"
        );
        expect(
          result.diagnostics.find((item) => item.code === "SUPA_SYNC_RUNNER_FAILED")?.message
        ).toContain("exited with code 42");
      } finally {
        process.env.PATH = oldPath;
      }
    }
  );
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
        "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY)"
      );
      await target.query(
        "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20250101000000')"
      );
      await target.end();
      const root = await mkdtemp(join(tmpdir(), "supa-sync-ghost-"));
      await writeFile(
        join(root, "20260101000000_one.sql"),
        "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n"
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
