import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const workspaceFolder = ["$", "{", "workspaceFolder", "}"].join("");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

describe("editor and language-server surfaces", () => {
  it("wires maintainer-only Python, Postgres, YAML, and formatter settings", () => {
    const settings = readJson<Record<string, unknown>>(".vscode/settings.json");

    expect(settings["//scope"]).toContain("Maintainer workspace");
    expect(settings["tailwindCSS.classFunctions"]).toBeUndefined();
    expect(settings["tailwindCSS.experimental.classRegex"]).toBeUndefined();
    expect(settings["files.associations"]).toBeUndefined();
    expect(settings["yaml.schemas"]).toMatchObject({
      "https://www.schemastore.org/github-action.json": ["action.yml", "action.yaml"],
      "https://www.schemastore.org/github-workflow.json": [
        ".github/workflows/*.yml",
        ".github/workflows/*.yaml",
      ],
    });
    expect(settings["biome.enabled"]).toBe(true);
    expect(settings["js/ts.tsdk.path"]).toBe("node_modules/typescript/lib");
    expect(settings["postgres-language-server.configFile"]).toBe(
      `${workspaceFolder}/postgres-language-server.jsonc`
    );
    expect(settings["python.defaultInterpreterPath"]).toBe(`${workspaceFolder}/.venv/bin/python`);
    expect(settings.pylsp).toMatchObject({
      plugins: {
        black: { enabled: true, line_length: 100 },
        isort: { enabled: true },
        ruff: { enabled: true, formatEnabled: false, extendIgnore: ["E501", "E203"] },
      },
    });
  });

  it("declares concrete Postgres Language Server config and no deferred shadcn surface", () => {
    const settings = readJson<{
      "json.schemaDownload.trustedDomains"?: Record<string, boolean>;
      "json.schemas"?: Array<{ fileMatch?: string[]; url?: string }>;
    }>(".vscode/settings.json");
    const pgls = readJson<{
      $schema?: string;
      files?: { ignore?: string[]; include?: string[] };
      migrations?: { migrationsDir?: string };
    }>("postgres-language-server.jsonc");

    expect(settings["json.schemaDownload.trustedDomains"]).toMatchObject({
      "https://pg-language-server.com/": true,
    });
    expect(
      settings["json.schemaDownload.trustedDomains"]?.["https://ui.shadcn.com/"]
    ).toBeUndefined();
    expect(settings["json.schemas"]).not.toContainEqual(
      expect.objectContaining({ fileMatch: ["components.json"] })
    );
    expect(settings["json.schemas"]).toContainEqual({
      fileMatch: ["postgres-language-server.jsonc"],
      url: "https://pg-language-server.com/latest/schema.json",
    });
    expect(existsSync(resolve(root, "components.json"))).toBe(false);
    expect(existsSync(resolve(root, "styles/globals.css"))).toBe(false);
    expect(pgls.$schema).toBe("https://pg-language-server.com/latest/schema.json");
    expect(pgls.files?.include).toEqual(
      expect.arrayContaining([
        "database/migrations/**/*.sql",
        "supabase/migrations/**/*.sql",
        "neon/migrations/**/*.sql",
        "aws-postgresql/migrations/**/*.sql",
        "alloydb/migrations/**/*.sql",
        "azure-postgresql/migrations/**/*.sql",
      ])
    );
    expect(pgls.files?.ignore).toEqual(
      expect.arrayContaining([
        "corpus/**",
        "tests/fixtures/**",
        "supabase/schemas/**",
        "aws-postgresql/schemas/**",
      ])
    );
    expect(pgls.migrations?.migrationsDir).toBe("database/migrations");
  });

  it("uses current package names for agent LSP servers", () => {
    const packageJson = readJson<{
      devDependencies?: Record<string, string>;
    }>("package.json");
    const catalog = readJson<{
      devDependencies?: Record<string, string>;
    }>("scripts/dependency-catalog.json");
    const cclsp = readJson<{
      servers?: Array<{ command?: string[]; extensions?: string[] }>;
    }>(".claude/cclsp.json");
    const commands = cclsp.servers?.map((server) => server.command?.join(" ")) ?? [];

    expect(packageJson.devDependencies?.["@postgres-language-server/cli"]).toBe("0.25.3");
    expect(packageJson.devDependencies?.["@postgrestools/postgrestools"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@tailwindcss/language-server"]).toBeUndefined();
    // The dependency catalog is slimmed to cross-surface pins only (packageManager +
    // mcpTools). Language-server versions are sourced from package.json and echoed
    // into .claude/cclsp.json (reconciled by check-dependency-catalog.mjs), never
    // duplicated into the catalog — so the catalog carries no devDependencies.
    expect(catalog.devDependencies).toBeUndefined();
    expect(commands).toContain(
      "npx --yes --package @postgres-language-server/cli@0.25.3 postgres-language-server lsp-proxy"
    );
    expect(commands.some((command) => command.includes("tailwindcss-language-server"))).toBe(false);
  });

  it("keeps maintainer-only tooling out of published consumer files", () => {
    const packageJson = readJson<{ files?: string[] }>("package.json");
    const files = packageJson.files ?? [];

    expect(existsSync(resolve(root, ".npmignore"))).toBe(false);
    expect(files).toEqual(
      expect.arrayContaining([
        ".agents/skills/supaschema",
        ".claude/hooks/auto-diff-on-schema-change.mjs",
        ".claude/hooks/block-generated-migration-edits.mjs",
        ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
        ".claude/rules/supaschema.md",
        ".claude/skills/supaschema",
        ".codex/hooks/auto-diff-on-schema-change.mjs",
        ".codex/hooks/block-generated-migration-edits.mjs",
        ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
        ".codex/rules/supaschema.rules",
        ".codex/skills/supaschema",
      ])
    );
    expect(files).not.toEqual(expect.arrayContaining([".vscode", ".mcp.json"]));
    expect(files).not.toContain(".claude/cclsp.json");
    expect(files).not.toContain(".claude/settings.json");
    expect(files).not.toContain("postgres-language-server.jsonc");
    expect(files).not.toContain("pyproject.toml");
    expect(files).not.toContain("components.json");
    expect(files).not.toContain("styles/globals.css");
  });
});
