import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "../src/database-url.js";
import { expectedInstalledConfig } from "./install-parity-expectations.js";

const run = promisify(execFile);
const codexProjectDir = shellParameter("CODEX_PROJECT_DIR:-$PWD");
const claudeProjectDir = shellParameter("CLAUDE_PROJECT_DIR");
const codexGateCommand = `node "${codexProjectDir}/.codex/hooks/block-generated-migration-edits.mjs"`;
const codexAutoDiffCommand = `node "${codexProjectDir}/.codex/hooks/auto-diff-on-schema-change.mjs"`;
const codexLlmSyncCommand = `node "${codexProjectDir}/.codex/hooks/sync-llm-on-claude-surface-change.mjs"`;
const legacyClaudeSkillGateCommand = `${claudeProjectDir}/.claude/hooks/skill_gate.sh`;
const claudeGeneratedGateArgs = [
  `${claudeProjectDir}/.claude/hooks/block-generated-migration-edits.mjs`,
];
const claudeAutoDiffArgs = [`${claudeProjectDir}/.claude/hooks/auto-diff-on-schema-change.mjs`];
const claudeLlmSyncArgs = [
  `${claudeProjectDir}/.claude/hooks/sync-llm-on-claude-surface-change.mjs`,
];
function shellParameter(expression: string): string {
  return ["$", "{", expression, "}"].join("");
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

describe("install-time project setup", () => {
  it("installs config and agent surfaces in one postinstall step", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-"));
    const env = { ...process.env, INIT_CWD: consumer };

    const { stdout } = await run("node", ["bin/postinstall.mjs"], { env });
    expect(stdout).toContain("installed config, directories, agent files, hook wiring");

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig("database/schemas", "database/migrations"));
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "database/migrations"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.adapter).toBe("auto");

    for (const file of [
      ".agents/skills/supaschema/SKILL.md",
      ".claude/hooks/auto-diff-on-schema-change.mjs",
      ".claude/hooks/block-generated-migration-edits.mjs",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
      ".claude/rules/supaschema.md",
      ".claude/settings.json",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks/auto-diff-on-schema-change.mjs",
      ".codex/hooks/block-generated-migration-edits.mjs",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
      ".codex/skills/supaschema/SKILL.md",
    ]) {
      expect(existsSync(join(consumer, file)), file).toBe(true);
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

    const agents = await readFile(join(consumer, "AGENTS.md"), "utf8");
    const claude = await readFile(join(consumer, "CLAUDE.md"), "utf8");
    expect(agents).toContain("<!-- supaschema:agent-guidance:start -->");
    expect(agents).toContain("Schema intent belongs in `database/schemas`");
    expect(claude).toContain("<!-- supaschema:agent-guidance:start -->");

    await run("node", ["bin/postinstall.mjs"], { env });
    const claudeSettings = JSON.parse(
      await readFile(join(consumer, ".claude/settings.json"), "utf8")
    );
    const codexHooks = JSON.parse(await readFile(join(consumer, ".codex/hooks.json"), "utf8"));
    expect(claudeSettings.enabledMcpjsonServers).toBeUndefined();
    expect(commandCount(claudeSettings, legacyClaudeSkillGateCommand)).toBe(0);
    expect(hookCount(claudeSettings, "node", claudeGeneratedGateArgs)).toBe(1);
    expect(hookCount(claudeSettings, "node", claudeAutoDiffArgs)).toBe(1);
    expect(hookCount(claudeSettings, "node", claudeLlmSyncArgs)).toBe(1);
    expect(commandCount(codexHooks, codexGateCommand)).toBe(1);
    expect(commandCount(codexHooks, codexLlmSyncCommand)).toBe(1);
    expect(blockCount(await readFile(join(consumer, "AGENTS.md"), "utf8"))).toBe(1);
  });

  it("uses Supabase paths when the project has Supabase local config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-supabase-"));
    await mkdir(join(consumer, "supabase"), { recursive: true });
    await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig("supabase/schemas", "supabase/migrations"));
    expect(existsSync(join(consumer, "supabase/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "supabase/migrations"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.adapter).toBe("auto");
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
    id,
    marker,
    markerContent,
    migrationsDir,
    schemaPath,
  }) => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-provider-"));
    await mkdir(dirname(join(consumer, marker)), { recursive: true });
    await writeFile(join(consumer, marker), markerContent);

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config).toEqual(expectedInstalledConfig(schemaPath, migrationsDir));
    expect(existsSync(join(consumer, schemaPath))).toBe(true);
    expect(existsSync(join(consumer, migrationsDir))).toBe(true);

    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.adapter).toBe("auto");
    expect(manifest.provider.id).toBe(id);
    expect(manifest.provider.markers).toContain(marker);
  });

  it("preserves an existing config and merges hook wiring", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-existing-"));
    await writeFile(join(consumer, "supaschema.config.json"), '{"adapter":"auto"}\n');
    await writeFile(join(consumer, "AGENTS.md"), "# Existing agents\n\nKeep this.\n");
    await writeFile(join(consumer, "CLAUDE.md"), "@AGENTS.md\n");
    await mkdir(join(consumer, ".claude"), { recursive: true });
    await writeFile(
      join(consumer, ".claude/settings.json"),
      `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ args: ["scripts/local-policy.mjs"], command: "node", type: "command" }],
            },
          ],
        },
      })}\n`
    );
    await mkdir(join(consumer, ".codex"), { recursive: true });
    await writeFile(
      join(consumer, ".codex/hooks.json"),
      `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ command: "echo existing", type: "command" }],
            },
          ],
        },
      })}\n`
    );
    const env = { ...process.env, INIT_CWD: consumer };

    const { stdout } = await run("node", ["bin/postinstall.mjs"], { env });
    expect(stdout).toContain("installed directories, agent files, hook wiring");
    expect(await readFile(join(consumer, "supaschema.config.json"), "utf8")).toBe(
      '{"adapter":"auto"}\n'
    );

    const agents = await readFile(join(consumer, "AGENTS.md"), "utf8");
    const claude = await readFile(join(consumer, "CLAUDE.md"), "utf8");
    expect(agents).toContain("# Existing agents");
    expect(agents).toContain("<!-- supaschema:agent-guidance:start -->");
    expect(claude).toContain("@AGENTS.md");
    expect(claude).toContain("<!-- supaschema:agent-guidance:start -->");

    const claudeSettings = JSON.parse(
      await readFile(join(consumer, ".claude/settings.json"), "utf8")
    );
    expect(hookCount(claudeSettings, "node", ["scripts/local-policy.mjs"])).toBe(1);
    expect(hookCount(claudeSettings, "node", claudeGeneratedGateArgs)).toBe(1);
    expect(hookCount(claudeSettings, "node", claudeLlmSyncArgs)).toBe(1);
    const codexHooks = JSON.parse(await readFile(join(consumer, ".codex/hooks.json"), "utf8"));
    expect(commandCount(codexHooks, "echo existing")).toBe(1);
    expect(commandCount(codexHooks, codexGateCommand)).toBe(1);
    expect(commandCount(codexHooks, codexLlmSyncCommand)).toBe(1);
  });

  it("scans existing schema and migration folders for the generated config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-scan-"));
    await mkdir(join(consumer, "database", "schema"), { recursive: true });
    await mkdir(join(consumer, "database", "migrations"), { recursive: true });
    await writeFile(join(consumer, "database", "schema", "schema.sql"), "create schema app;\n");
    await writeFile(
      join(consumer, "database", "migrations", "20260101000000_init.sql"),
      "select 1;\n"
    );

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    const config = JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"));
    expect(config.schemaPaths).toEqual(["database/schema"]);
    expect(config.migrationsDir).toBe("database/migrations");

    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(false);
    expect(manifest.candidates.schemaPaths).toContain("database/schema");
    expect(manifest.candidates.migrationsDirs).toContain("database/migrations");
  });

  it("records ambiguous scanned paths for agent confirmation", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-ambiguous-"));
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

    const { stdout } = await run("node", ["bin/postinstall.mjs"], {
      env: { ...process.env, INIT_CWD: consumer, CI: "1" },
    });
    expect(stdout).toContain("confirm detected schema/migration paths");

    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
    expect(manifest.candidates.schemaPaths).toEqual(["apps/api/schemas", "packages/db/schemas"]);

    const agents = await readFile(join(consumer, "AGENTS.md"), "utf8");
    expect(agents).toContain("Path confirmation is pending");
    expect(agents).toContain(".supaschema/install.json");
  });

  it("runs from the packed npm tarball with all required installer inputs", {
    timeout: 30_000,
  }, async () => {
    const packDir = await mkdtemp(join(tmpdir(), "supa-pack-"));
    const consumer = await mkdtemp(join(tmpdir(), "supa-packed-install-"));
    const extractDir = await mkdtemp(join(tmpdir(), "supa-pack-extract-"));
    const npm = npmExec(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir]);
    const { stdout } = await run(npm.file, npm.args);
    const [packed] = JSON.parse(stdout) as { filename: string }[];
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
    await run("node", [join(extractDir, "package", "bin", "postinstall.mjs")], {
      env: { ...process.env, INIT_CWD: consumer },
    });

    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(true);
    expect(existsSync(join(consumer, ".agents/skills/supaschema/SKILL.md"))).toBe(true);
    expect(existsSync(join(consumer, ".claude/rules/supaschema.md"))).toBe(true);
    expect(existsSync(join(consumer, ".codex/hooks.json"))).toBe(true);
    expect(existsSync(join(consumer, ".vscode/settings.json"))).toBe(false);
    expect(existsSync(join(consumer, ".mcp.json"))).toBe(false);
    expect(existsSync(join(consumer, ".claude/cclsp.json"))).toBe(false);
    expect(existsSync(join(consumer, "postgres-language-server.jsonc"))).toBe(false);
    expect(existsSync(join(consumer, "pyproject.toml"))).toBe(false);
    expect(existsSync(join(consumer, "components.json"))).toBe(false);
    expect(await readFile(join(consumer, "AGENTS.md"), "utf8")).toContain(
      "<!-- supaschema:agent-guidance:start -->"
    );
  });

  it("does nothing inside supaschema's own checkout", async () => {
    const env = { ...process.env, INIT_CWD: process.cwd() };

    const { stdout } = await run("node", ["bin/postinstall.mjs"], { env });

    expect(stdout).toBe("");
  });

  it("keeps the install manifest byte-identical on a no-op re-install", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-idempotent-"));
    const env = { ...process.env, INIT_CWD: consumer };

    await run("node", ["bin/postinstall.mjs"], { env });
    const first = await readFile(join(consumer, ".supaschema/install.json"), "utf8");
    await run("node", ["bin/postinstall.mjs"], { env });
    const second = await readFile(join(consumer, ".supaschema/install.json"), "utf8");

    expect(second).toBe(first);
  });

  it("resolves a sparse existing config through the CLI defaults, not provider detection", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-sparse-"));
    await mkdir(join(consumer, "supabase"), { recursive: true });
    await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");
    await writeFile(join(consumer, "supaschema.config.json"), "{}\n");

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    // The CLI loads this sparse config with its static defaults; normal install preserves
    // the user-owned JSON while guidance, directories, and manifest stay aligned with
    // what the CLI actually diffs.
    expect(await readFile(join(consumer, "supaschema.config.json"), "utf8")).toBe("{}\n");
    expect(await readFile(join(consumer, "AGENTS.md"), "utf8")).toContain(
      "Schema intent belongs in `database/schemas`"
    );
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.schemaPaths).toEqual(["database/schemas"]);
    expect(manifest.migrationsDir).toBe("database/migrations");
  });

  it("ignores JavaScript config files and writes the canonical JSON config", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-module-"));
    await writeFile(
      join(consumer, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/changes" };\n'
    );

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    expect(await readFile(join(consumer, "AGENTS.md"), "utf8")).toContain(
      "Schema intent belongs in `database/schemas`"
    );
    expect(existsSync(join(consumer, "db/sql"))).toBe(false);
    expect(existsSync(join(consumer, "db/changes"))).toBe(false);
    expect(existsSync(join(consumer, "database/schemas"))).toBe(true);
    expect(existsSync(join(consumer, "database/migrations"))).toBe(true);
    expect(JSON.parse(await readFile(join(consumer, "supaschema.config.json"), "utf8"))).toEqual(
      expectedInstalledConfig("database/schemas", "database/migrations")
    );
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.schemaPaths).toEqual(["database/schemas"]);
    expect(manifest.migrationsDir).toBe("database/migrations");
    expect(manifest.existingConfig).toBeUndefined();
  });

  it("does not scaffold a guessed config while path confirmation is pending", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-pending-"));
    await mkdir(join(consumer, "apps", "api", "schemas"), { recursive: true });
    await mkdir(join(consumer, "packages", "db", "schemas"), { recursive: true });
    await writeFile(join(consumer, "apps", "api", "schemas", "schema.sql"), "create schema app;\n");
    await writeFile(
      join(consumer, "packages", "db", "schemas", "schema.sql"),
      "create schema app;\n"
    );

    await run("node", ["bin/postinstall.mjs"], {
      env: { ...process.env, INIT_CWD: consumer, CI: "1" },
    });

    // Ambiguous detection must not pin a guessed config; "config explicitly defines
    // schemaPaths" then cleanly means a human confirmed, which the auto-diff hook relies on.
    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(consumer, ".supaschema/install.json"), "utf8"));
    expect(manifest.pathConfirmationNeeded).toBe(true);
  });

  it("de-dupes a legacy-format codex hook command on upgrade", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-upgrade-"));
    await mkdir(join(consumer, ".codex"), { recursive: true });
    const legacyAutoDiff =
      'node "$(git rev-parse --show-toplevel)/.codex/hooks/auto-diff-on-schema-change.mjs"';
    const legacyGate =
      'node "$(git rev-parse --show-toplevel)/.codex/hooks/block-generated-migration-edits.mjs"';
    const legacyLlmSync =
      'node "$(git rev-parse --show-toplevel)/.codex/hooks/sync-llm-on-claude-surface-change.mjs"';
    await writeFile(
      join(consumer, ".codex/hooks.json"),
      `${JSON.stringify({
        hooks: {
          PostToolUse: [
            { hooks: [{ command: legacyAutoDiff, type: "command" }] },
            { hooks: [{ command: legacyLlmSync, type: "command" }] },
          ],
          PreToolUse: [{ hooks: [{ command: legacyGate, type: "command" }] }],
        },
      })}\n`
    );

    await run("node", ["bin/postinstall.mjs"], { env: { ...process.env, INIT_CWD: consumer } });

    const codexHooks = JSON.parse(await readFile(join(consumer, ".codex/hooks.json"), "utf8"));
    // The old wrapper and the new ${CODEX_PROJECT_DIR} form target the same managed
    // script; only the new entry survives so diff/check do not run twice per edit.
    expect(commandCount(codexHooks, legacyAutoDiff)).toBe(0);
    expect(commandCount(codexHooks, legacyGate)).toBe(0);
    expect(commandCount(codexHooks, legacyLlmSync)).toBe(0);
    expect(commandCount(codexHooks, codexAutoDiffCommand)).toBe(1);
    expect(commandCount(codexHooks, codexGateCommand)).toBe(1);
    expect(commandCount(codexHooks, codexLlmSyncCommand)).toBe(1);
  });

  it("skips all scaffolding when SUPASCHEMA_SKIP_POSTINSTALL is set", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "supa-postinstall-skip-"));

    const { stdout } = await run("node", ["bin/postinstall.mjs"], {
      env: { ...process.env, INIT_CWD: consumer, SUPASCHEMA_SKIP_POSTINSTALL: "1" },
    });

    expect(stdout).toBe("");
    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(false);
    expect(existsSync(join(consumer, ".supaschema/install.json"))).toBe(false);
    expect(existsSync(join(consumer, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(consumer, ".codex"))).toBe(false);
  });
});

function npmExec(args: string[]): { args: string[]; file: string } {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return { args: [npmExecPath, ...args], file: process.execPath };
  }
  return { args, file: process.platform === "win32" ? "npm.cmd" : "npm" };
}

function commandCount(value: unknown, command: string): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + commandCount(item, command), 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (count, [key, item]) =>
        count + (key === "command" && item === command ? 1 : commandCount(item, command)),
      0
    );
  }
  return 0;
}

function hookCount(value: unknown, command: string, args: string[]): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + hookCount(item, command, args), 0);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const own =
      record.command === command &&
      Array.isArray(record.args) &&
      JSON.stringify(record.args) === JSON.stringify(args)
        ? 1
        : 0;
    return Object.values(record).reduce(
      (count, item) => count + hookCount(item, command, args),
      own
    );
  }
  return 0;
}

function blockCount(value: string): number {
  return value.split("<!-- supaschema:agent-guidance:start -->").length - 1;
}
