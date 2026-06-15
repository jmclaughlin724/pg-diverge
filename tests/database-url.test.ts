import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "../src/database-url.js";

const run = promisify(execFile);
const codexProjectDir = shellParameter("CODEX_PROJECT_DIR:-$PWD");
const claudeProjectDir = shellParameter("CLAUDE_PROJECT_DIR");
const codexGateCommand = `node "${codexProjectDir}/.codex/hooks/supaschema-tool-gate.mjs"`;
const claudeSkillGateCommand = `${claudeProjectDir}/.claude/hooks/skill_gate.sh`;
const managedSchemas = [
  "auth",
  "storage",
  "realtime",
  "vault",
  "extensions",
  "cron",
  "net",
  "supabase_functions",
  "graphql",
  "graphql_public",
];

function shellParameter(expression: string): string {
  return ["$", "{", expression, "}"].join("");
}

function expectedInstalledConfig(
  schemaPath: string,
  migrationsDir: string
): Record<string, unknown> {
  return {
    $schema: "./node_modules/supaschema/config-schema.json",
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: {},
    excludedGrantRoles: [],
    hints: {
      destructive: [],
      renames: [],
    },
    idempotency: "required",
    lockTimeout: "5s",
    migrationsDir,
    typesFile: "database.types.ts",
    zodFile: "database.zod.ts",
    normalize: "deparse",
    managedSchemas,
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths: [schemaPath],
    schemas: {
      exclude: [],
      include: [],
    },
    statementTimeout: "60s",
    transactionMode: "per-migration",
    validators: ["internal-parser"],
  };
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
      ".claude/rules/supaschema.md",
      ".claude/settings.json",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks/auto-diff-on-schema-change.mjs",
      ".codex/hooks/supaschema-tool-gate.mjs",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
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
    expect(commandCount(claudeSettings, claudeSkillGateCommand)).toBe(0);
    expect(
      commandCount(
        claudeSettings,
        'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/block-generated-migration-edits.mjs'
      )
    ).toBe(1);
    expect(commandCount(codexHooks, codexGateCommand)).toBe(1);
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
    await writeFile(join(consumer, "supaschema.config.json"), '{"adapter":"postgres"}\n');
    await writeFile(join(consumer, "AGENTS.md"), "# Existing agents\n\nKeep this.\n");
    await writeFile(join(consumer, "CLAUDE.md"), "@AGENTS.md\n");
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
      '{"adapter":"postgres"}\n'
    );

    const agents = await readFile(join(consumer, "AGENTS.md"), "utf8");
    const claude = await readFile(join(consumer, "CLAUDE.md"), "utf8");
    expect(agents).toContain("# Existing agents");
    expect(agents).toContain("<!-- supaschema:agent-guidance:start -->");
    expect(claude).toContain("@AGENTS.md");
    expect(claude).toContain("<!-- supaschema:agent-guidance:start -->");

    const codexHooks = JSON.parse(await readFile(join(consumer, ".codex/hooks.json"), "utf8"));
    expect(commandCount(codexHooks, "echo existing")).toBe(1);
    expect(commandCount(codexHooks, codexGateCommand)).toBe(1);
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

function blockCount(value: string): number {
  return value.split("<!-- supaschema:agent-guidance:start -->").length - 1;
}
