import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "../src/database/url.js";
import {
  expectedInstalledConfig,
  expectedSupaschemaScripts,
} from "./install-parity-expectations.js";

const run = promisify(execFile);

async function runScaffold(
  targetDir: string,
  options: { packageRoot?: string; repair?: boolean } = {}
): Promise<void> {
  const { scaffoldProject } = await import(
    pathToFileURL(join(process.cwd(), "bin/scaffold.mjs")).href
  );
  await scaffoldProject({
    interactive: false,
    packageRoot: options.packageRoot ?? process.cwd(),
    packageVersion: "test",
    repair: options.repair === true,
    targetDir,
  });
}

describe("supabase database URL discovery", () => {
  it("reads [db] port from the nearest supabase/config.toml, walking upward", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-url-"));
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(
      join(root, "supabase", "config.toml"),
      "[api]\nport = 64321\n\n[db]\nport = 64322 # local db\nshadow_port = 64320\nmajor_version = 17\n\n[studio]\nport = 64323\n"
    );
    const nested = join(root, "apps", "web");
    await mkdir(nested, { recursive: true });

    expect(resolveSupabaseLocalDatabaseUrl(nested)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:64322/postgres"
    );
  });

  it("returns undefined when no supabase config exists upward", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-url-none-"));

    expect(resolveSupabaseLocalDatabaseUrl(root)).toBeUndefined();
  });

  it("applies the Supabase default port when [db] omits it", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-url-default-"));
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), "[db]\nmajor_version = 17\n");

    expect(resolveSupabaseLocalDatabaseUrl(root)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    );
  });

  it("prefers an explicit value and supports $ENV indirection", () => {
    expect(resolveDatabaseUrl("postgresql://x@y/z")).toBe("postgresql://x@y/z");
    process.env.SUPA_URL_TEST = "postgresql://from-env@host/db";
    try {
      expect(resolveDatabaseUrl("$SUPA_URL_TEST")).toBe("postgresql://from-env@host/db");
    } finally {
      delete process.env.SUPA_URL_TEST;
    }
  });
});

