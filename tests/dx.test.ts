import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../src/check/report.js";
import { createInstalledConfig, mergeInstalledConfig } from "../src/config/contract.js";
import { configJsonSchema, defaultConfigFile, resolveConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/validate.js";
import type { Diagnostic } from "../src/core.js";

const cliPath = resolve(import.meta.dirname, "../dist/cli.js");

const sampleDiagnostics: Diagnostic[] = [
  {
    code: "SUPA_CHECK_DROP_IF_EXISTS",
    message: "DROP statements must use IF EXISTS",
    severity: "error",
  },
  {
    code: "SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE",
    hint: "lock review",
    message: "type change can rewrite",
    severity: "warning",
  },
];

describe("config DX", () => {
  it("tolerates $schema and keeps the scaffold explicit", () => {
    const config = resolveConfig({
      $schema: "./node_modules/supaschema/supaschema-config.schema.json",
    });
    expect(config.adapter).toBe("auto");
    expect(JSON.parse(defaultConfigFile)).toEqual({
      $schema: "./node_modules/supaschema/supaschema-config.schema.json",
      ...resolveConfig(),
    });
  });

  it("rejects non-canonical adapter values", () => {
    expect(() => resolveConfig({ adapter: "supabase-auto" })).toThrow();
    expect(() => resolveConfig({ adapter: "postgres" })).toThrow();
    expect(() => resolveConfig({ adapter: "supabase" })).toThrow();
  });

  it("defaults to provider-neutral managed schemas unless configured", () => {
    expect(resolveConfig({}).managedSchemas).toEqual([]);

    expect(resolveConfig({ adapter: "auto", managedSchemas: ["auth"] }).managedSchemas).toEqual([
      "auth",
    ]);
  });

  it("keeps auto provider-neutral even when paths are Supabase-shaped", () => {
    const config = resolveConfig({
      adapter: "auto",
      migrationsDir: "supabase/migrations",
      schemaPaths: ["supabase/schemas"],
    });
    expect(config.adapter).toBe("auto");
  });

  it("parses named environments and rejects unknown keys inside them", () => {
    const config = resolveConfig({
      environments: { staging: { databaseUrl: "$STAGING_DB" } },
    });
    expect(config.environments.staging?.databaseUrl).toBe("$STAGING_DB");
    expect(() => resolveConfig({ environments: { bad: { url: "x" } } })).toThrow();
  });

  it("generates a JSON schema documenting every config key", () => {
    const schema = configJsonSchema();
    expect(schema.$id).toBe("https://supaschema.com/schemas/supaschema-config.schema.json");
    expect(schema.properties).toBeDefined();
    for (const key of [
      "adapter",
      "destructiveChanges",
      "environments",
      "excludedGrantRoles",
      "hints",
      "managedSchemas",
      "migrationsDir",
      "normalize",
      "schemaPaths",
      "schemas",
      "sources",
      "sync",
      "transactionMode",
      "typesFile",
      "validators",
      "workflow",
      "zodFile",
    ]) {
      expect(schema.properties?.[key], key).toBeDefined();
    }
    expect(schema.properties?.adapter).toMatchObject({
      default: "auto",
      enum: ["auto"],
    });
    const workflow = schema.properties?.workflow;
    expect(workflow.properties?.migration_sync?.enum).toEqual(["disabled", "manual", "auto"]);
    expect(workflow.properties?.type_safety?.enum).toEqual([
      "disabled",
      "report_only",
      "deploy_blocking",
    ]);
    expect(workflow.properties?.rls_safety?.enum).toEqual([
      "disabled",
      "report_only",
      "deploy_blocking",
    ]);
    const sync = schema.properties?.sync;
    expect(sync.properties?.targets?.default).toEqual(resolveConfig().sync.targets);
    const sources = schema.properties?.sources;
    expect(sources.properties?.from?.oneOf).toEqual([
      { const: "auto" },
      {
        type: "string",
        not: { const: "auto" },
        "x-supaschema-source-parser": "parseRuntimeSource",
      },
    ]);
    expect(sources.properties?.to?.["x-supaschema-source-parser"]).toBe("parseRuntimeSource");
  });

  it("accepts automatic sync and deploy safety workflow policies", () => {
    const config = resolveConfig({
      workflow: {
        migration_sync: "auto",
        type_safety: "report_only",
        rls_safety: "disabled",
      },
    });

    expect(config.workflow.migration_sync).toBe("auto");
    expect(config.workflow.type_safety).toBe("report_only");
    expect(config.workflow.rls_safety).toBe("disabled");
  });

  it("rejects unknown workflow policy values", () => {
    expect(() =>
      resolveConfig({
        workflow: { migration_sync: "auto_apply" },
      })
    ).toThrow();
    expect(resolveConfig().workflow).toEqual({
      schema_diff: "on_schema_write",
      migration_check: "after_schema_diff",
      migration_verify: "suggest_after_check",
      migration_sync: "auto",
      type_safety: "report_only",
      rls_safety: "report_only",
      type_generation: "create_or_refresh",
      zod_generation: "create_or_refresh",
      type_usage: "zod_validated",
    });
  });

  it("parses sync targets and validates environment-owned target URLs", async () => {
    const config = resolveConfig({
      environments: { local: { databaseUrl: "$LOCAL_DB" } },
      sync: {
        targets: {
          local: {
            mode: "auto",
            runner: "direct",
            environment: "local",
            historyTable: "supabase_migrations.schema_migrations",
          },
          remote: {
            mode: "manual",
            runner: "supabase-cli",
            databaseUrl: "$REMOTE_DB",
            historyTable: "supabase_migrations.schema_migrations",
            remote: true,
            requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          },
        },
      },
    });

    expect(config.sync.targets.local?.environment).toBe("local");
    expect(config.sync.targets.remote?.runner).toBe("supabase-cli");
    expect(resolveConfig().sync.targets.local?.databaseUrl).toBeUndefined();
    expect(resolveConfig().sync.targets.local?.environment).toBeUndefined();

    const missingEnvironmentDiagnostics = await validateConfig(
      resolveConfig({
        sync: {
          targets: {
            local: {
              mode: "auto",
              runner: "direct",
              environment: "missing",
              historyTable: "supabase_migrations.schema_migrations",
            },
          },
        },
      }),
      mkdtempSync(join(tmpdir(), "supa-sync-target-env-"))
    );
    expect(missingEnvironmentDiagnostics).toContainEqual(
      expect.objectContaining({
        field: "sync.targets.local.environment",
        severity: "error",
      })
    );
  });

  it("scaffolds provider-owned and discovered database URL sync targets", () => {
    const supabase = createInstalledConfig({ providerId: "supabase" });
    expect(supabase.sync).toEqual({
      targets: {
        local: {
          mode: "auto",
          runner: "supabase-cli",
          historyTable: "supabase_migrations.schema_migrations",
        },
        remote: {
          mode: "manual",
          runner: "supabase-cli",
          historyTable: "supabase_migrations.schema_migrations",
          requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          remote: true,
        },
      },
    });

    const postgres = createInstalledConfig({
      localDatabaseUrlEnv: "DIRECT_URL",
      remoteDatabaseUrlEnv: "DATABASE_URL",
    });
    expect(postgres.sync).toEqual({
      targets: {
        local: {
          mode: "auto",
          runner: "direct",
          databaseUrl: "$DIRECT_URL",
          historyTable: "supabase_migrations.schema_migrations",
        },
        remote: {
          mode: "manual",
          runner: "direct",
          databaseUrl: "$DATABASE_URL",
          historyTable: "supabase_migrations.schema_migrations",
          requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          remote: true,
        },
      },
    });
  });

  it("rejects malformed sync targets during config validation", async () => {
    const bothDiagnostics = await validateConfig(
      resolveConfig({
        sync: {
          targets: {
            local: {
              mode: "auto",
              runner: "direct",
              environment: "local",
              databaseUrl: "$LOCAL_DB",
              historyTable: "supabase_migrations.schema_migrations",
            },
          },
        },
      }),
      mkdtempSync(join(tmpdir(), "supa-sync-target-both-"))
    );
    expect(bothDiagnostics).toContainEqual(
      expect.objectContaining({
        field: "sync.targets.local",
        severity: "error",
      })
    );

    const fallbackDiagnostics = await validateConfig(
      resolveConfig({
        sync: {
          targets: {
            local: {
              mode: "auto",
              runner: "direct",
              historyTable: "supabase_migrations.schema_migrations",
            },
          },
        },
      }),
      mkdtempSync(join(tmpdir(), "supa-sync-target-missing-"))
    );
    expect(fallbackDiagnostics).not.toContainEqual(
      expect.objectContaining({ field: "sync.targets.local" })
    );
  });

  it("repairs legacy installed sync env defaults during init merge", () => {
    const oldLocalUrl = `$${["LOCAL", "DATABASE", "URL"].join("_")}`;
    const oldProductionUrl = `$${["PRODUCTION", "DATABASE", "URL"].join("_")}`;
    const merged = mergeInstalledConfig({
      environments: {
        local: { databaseUrl: oldLocalUrl },
        production: { databaseUrl: oldProductionUrl },
      },
      sync: {
        targets: {
          local: {
            mode: "auto",
            runner: "direct",
            environment: "local",
            historyTable: "supabase_migrations.schema_migrations",
          },
          remote: {
            mode: "manual",
            runner: "direct",
            environment: "production",
            historyTable: "supabase_migrations.schema_migrations",
            requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
            remote: true,
          },
        },
      },
    });
    expect(merged.environments).toEqual(createInstalledConfig().environments);
    expect(merged.sync).toEqual(createInstalledConfig().sync);

    const supabaseMerged = mergeInstalledConfig(
      {
        environments: {
          local: { databaseUrl: oldLocalUrl },
          production: { databaseUrl: oldProductionUrl },
        },
        sync: {
          targets: {
            local: {
              mode: "auto",
              runner: "direct",
              environment: "local",
              historyTable: "supabase_migrations.schema_migrations",
            },
            remote: {
              mode: "manual",
              runner: "direct",
              environment: "production",
              historyTable: "supabase_migrations.schema_migrations",
              requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
              remote: true,
            },
          },
        },
      },
      { providerId: "supabase" }
    );
    expect(supabaseMerged.sync).toEqual(createInstalledConfig({ providerId: "supabase" }).sync);
  });

  it("requires runtime approval configuration for remote sync targets", async () => {
    const diagnostics = await validateConfig(
      resolveConfig({
        sync: {
          targets: {
            remote: {
              mode: "auto",
              runner: "direct",
              environment: "production",
              historyTable: "supabase_migrations.schema_migrations",
            },
          },
        },
      }),
      mkdtempSync(join(tmpdir(), "supa-sync-target-remote-"))
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        field: "sync.targets.remote.requireApprovalEnv",
        severity: "error",
      })
    );
  });

  it("does not attach default sync targets to older configs with explicit empty environments", async () => {
    const config = resolveConfig({ environments: {} });

    expect(config.sync.targets).toEqual({});

    const diagnostics = await validateConfig(
      config,
      mkdtempSync(join(tmpdir(), "supa-sync-target-legacy-"))
    );
    expect(diagnostics.map((item) => item.field)).not.toContain("sync.targets.local.environment");
  });

  it("validates source defaults and redacts inline database URLs", async () => {
    const diagnostics = await validateConfig(
      resolveConfig({
        sources: {
          from: "postgresql://postgres:secret@example.com/app",
          to: "auto",
        },
      }),
      mkdtempSync(join(tmpdir(), "supa-config-validate-"))
    );

    expect(diagnostics.some((item) => item.field === "sources.from")).toBe(true);
    expect(diagnostics.some((item) => item.field === "sources.to")).toBe(true);
    const text = JSON.stringify(diagnostics);
    expect(text).toContain("postgresql://postgres:[redacted]@example.com/app");
    expect(text).not.toContain("secret");
  });

  it("reports pending install path confirmation during config validation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-config-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({ pathConfirmationNeeded: true })
    );

    const diagnostics = await validateConfig(resolveConfig(), cwd, {
      includeInstallState: true,
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        field: ".supaschema/install.json",
        severity: "error",
      })
    );
  });

  it("accepts a stale pending install flag after explicit path confirmation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-confirmed-config-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({ pathConfirmationNeeded: true })
    );
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      JSON.stringify({
        migrationsDir: "apps/api/migrations",
        schemaPaths: ["apps/api/schemas"],
        sources: { from: "auto", to: "dir:apps/api/schemas" },
      })
    );

    const diagnostics = await validateConfig(resolveConfig(), cwd, {
      includeInstallState: true,
    });

    expect(diagnostics.map((item) => item.field)).not.toContain(".supaschema/install.json");
  });

  it.each([
    ["identical", { migrationsDir: "db/schemas", schemaPaths: ["db/schemas"] }],
    ["trailing-slash migrationsDir", { migrationsDir: "db/schemas/", schemaPaths: ["db/schemas"] }],
    ["trailing-slash schemaPath", { migrationsDir: "db/schemas", schemaPaths: ["db/schemas/"] }],
    ["dot-prefix migrationsDir", { migrationsDir: "./db/schemas", schemaPaths: ["db/schemas"] }],
  ])("rejects a migrationsDir overlapping a schemaPaths entry: %s", async (_name, cfg) => {
    const diagnostics = await validateConfig(
      resolveConfig(cfg),
      mkdtempSync(join(tmpdir(), "supa-overlap-config-"))
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        field: "migrationsDir",
        message: expect.stringContaining("overlaps"),
        severity: "error",
      })
    );
  });
});

