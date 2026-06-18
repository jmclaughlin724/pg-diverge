import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../src/database-url.js";
import { diagnosticCatalog } from "../src/diagnostics.js";
import { syncMigrations } from "../src/workflow.js";

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
      target: "local",
    });

    expect(result.applied).toBe(false);
    expect(result.report).toContain('workflow.migration_sync is "disabled"');
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_SYNC_DISABLED");
  });

  it("refuses explicit target override when workflow.migration_sync is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-disabled-target-"));

    const result = await syncMigrations({
      config: { workflow: { migration_sync: "disabled" } },
      directory: root,
      pipeline: true,
      skipDiff: true,
      target: "local",
    });

    expect(result.applied).toBe(false);
    expect(result.report).toContain('workflow.migration_sync is "disabled"');
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_SYNC_DISABLED");
  });

  it("refuses an explicit named target that is not configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-unknown-target-"));

    const result = await syncMigrations({
      config: {
        sources: { from: "empty:", to: "empty:" },
        workflow: { rls_safety: "disabled", type_safety: "disabled" },
      },
      directory: root,
      pipeline: true,
      skipDiff: true,
      target: "staging",
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_SYNC_TARGET_UNKNOWN");
    expect(result.report).toContain("target resolution failed");
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
        const result = await syncMigrations({
          config: {
            sources: { from: "empty:", to: "empty:" },
            sync: {
              targets: {
                local: {
                  historyTable: "supabase_migrations.schema_migrations",
                  mode: "manual",
                  runner: "supabase-cli",
                },
              },
            },
            workflow: { rls_safety: "disabled", type_safety: "disabled" },
          },
          directory: root,
          pipeline: true,
          skipDiff: true,
          target: "local",
        });

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
        const result = await syncMigrations({
          config: {
            sources: { from: "empty:", to: "empty:" },
            sync: {
              targets: {
                local: {
                  historyTable: "supabase_migrations.schema_migrations",
                  mode: "manual",
                  runner: "supabase-cli",
                },
              },
            },
            workflow: { rls_safety: "disabled", type_safety: "disabled" },
          },
          directory: root,
          pipeline: true,
          skipDiff: true,
          target: "local",
        });

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

describe("sync diagnostics", () => {
  it("keeps sync diagnostic codes explainable", () => {
    expect(diagnosticCatalog.SUPA_SYNC_DISABLED).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_ENV_UNKNOWN).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_FINAL_RECONCILE_FAILED).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_REMOTE_APPROVAL_REQUIRED).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_RUNNER_FAILED).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_RUNNER_UNAVAILABLE).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_TARGET_OVERRIDE_MULTI).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_TARGET_UNKNOWN).toBeDefined();
    expect(diagnosticCatalog.SUPA_SYNC_TARGET_URL_UNRESOLVED).toBeDefined();
    expect(diagnosticCatalog.SUPA_DIFF_LINEAGE_GAP).toBeDefined();
  });
});