describe("init project setup", () => {
  it("installs config and directories without active agent surfaces by default", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-"));

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig("database/schemas", "database/migrations"));
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "database/migrations"))).toBe(true);
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
    expect(existsSync(join(consumer, ".env.supaschema.example"))).toBe(false);

    for (const file of [
      ".agents/prompts/supaschema-install.md",
      ".agents/skills/supaschema/SKILL.md",
      ".claude/hooks/guards/bash-policy-checks.mjs",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
      ".claude/rules/supaschema.md",
      ".claude/settings.json",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks/general-guard.mjs",
      ".codex/hooks/guards/bash-policy-checks.mjs",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
    ]) {
      expect(existsSync(join(consumer, file)), file).toBe(false);
    }
    expect(existsSync(join(consumer, ".claude/skills/gitnexus"))).toBe(false);
    for (const file of [
      ".vscode/settings.json",
      ".vscode/extensions.json",
      ".mcp.json",
      ".claude/cclsp.json",
      "components.json",
      "postgres-language-server.jsonc",
      "pyproject.toml",
      "styles/globals.css",
    ]) {
      expect(existsSync(join(consumer, file)), file).toBe(false);
    }

    const prompt = await readFile(
      join(process.cwd(), "agent-bundle/agents/prompts/supaschema-install.md"),
      "utf8"
    );
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(consumer, "CLAUDE.md"))).toBe(false);
    expect(prompt).toContain("raw AI-agent rules, hooks, skills, prompts, and settings");
  });

  it("sets pnpm build approval for supaschema when initializing a pnpm workspace member", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "supa-init-pnpm-workspace-"));
    const member = join(workspace, "packages", "db");
    await mkdir(member, { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      `${JSON.stringify({
        name: "supaschema-pnpm-workspace-root",
        packageManager: "pnpm@10.18.1",
        private: true,
        version: "0.0.0",
      })}\n`
    );
    await writeFile(
      join(workspace, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\nallowBuilds:\n  supaschema: set this to true or false\n"
    );
    await writeFile(
      join(member, "package.json"),
      `${JSON.stringify({ name: "db", private: true, version: "0.0.0" })}\n`
    );

    await runScaffold(member);

    const workspaceYaml = await readFile(join(workspace, "pnpm-workspace.yaml"), "utf8");
    expect(workspaceYaml).toContain("allowBuilds:\n  supaschema: true\n");
    expect(workspaceYaml).not.toContain("set this to true or false");
    expect(existsSync(join(workspace, "supaschema.config.json"))).toBe(false);
    expect(existsSync(join(member, "supaschema.config.json"))).toBe(true);
  });

  it("adds pnpm build approval when a pnpm workspace has no allowBuilds block", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-pnpm-allow-builds-"));
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({
        name: "supaschema-pnpm-workspace-root",
        packageManager: "pnpm@10.18.1",
        private: true,
        version: "0.0.0",
      })}\n`
    );
    await writeFile(join(consumer, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");

    await runScaffold(consumer);

    const workspaceYaml = await readFile(join(consumer, "pnpm-workspace.yaml"), "utf8");
    expect(workspaceYaml).toBe("packages:\n  - packages/*\n\nallowBuilds:\n  supaschema: true\n");
  });

  it("adds canonical package scripts to the owning package manifest", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-package-scripts-"));
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({
        name: "db",
        private: true,
        scripts: {
          test: "vitest",
        },
        version: "0.0.0",
      })}\n`
    );

    await runScaffold(consumer);

    const manifest = JSON.parse(await readFile(join(consumer, "package.json"), "utf8"));
    expect(manifest.scripts).toEqual({
      test: "vitest",
      ...expectedSupaschemaScripts,
    });
  });

  it("preserves existing supaschema package scripts unless repair is requested", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-package-scripts-repair-"));
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({
        name: "db",
        private: true,
        scripts: {
          "supaschema:stage": "custom stage",
        },
        version: "0.0.0",
      })}\n`
    );

    await runScaffold(consumer);
    let manifest = JSON.parse(await readFile(join(consumer, "package.json"), "utf8"));
    expect(manifest.scripts["supaschema:stage"]).toBe("custom stage");
    expect(manifest.scripts["supaschema:types"]).toBe("supaschema types");

    await runScaffold(consumer, { repair: true });
    manifest = JSON.parse(await readFile(join(consumer, "package.json"), "utf8"));
    expect(manifest.scripts).toMatchObject(expectedSupaschemaScripts);
  });

  it("uses Supabase paths when the project has Supabase local config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-supabase-"));
    await mkdir(join(consumer, "supabase"), { recursive: true });
    await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig("supabase/schemas", "supabase/migrations"));
    expect(existsSync(join(consumer, "supabase/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "supabase/migrations"))).toBe(true);
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("requires path confirmation for Supabase bootstrap inventory trees", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-supabase-bootstrap-"));
    await writeNestedFile(join(consumer, "supabase/config.toml"), "[db]\nport = 54322\n");
    await writeNestedFile(
      join(consumer, "supabase/schemas/_bootstrap/00_roles.sql"),
      "create role app_runtime;\n"
    );

    await runScaffold(consumer);

    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
    expect(manifest.candidates.schemaPaths).toContain("supabase/schemas");
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
  });

  it("requires path confirmation when a Supabase owner marks schemas as inventory", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-supabase-owner-inventory-"));
    await writeNestedFile(join(consumer, "supabase/config.toml"), "[db]\nport = 54322\n");
    await writeNestedFile(
      join(consumer, "supabase/schemas/app/schema.sql"),
      "create schema app;\n"
    );
    await writeNestedFile(
      join(consumer, "supabase/AGENTS.md"),
      [
        "# Supabase",
        "",
        "`supabase/schemas/**` is the existing schema-source and contract-inventory surface while it remains in the repo; it is not the routine migration generator input.",
        "",
      ].join("\n")
    );

    await runScaffold(consumer);

    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
    expect(manifest.candidates.schemaPaths).toContain("supabase/schemas");
  });

  it("reuses existing database URL env names for generic PostgreSQL sync targets", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-env-"));
    await writeFile(
      join(consumer, ".env.local"),
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app\nDIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/app\n"
    );
    await mkdir(join(consumer, ".vercel"), { recursive: true });
    await writeFile(
      join(consumer, ".vercel", ".env.production.local"),
      "DATABASE_URL=postgresql://postgres:postgres@example.com:5432/app\n"
    );

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config.environments).toEqual({});
    expect(config.sync.targets.local.databaseUrl).toBe("$DIRECT_URL");
    expect(config.sync.targets.remote.databaseUrl).toBe("$DATABASE_URL");
    expect(existsSync(join(consumer, ".env.supaschema.example"))).toBe(false);
  });

  it("keeps Supabase sync on the Supabase CLI runner even when database URL envs exist", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-supabase-env-"));
    await mkdir(join(consumer, "supabase"), { recursive: true });
    await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");
    await writeFile(
      join(consumer, ".env.local"),
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app\nDIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/app\nSUPABASE_DB_PASSWORD=secret\n"
    );

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config.sync.targets.local.runner).toBe("supabase-cli");
    expect(config.sync.targets.remote.runner).toBe("supabase-cli");
    expect(config.sync.targets.local.databaseUrl).toBeUndefined();
    expect(config.sync.targets.remote.databaseUrl).toBeUndefined();
  });

  it.each([
    {
      id: "neon",
      marker: "neon.toml",
      markerContent: "project_id = 'quiet-waterfall-123456'\n",
      migrationsDir: "neon/migrations",
      schemaPath: "neon/schemas",
    },
    {
      id: "aws-postgresql",
      marker: "infra/main.tf",
      markerContent: 'resource "aws_rds_cluster" "postgres" { engine = "aurora-postgresql" }\n',
      migrationsDir: "aws-postgresql/migrations",
      schemaPath: "aws-postgresql/schemas",
    },
    {
      id: "cloud-sql",
      marker: "infra/main.tf",
      markerContent: 'resource "google_sql_database_instance" "postgres" {}\n',
      migrationsDir: "cloud-sql/migrations",
      schemaPath: "cloud-sql/schemas",
    },
    {
      id: "alloydb",
      marker: "infra/main.tf",
      markerContent: 'resource "google_alloydb_cluster" "postgres" {}\n',
      migrationsDir: "alloydb/migrations",
      schemaPath: "alloydb/schemas",
    },
    {
      id: "azure-postgresql",
      marker: "infra/main.tf",
      markerContent: 'resource "azurerm_postgresql_flexible_server" "postgres" {}\n',
      migrationsDir: "azure-postgresql/migrations",
      schemaPath: "azure-postgresql/schemas",
    },
  ])("uses $id paths when provider config markers are present", async ({
    marker,
    markerContent,
    migrationsDir,
    schemaPath,
  }) => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-provider-"));
    await mkdir(dirname(join(consumer, marker)), { recursive: true });
    await writeFile(join(consumer, marker), markerContent);

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig(schemaPath, migrationsDir));
    expect(existsSync(join(consumer, schemaPath))).toBe(true);
    expect(existsSync(join(consumer, migrationsDir))).toBe(true);
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("preserves existing config and consumer-owned agent surfaces", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-existing-"));
    await writeFile(join(consumer, "supaschema.config.json"), '{"adapter":"auto"}\n');
    await writeFile(join(consumer, "AGENTS.md"), "# Existing agents\n\nKeep this.\n");
    await writeFile(join(consumer, "CLAUDE.md"), "@AGENTS.md\n");
    await writeNestedFile(join(consumer, ".claude/settings.json"), '{"hooks":{"PreToolUse":[]}}\n');
    await writeNestedFile(join(consumer, ".codex/hooks.json"), '{"hooks":{"Stop":[]}}\n');
    await writeNestedFile(join(consumer, ".codex/skills/custom/SKILL.md"), "custom skill\n");

    await runScaffold(consumer);

    expect(await readFile(join(consumer, "supaschema.config.json"), "utf8")).toBe(
      '{"adapter":"auto"}\n'
    );
    expect(await readFile(join(consumer, "AGENTS.md"), "utf8")).toBe(
      "# Existing agents\n\nKeep this.\n"
    );
    expect(await readFile(join(consumer, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(await readFile(join(consumer, ".claude/settings.json"), "utf8")).toBe(
      '{"hooks":{"PreToolUse":[]}}\n'
    );
    expect(await readFile(join(consumer, ".codex/hooks.json"), "utf8")).toBe(
      '{"hooks":{"Stop":[]}}\n'
    );
    expect(await readFile(join(consumer, ".codex/skills/custom/SKILL.md"), "utf8")).toBe(
      "custom skill\n"
    );
    expect(existsSync(join(consumer, ".agents/prompts/supaschema-install.md"))).toBe(false);
    expect(existsSync(join(consumer, ".claude/rules/supaschema.md"))).toBe(false);
    expect(existsSync(join(consumer, ".codex/rules/supaschema.rules"))).toBe(false);
  });

  it("does not add Anilize-style context surfaces, settings, duplicates, or backups", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-anilize-context-"));
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "anilize-like", packageManager: "pnpm@11.1.2", private: true })}\n`
    );
    await writeNestedFile(join(consumer, "CLAUDE.md"), "@AGENTS.md\n");
    await writeNestedFile(join(consumer, "AGENTS.md"), "# Consumer brief\n\nKeep this.\n");
    await writeNestedFile(join(consumer, "supabase/config.toml"), "[db]\nport = 54322\n");
    await writeNestedFile(
      join(consumer, "supabase/schemas/_bootstrap/00_roles.sql"),
      "create role app_runtime;\n"
    );

    await runScaffold(consumer);

    expect(await readFile(join(consumer, "AGENTS.md"), "utf8")).toBe(
      "# Consumer brief\n\nKeep this.\n"
    );
    expect(await readFile(join(consumer, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    expect(existsSync(join(consumer, ".supaschema/install.json"))).toBe(true);
    for (const file of [
      ".agents/prompts/supaschema-install.md",
      ".agents/skills/supaschema/SKILL.md",
      ".claude/rules/supaschema.md",
      ".claude/settings.json",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
    ]) {
      expect(existsSync(join(consumer, file)), file).toBe(false);
    }
    for (const backupDir of [
      ".agents/skills.__backup_20260619T040853",
      ".claude/settings.__backup_20260619T040912",
      ".codex/rules.__backup_20260619T040927",
    ]) {
      expect(existsSync(join(consumer, backupDir)), backupDir).toBe(false);
    }
  });

  it("repairs removed migration_sync scaffold values to the canonical policy", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-legacy-sync-"));
    await writeFile(
      join(consumer, "supaschema.config.json"),
      `${JSON.stringify(
        {
          adapter: "auto",
          migrationsDir: "database/migrations",
          schemaPaths: ["database/schemas"],
          sources: { from: "auto", to: "dir:database/schemas" },
          workflow: { migration_sync: "explicit_request_only" },
        },
        null,
        2
      )}\n`
    );

    await runScaffold(consumer, { repair: true });

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config.workflow.migration_sync).toBe("manual");
    expect(config.workflow).toMatchObject({
      migration_check: "after_schema_diff",
      migration_verify: "suggest_after_check",
      schema_diff: "on_schema_write",
    });
    expect(config.sources).toEqual({ from: "auto", to: "dir:database/schemas" });
  });

  it("scans existing schema and migration folders for the generated config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-scan-"));
    await mkdir(join(consumer, "database", "schema"), { recursive: true });
    await mkdir(join(consumer, "database", "migrations"), { recursive: true });
    await writeFile(join(consumer, "database", "schema", "schema.sql"), "create schema app;\n");
    await writeFile(
      join(consumer, "database", "migrations", "20260101000000_init.sql"),
      "select 1;\n"
    );

    await runScaffold(consumer);

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config.schemaPaths).toEqual(["database/schema"]);
    expect(config.migrationsDir).toBe("database/migrations");
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("records ambiguous scanned paths for agent confirmation", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-ambiguous-"));
    await mkdir(join(consumer, "apps", "api", "schemas"), { recursive: true });
    await mkdir(join(consumer, "packages", "db", "schemas"), { recursive: true });
    await mkdir(join(consumer, "apps", "api", "migrations"), { recursive: true });
    await mkdir(join(consumer, "packages", "db", "migrations"), { recursive: true });
    await writeFile(join(consumer, "apps", "api", "schemas", "schema.sql"), "create schema app;\n");
    await writeFile(
      join(consumer, "packages", "db", "schemas", "schema.sql"),
      "create schema app;\n"
    );
    await writeFile(
      join(consumer, "apps", "api", "migrations", "20260101000000_init.sql"),
      "select 1;\n"
    );
    await writeFile(
      join(consumer, "packages", "db", "migrations", "20260101000000_init.sql"),
      "select 1;\n"
    );

    await runScaffold(consumer);

    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
    expect(manifest.candidates.schemaPaths).toEqual(["apps/api/schemas", "packages/db/schemas"]);
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
  });

  it("runs from the packed npm tarball with all required installer inputs", {
    timeout: 30_000,
  }, async () => {
    const packDir = await mkdtemp(join(tmpdir(), "supa-pack-"));
    const consumer = await mkdtemp(join(tmpdir(), "supa-packed-install-"));
    const extractDir = await mkdtemp(join(tmpdir(), "supa-pack-extract-"));
    const npm = npmExec(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir]);
    const { stdout } = await run(npm.file, npm.args);
    const [packed] = JSON.parse(stdout);
    const tarball = join(packDir, packed.filename);

    await run("tar", ["-xzf", tarball, "-C", extractDir]);
    for (const file of [
      ".vscode/settings.json",
      ".mcp.json",
      ".claude/settings.json",
      ".claude/cclsp.json",
      "components.json",
      "postgres-language-server.jsonc",
      "pyproject.toml",
      "styles/globals.css",
    ]) {
      expect(existsSync(join(extractDir, "package", file)), file).toBe(false);
    }
    for (const file of [
      "agent-bundle/INSTALL.md",
      "agent-bundle/agents/prompts/supaschema-install.md",
      "agent-bundle/claude/settings.npm.json",
      "agent-bundle/codex/hooks.npm.json",
    ]) {
      expect(existsSync(join(extractDir, "package", file)), file).toBe(true);
    }
    await runScaffold(consumer, { packageRoot: join(extractDir, "package") });

    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(true);
    expect(existsSync(join(consumer, ".agents/prompts/supaschema-install.md"))).toBe(false);
    expect(existsSync(join(consumer, ".agents/skills/supaschema/SKILL.md"))).toBe(false);
    expect(existsSync(join(consumer, ".claude/rules/supaschema.md"))).toBe(false);
    expect(existsSync(join(consumer, ".codex/hooks.json"))).toBe(false);
    for (const backupDir of [
      ".agents/skills.__backup_20260619T040853",
      ".claude/settings.__backup_20260619T040912",
      ".codex/rules.__backup_20260619T040927",
    ]) {
      expect(existsSync(join(consumer, backupDir)), backupDir).toBe(false);
    }
    expect(existsSync(join(consumer, ".vscode/settings.json"))).toBe(false);
    expect(existsSync(join(consumer, ".mcp.json"))).toBe(false);
    expect(existsSync(join(consumer, ".claude/cclsp.json"))).toBe(false);
    expect(existsSync(join(consumer, "postgres-language-server.jsonc"))).toBe(false);
    expect(existsSync(join(consumer, "pyproject.toml"))).toBe(false);
    expect(existsSync(join(consumer, "components.json"))).toBe(false);
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
  });

  it("does not create install state on a no-op resolved re-install", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-idempotent-"));

    await runScaffold(consumer);
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
    await mkdir(join(consumer, ".supaschema"), { recursive: true });
    await writeFile(
      join(consumer, ".supaschema", "install.json"),
      '{"pathConfirmationNeeded":false}\n'
    );
    await runScaffold(consumer);

    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("resolves a sparse existing config through the CLI defaults, not provider detection", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-sparse-"));
    await mkdir(join(consumer, "supabase"), { recursive: true });
    await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");
    await writeFile(join(consumer, "supaschema.config.json"), "{}\n");

    await runScaffold(consumer);

    expect(await readFile(join(consumer, "supaschema.config.json"), "utf8")).toBe("{}\n");
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("ignores JavaScript config files and writes the canonical JSON config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-module-"));
    await writeFile(
      join(consumer, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/changes" };\n'
    );

    await runScaffold(consumer);

    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(consumer, "db/sql"))).toBe(false);
    expect(existsSync(join(consumer, "db/changes"))).toBe(false);
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "database/migrations"))).toBe(true);
    expect(JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"))).toEqual(
      expectedInstalledConfig("database/schemas", "database/migrations")
    );
    expect(existsSync(join(consumer, ".supaschema"))).toBe(false);
  });

  it("does not scaffold a guessed config while path confirmation is pending", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-init-pending-"));
    await mkdir(join(consumer, "apps", "api", "schemas"), { recursive: true });
    await mkdir(join(consumer, "packages", "db", "schemas"), { recursive: true });
    await writeFile(join(consumer, "apps", "api", "schemas", "schema.sql"), "create schema app;\n");
    await writeFile(
      join(consumer, "packages", "db", "schemas", "schema.sql"),
      "create schema app;\n"
    );

    await runScaffold(consumer);

    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
  });
});

function npmExec(args: string[]): { args: string[]; file: string } {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return { args: [npmExecPath, ...args], file: process.execPath };
  }
  return { args, file: process.platform === "win32" ? "npm.cmd" : "npm" };
}

async function writeNestedFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