describe("check reporters", () => {
  const files = [{ diagnostics: sampleDiagnostics, file: "migrations/x.sql" }];

  it("renders github workflow commands with file and severity", () => {
    const output = renderCheckReport("github", files);
    expect(output).toContain("::error file=migrations/x.sql,title=SUPA_CHECK_DROP_IF_EXISTS::");
    expect(output).toContain("::warning file=");
  });

  it("renders valid SARIF with rule ids", () => {
    const sarif = JSON.parse(renderCheckReport("sarif", files));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results.map((result) => result.ruleId)).toContain(
      "SUPA_CHECK_DROP_IF_EXISTS"
    );
  });

  it("renders json as an array of per-file diagnostics", () => {
    const parsed = JSON.parse(renderCheckReport("json", files));
    expect(parsed[0]?.file).toBe("migrations/x.sql");
    expect(parsed[0]?.diagnostics).toHaveLength(2);
  });
});

describe("stdin sources", () => {
  it("checks SQL piped to `check -`", () => {
    const result = spawnSync(process.execPath, [cliPath, "check", "-"], {
      encoding: "utf8",
      input: "CREATE TABLE app.t (id bigint);\n",
    });
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("SUPA_CHECK_CREATE_TABLE_GUARD");
  });

  it("accepts replay-safe SQL from stdin", () => {
    const result = spawnSync(process.execPath, [cliPath, "check", "-"], {
      encoding: "utf8",
      input: "CREATE TABLE IF NOT EXISTS app.t (id bigint);\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  it("fails zero-arg check on an empty migrations directory unless allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-empty-check-"));

    const rejected = spawnSync(process.execPath, [cliPath, "check"], {
      cwd,
      encoding: "utf8",
    });
    const allowed = spawnSync(process.execPath, [cliPath, "check", "--allow-empty"], {
      cwd,
      encoding: "utf8",
    });

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("no migrations found in database/migrations");
    expect(allowed.status).toBe(0);
  });
});

describe("check git selection", () => {
  function git(cwd: string, args: string[]): void {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
  }

  function makeGitProject(): string {
    const cwd = mkdtempSync(join(tmpdir(), "supa-check-git-"));
    mkdirSync(join(cwd, "database/migrations"), { recursive: true });
    writeFileSync(
      join(cwd, "database/migrations", "20260101000000_base.sql"),
      "CREATE TABLE IF NOT EXISTS app.base (id bigint);\n"
    );
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test User"]);
    git(cwd, ["add", "."]);
    git(cwd, ["commit", "-m", "baseline"]);
    return cwd;
  }

  it("checks changed migration SQL and excludes deleted files", () => {
    const cwd = makeGitProject();
    rmSync(join(cwd, "database/migrations", "20260101000000_base.sql"));
    writeFileSync(
      join(cwd, "database/migrations", "20260102000000_changed.sql"),
      "CREATE TABLE IF NOT EXISTS app.changed (id bigint);\n"
    );
    writeFileSync(join(cwd, "outside.sql"), "CREATE TABLE app.bad (id bigint);\n");

    const result = spawnSync(process.execPath, [cliPath, "check", "--changed"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 20_000);

  it("checks staged migrations without including unstaged migrations", () => {
    const cwd = makeGitProject();
    writeFileSync(
      join(cwd, "database/migrations", "20260102000000_staged.sql"),
      "CREATE TABLE IF NOT EXISTS app.staged (id bigint);\n"
    );
    git(cwd, ["add", "database/migrations/20260102000000_staged.sql"]);
    writeFileSync(
      join(cwd, "database/migrations", "20260103000000_unstaged.sql"),
      "CREATE TABLE app.unstaged (id bigint);\n"
    );

    const result = spawnSync(process.execPath, [cliPath, "check", "--staged"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 20_000);

  it("checks staged migration content from the index instead of the worktree", () => {
    const cwd = makeGitProject();
    const path = join(cwd, "database/migrations", "20260102000000_staged.sql");
    writeFileSync(path, "CREATE TABLE IF NOT EXISTS app.staged (id bigint);\n");
    git(cwd, ["add", "database/migrations/20260102000000_staged.sql"]);
    writeFileSync(path, "CREATE TABLE app.staged (id bigint);\n");

    const result = spawnSync(process.execPath, [cliPath, "check", "--staged"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 20_000);

  it("checks renamed migrations by their porcelain destination path", () => {
    const cwd = makeGitProject();
    git(cwd, [
      "mv",
      "database/migrations/20260101000000_base.sql",
      "database/migrations/20260101000000_renamed.sql",
    ]);

    const result = spawnSync(process.execPath, [cliPath, "check", "--changed"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 20_000);

  it("checks changed migrations when migrationsDir is the git root", () => {
    const cwd = makeGitProject();
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      `${JSON.stringify({ migrationsDir: ".", schemaPaths: ["database/schemas"] })}\n`
    );
    writeFileSync(
      join(cwd, "20260102000000_root.sql"),
      "CREATE TABLE IF NOT EXISTS app.root_selected (id bigint);\n"
    );

    const result = spawnSync(process.execPath, [cliPath, "check", "--changed"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 20_000);

  it("checks migrations selected by base and since refs", () => {
    const cwd = makeGitProject();
    writeFileSync(
      join(cwd, "database/migrations", "20260102000000_base_diff.sql"),
      "CREATE TABLE IF NOT EXISTS app.base_diff (id bigint);\n"
    );
    git(cwd, ["add", "database/migrations/20260102000000_base_diff.sql"]);

    for (const args of [
      ["check", "--base", "HEAD"],
      ["check", "--since", "HEAD"],
    ]) {
      const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("ok");
    }
  }, 20_000);

  it("rejects ambiguous check selection arguments", () => {
    const cwd = makeGitProject();
    const conflicting = spawnSync(process.execPath, [cliPath, "check", "--changed", "--staged"], {
      cwd,
      encoding: "utf8",
    });
    const explicit = spawnSync(
      process.execPath,
      [cliPath, "check", "--changed", "database/migrations/20260101000000_base.sql"],
      { cwd, encoding: "utf8" }
    );

    expect(conflicting.status).toBe(1);
    expect(conflicting.stderr).toContain("use only one of --changed, --staged, --base, or --since");
    expect(explicit.status).toBe(1);
    expect(explicit.stderr).toContain("cannot be combined with explicit migration files");
  }, 20_000);
});

describe("raw CLI errors", () => {
  it("keeps migrations replay scoped to types instead of drift commands", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-migrations-source-"));
    mkdirSync(join(cwd, "supabase", "migrations"), { recursive: true });
    mkdirSync(join(cwd, "supabase", "schemas"), { recursive: true });
    writeFileSync(
      join(cwd, "supabase", "migrations", "20260101000000_init.sql"),
      "create table public.todos (id bigint primary key);\n"
    );
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      `${JSON.stringify({
        migrationsDir: "supabase/migrations",
        schemaPaths: ["supabase/schemas"],
        sources: { from: "empty:", to: "dir:supabase/schemas" },
      })}\n`
    );

    const source = "migrations:supabase/migrations";
    const types = spawnSync(
      process.execPath,
      [cliPath, "types", "--source", source, "--out", "stdout"],
      {
        cwd,
        encoding: "utf8",
      }
    );
    const fingerprint = spawnSync(process.execPath, [cliPath, "fingerprint", "--from", source], {
      cwd,
      encoding: "utf8",
    });
    const contract = spawnSync(
      process.execPath,
      [cliPath, "contracts", "export", "--from", source],
      {
        cwd,
        encoding: "utf8",
      }
    );
    const contractDiff = spawnSync(
      process.execPath,
      [cliPath, "contracts", "diff", "--from", "missing.json", "--to", source],
      {
        cwd,
        encoding: "utf8",
      }
    );

    expect(types.status).toBe(0);
    expect(types.stdout).toContain("todos");
    expect(fingerprint.status).toBe(2);
    expect(fingerprint.stderr).toContain("SUPA_SOURCE_MIGRATIONS_TYPEGEN_ONLY");
    expect(contract.status).toBe(2);
    expect(contract.stderr).toContain("SUPA_SOURCE_MIGRATIONS_TYPEGEN_ONLY");
    expect(contractDiff.status).toBe(2);
    expect(contractDiff.stderr).toContain("SUPA_SOURCE_MIGRATIONS_TYPEGEN_ONLY");
  }, 20_000);

  it("rejects JavaScript config files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-redact-"));
    writeFileSync(
      join(cwd, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/migrations" };\n'
    );

    const result = spawnSync(
      process.execPath,
      [cliPath, "--config", "supaschema.config.mjs", "inspect"],
      {
        cwd,
        encoding: "utf8",
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("JavaScript config files are not supported");
  });

  it("redacts database source credentials from inspect JSON output", () => {
    const password = "p".repeat(300);
    const source = `database:postgresql://user:${password}@127.0.0.1:9/db`;
    const result = spawnSync(process.execPath, [cliPath, "inspect", "--from", source], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).not.toContain(password);
    expect(result.stdout).toContain("postgresql://user:[redacted]@127.0.0.1:9/db");
  });

  it("ignores JavaScript config files during default discovery", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-js-default-"));
    writeFileSync(
      join(cwd, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/migrations" };\n'
    );

    const result = spawnSync(process.execPath, [cliPath, "config", "validate", "--json"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.diagnostics.map((item) => item.field)).toContain("schemaPaths[0]");
  });
});

describe("verify environment flags", () => {
  it("exposes both enable and disable flags for the Supabase environment stub", () => {
    const result = spawnSync(process.execPath, [cliPath, "verify", "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--ensure-environment");
    expect(result.stdout).toContain("--no-ensure-environment");
  });
});

describe("doctor environment resolution", () => {
  it("honors the global --env database URL lane", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-doctor-env-"));
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      `${JSON.stringify({ environments: { staging: { databaseUrl: "$STAGING_DB" } } })}\n`
    );

    const result = spawnSync(process.execPath, [cliPath, "--env", "staging", "doctor"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        STAGING_DB: "postgresql://postgres:postgres@127.0.0.1:1/postgres",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("database url: resolved via --env staging");
  });
});

describe("pending install path confirmation", () => {
  it("blocks config validate, doctor, zero-source diff, zero-arg check, sync, and apply", {
    timeout: 20_000,
  }, () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-install-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    mkdirSync(join(cwd, "database/migrations"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({
        candidates: {
          migrationsDirs: ["apps/api/migrations", "packages/db/migrations"],
          schemaPaths: ["apps/api/schemas", "packages/db/schemas"],
        },
        pathConfirmationNeeded: true,
      })
    );
    writeFileSync(
      join(cwd, "database/migrations", "20260101000000_safe.sql"),
      "CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE IF NOT EXISTS app.t (id bigint);\n"
    );

    const validate = spawnSync(process.execPath, [cliPath, "config", "validate", "--json"], {
      cwd,
      encoding: "utf8",
    });
    const doctor = spawnSync(process.execPath, [cliPath, "doctor"], {
      cwd,
      encoding: "utf8",
    });
    const diff = spawnSync(process.execPath, [cliPath, "diff"], {
      cwd,
      encoding: "utf8",
    });
    const check = spawnSync(process.execPath, [cliPath, "check"], {
      cwd,
      encoding: "utf8",
    });
    const sync = spawnSync(process.execPath, [cliPath, "sync", "--database-url", "empty:"], {
      cwd,
      encoding: "utf8",
    });
    const apply = spawnSync(process.execPath, [cliPath, "apply", "--database-url", "empty:"], {
      cwd,
      encoding: "utf8",
    });

    expect(validate.status).toBe(2);
    expect(JSON.parse(validate.stdout).diagnostics).toContainEqual(
      expect.objectContaining({
        field: ".supaschema/install.json",
        severity: "error",
      })
    );
    expect(doctor.status).toBe(2);
    expect(doctor.stdout).toContain("install path confirmation");
    expect(diff.status).toBe(2);
    expect(diff.stderr).toContain(".supaschema/install.json");
    expect(check.status).toBe(2);
    expect(check.stderr).toContain(".supaschema/install.json");
    expect(sync.status).toBe(2);
    expect(sync.stderr).toContain(".supaschema/install.json");
    expect(apply.status).toBe(2);
    expect(apply.stderr).toContain(".supaschema/install.json");
  });

  it("allows explicit source diff as a recovery path while install confirmation is pending", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-explicit-diff-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    mkdirSync(join(cwd, "schemas"), { recursive: true });
    writeFileSync(join(cwd, ".supaschema", "install.json"), '{"pathConfirmationNeeded":true}\n');
    writeFileSync(join(cwd, "schemas", "schema.sql"), "CREATE SCHEMA app;\n");

    const result = spawnSync(
      process.execPath,
      [cliPath, "diff", "--from", "empty:", "--to", "dir:schemas", "--out", "stdout"],
      { cwd, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CREATE SCHEMA IF NOT EXISTS app");
  });
});

describe("schema diff defaults", () => {
  it("diffs scoped schema edits from git without a database or unrelated managed-schema failures", {
    timeout: 20_000,
  }, () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-git-scoped-diff-"));
    mkdirSync(join(cwd, "schemas"), { recursive: true });
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      `${JSON.stringify({
        managedSchemas: ["auth"],
        migrationsDir: "migrations",
        schemaPaths: ["schemas"],
        sources: { from: "auto", to: "dir:schemas" },
      })}\n`
    );
    writeFileSync(join(cwd, "schemas", "auth.sql"), "CREATE SCHEMA auth;\n");
    writeFileSync(
      join(cwd, "schemas", "app.sql"),
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint PRIMARY KEY);\n"
    );

    for (const args of [
      ["init"],
      ["config", "user.email", "test@example.com"],
      ["config", "user.name", "Test User"],
      ["add", "."],
      ["commit", "-m", "baseline"],
    ]) {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(
      join(cwd, "schemas", "app.sql"),
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint PRIMARY KEY, name text);\n"
    );

    const result = spawnSync(
      process.execPath,
      [cliPath, "diff", "--schema", "app", "--name", "add_account_name"],
      { cwd, encoding: "utf8", env: { ...process.env, SUPASCHEMA_DATABASE_URL: "" } }
    );

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).toContain("--from git:HEAD");
    expect(result.stderr).not.toContain("SUPA_SUPABASE_MANAGED_SCHEMA");
    const normalizedStdout = result.stdout.split("\\").join("/");
    expect(normalizedStdout).toContain("migrations/");
    expect(result.stdout).toContain("add_account_name.sql");
    expect(existsSync(join(cwd, "database.types.ts"))).toBe(false);
    expect(existsSync(join(cwd, "database.zod.ts"))).toBe(false);

    const migration = spawnSync(
      process.execPath,
      [cliPath, "check", result.stdout.trim().split("\n").at(-1) ?? ""],
      { cwd, encoding: "utf8" }
    );
    expect(migration.status, migration.stderr).toBe(0);
  });
});