describe("sync pipeline orchestration", () => {
  it("requires runtime approval before automatic remote deploy", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-remote-approval-"));
    const result = await syncMigrations({
      config: {
        sync: {
          targets: {
            remote: {
              databaseUrl: "postgresql://postgres:postgres@example.test/postgres",
              historyTable: "supabase_migrations.schema_migrations",
              mode: "auto",
              remote: true,
              requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
              runner: "direct",
            },
          },
        },
        workflow: {
          rls_safety: "disabled",
          type_safety: "disabled",
        },
      },
      directory: root,
      pipeline: true,
      skipDiff: true,
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "SUPA_SYNC_REMOTE_APPROVAL_REQUIRED"
    );
    expect(result.report).toContain("target resolution failed");
  });

  it("selects automatic targets from target mode rather than target name", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-target-mode-"));
    const result = await syncMigrations({
      config: {
        sync: {
          targets: {
            local: {
              databaseUrl: "$SUPASCHEMA_MISSING_LOCAL_URL",
              historyTable: "supabase_migrations.schema_migrations",
              mode: "manual",
              runner: "direct",
            },
            preview: {
              databaseUrl: "$SUPASCHEMA_MISSING_PREVIEW_URL",
              historyTable: "supabase_migrations.schema_migrations",
              mode: "auto",
              runner: "direct",
            },
          },
        },
        workflow: {
          rls_safety: "disabled",
          type_safety: "disabled",
        },
      },
      directory: root,
      pipeline: true,
      skipDiff: true,
    });

    const messages = result.diagnostics.map((item) => item.message).join("\n");
    expect(result.applied).toBe(false);
    expect(messages).toContain("SUPASCHEMA_MISSING_PREVIEW_URL");
    expect(messages).not.toContain("SUPASCHEMA_MISSING_LOCAL_URL");
  });

  it("refuses --env override when multiple targets are selected", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-sync-env-multi-"));
    const result = await syncMigrations({
      config: {
        environments: {
          local: { databaseUrl: "$LOCAL_DATABASE_URL" },
        },
        workflow: {
          rls_safety: "disabled",
          type_safety: "disabled",
        },
        sync: {
          targets: {
            local: {
              environment: "local",
              historyTable: "supabase_migrations.schema_migrations",
              mode: "auto",
              runner: "direct",
            },
            remote: {
              environment: "local",
              historyTable: "supabase_migrations.schema_migrations",
              mode: "auto",
              runner: "direct",
            },
          },
        },
      },
      directory: root,
      envName: "local",
      pipeline: true,
      skipDiff: true,
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "SUPA_SYNC_TARGET_OVERRIDE_MULTI"
    );
  });

  it("blocks before runner selection when type safety fails", async () => {
    const before = await sqlSource("CREATE TABLE public.users (id bigint, email text);\n");
    const after = await sqlSource("CREATE TABLE public.users (id bigint);\n");
    const root = await mkdtemp(join(tmpdir(), "supa-sync-type-gate-"));

    const result = await syncMigrations({
      config: {
        sources: { from: before, to: after },
        workflow: {
          rls_safety: "disabled",
          type_safety: "deploy_blocking",
        },
      },
      directory: root,
      pipeline: true,
      skipDiff: true,
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_TYPE_COLUMN_REMOVED");
    expect(result.report).toContain("deploy safety gates failed");
  });

  it("blocks before runner selection when RLS safety fails", async () => {
    const source = await sqlSource(`
CREATE TABLE public.users (id bigint PRIMARY KEY);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
`);
    const root = await mkdtemp(join(tmpdir(), "supa-sync-rls-gate-"));

    const result = await syncMigrations({
      config: {
        sources: { to: source },
        workflow: {
          rls_safety: "deploy_blocking",
          type_safety: "disabled",
        },
      },
      directory: root,
      pipeline: true,
      skipDiff: true,
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_RULE_RLS_NO_POLICY");
    expect(result.report).toContain("deploy safety gates failed");
  });

  it("generates migration SQL and refreshes TypeScript and Zod outputs during sync", async () => {
    const source = await sqlSource("CREATE TABLE public.accounts (id bigint PRIMARY KEY);\n");
    const root = await mkdtemp(join(tmpdir(), "supa-sync-diff-"));
    const typesFile = join(root, "database.types.ts");
    const zodFile = join(root, "database.zod.ts");
    const migrationsDir = join(root, "migrations");

    const result = await syncMigrations({
      config: {
        sources: { from: "empty:", to: source },
        typesFile,
        workflow: {
          migration_sync: "manual",
          rls_safety: "disabled",
          type_safety: "disabled",
        },
        zodFile,
      },
      directory: migrationsDir,
      pipeline: true,
    });

    expect(result.applied).toBe(false);
    expect(result.report).toContain("diff: wrote");
    expect(await readFile(typesFile, "utf8")).toContain("accounts");
    expect(await readFile(zodFile, "utf8")).toContain("accounts");
    expect(result.pending.some((file) => file.endsWith(".sql"))).toBe(true);
  });
});

async function sqlSource(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-sync-source-"));
  await writeFile(join(root, "001.sql"), sql);
  return `dir:${root}`;
}

describe.skipIf(!databaseUrl)("sync (against a target)", () => {
  it("auto-applies the configured local direct target with the default workflow", async () => {
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    const db = `supa_sync_auto_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const url = new URL(databaseUrl as string);
    url.pathname = `/${db}`;
    try {
      const root = await mkdtemp(join(tmpdir(), "supa-sync-auto-"));
      await writeFile(
        join(root, "20260101000000_one.sql"),
        "CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE IF NOT EXISTS app.auto_sync (id bigint PRIMARY KEY);\n"
      );

      const result = await syncMigrations({
        config: {
          sync: {
            targets: {
              local: {
                databaseUrl: url.toString(),
                historyTable: "supabase_migrations.schema_migrations",
                mode: "auto",
                runner: "direct",
              },
            },
          },
          workflow: {
            rls_safety: "disabled",
            type_safety: "disabled",
          },
        },
        directory: root,
        pipeline: true,
        skipDiff: true,
      });

      expect(result.applied).toBe(true);
      expect(result.report).toContain("migrations [local / direct]");
      const target = new Client({ connectionString: url.toString() });
      await target.connect();
      const table = await target.query<{ name: string | null }>(
        "select to_regclass('app.auto_sync')::text as name"
      );
      await target.end();
      expect(table.rows[0]?.name).toBe("app.auto_sync");
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("auto-deploys an approved remote direct target", async () => {
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    const db = `supa_sync_remote_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const url = new URL(databaseUrl as string);
    url.pathname = `/${db}`;
    const previousApproval = process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED;
    process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED = "1";
    try {
      const root = await mkdtemp(join(tmpdir(), "supa-sync-remote-"));
      await writeFile(
        join(root, "20260101000000_one.sql"),
        "CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE IF NOT EXISTS app.remote_sync (id bigint PRIMARY KEY);\n"
      );

      const result = await syncMigrations({
        config: {
          sync: {
            targets: {
              remote: {
                databaseUrl: url.toString(),
                historyTable: "supabase_migrations.schema_migrations",
                mode: "auto",
                remote: true,
                requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
                runner: "direct",
              },
            },
          },
          workflow: {
            migration_sync: "auto",
            rls_safety: "disabled",
            type_safety: "disabled",
          },
        },
        directory: root,
        pipeline: true,
        skipDiff: true,
      });

      expect(result.applied).toBe(true);
      expect(result.report).toContain("migrations [remote / direct]");
      const target = new Client({ connectionString: url.toString() });
      await target.connect();
      const table = await target.query<{ name: string | null }>(
        "select to_regclass('app.remote_sync')::text as name"
      );
      const history = await target.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations"
      );
      await target.end();
      expect(table.rows[0]?.name).toBe("app.remote_sync");
      expect(history.rows.map((row) => row.version)).toEqual(["20260101000000"]);
    } finally {
      if (previousApproval === undefined) {
        delete process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED;
      } else {
        process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED = previousApproval;
      }
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("applies pending files with the direct PostgreSQL runner", async () => {
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    const db = `supa_sync_direct_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const url = new URL(databaseUrl as string);
    url.pathname = `/${db}`;
    try {
      const root = await mkdtemp(join(tmpdir(), "supa-sync-direct-"));
      await writeFile(
        join(root, "20260101000000_one.sql"),
        "CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE IF NOT EXISTS app.direct_sync (id bigint PRIMARY KEY);\n"
      );

      const result = await syncMigrations({
        config: {
          sources: { from: "empty:", to: "empty:" },
          sync: {
            targets: {
              local: {
                databaseUrl: url.toString(),
                historyTable: "supabase_migrations.schema_migrations",
                mode: "manual",
                runner: "direct",
              },
            },
          },
          workflow: { rls_safety: "disabled", type_safety: "disabled" },
        },
        directory: root,
        pipeline: true,
        skipDiff: true,
        target: "local",
      });

      expect(result.applied).toBe(true);
      expect(result.diagnostics.some((item) => item.severity === "error")).toBe(false);
      expect(result.report).toContain("running: direct");
      const target = new Client({ connectionString: url.toString() });
      await target.connect();
      const table = await target.query<{ name: string | null }>(
        "select to_regclass('app.direct_sync')::text as name"
      );
      const history = await target.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations"
      );
      await target.end();
      expect(table.rows[0]?.name).toBe("app.direct_sync");
      expect(history.rows.map((row) => row.version)).toEqual(["20260101000000"]);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
  });

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
        config: {
          sources: { from: "empty:", to: "empty:" },
          sync: {
            targets: {
              local: {
                databaseUrl: url.toString(),
                historyTable: "supabase_migrations.schema_migrations",
                mode: "manual",
                runner: "direct",
              },
            },
          },
          workflow: { rls_safety: "disabled", type_safety: "disabled" },
        },
        directory: root,
        pipeline: true,
        skipDiff: true,
        target: "local",
      });

      expect(result.applied).toBe(false);
      expect(result.report).toContain("ghost or out-of-order");
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
  });
});
