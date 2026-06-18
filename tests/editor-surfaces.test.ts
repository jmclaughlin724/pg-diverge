import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const allowedAgentFiles = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks.json",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/rules/supaschema.rules",
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function readText(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file && existsSync(resolve(root, file)));
}

describe("public agent and editor surfaces", () => {
  it("tracks only the consumer supaschema agent bundle", () => {
    const agentFiles = trackedFiles().filter(
      (file) =>
        file.startsWith(".agents/") || file.startsWith(".claude/") || file.startsWith(".codex/")
    );

    expect(agentFiles.sort()).toEqual([...allowedAgentFiles].sort());
    for (const file of allowedAgentFiles) {
      expect(existsSync(resolve(root, file)), file).toBe(true);
    }
  });

  it("keeps private maintainer and operator files out of the public repository", () => {
    const files = trackedFiles();
    for (const file of [
      ".mcp.json",
      ".vscode/settings.json",
      ".vscode/extensions.json",
      ".claude/cclsp.json",
      ".claude/settings.json",
      ".codex/config.toml",
      "fastmcp.json",
      "pyproject.toml",
      "uv.lock",
      "wrangler.toml",
    ]) {
      expect(files, file).not.toContain(file);
      expect(existsSync(resolve(root, file)), file).toBe(false);
    }
    for (const prefix of [
      "advisor-plans/",
      "cloudflare/",
      "scripts/agent-hooks/",
      "scripts/code-atlas/",
      "scripts/stripe/",
      "services/agent-mcp/",
      "services/license-worker/",
    ]) {
      expect(
        files.some((file) => file.startsWith(prefix)),
        prefix
      ).toBe(false);
    }
  });

  it("ships self-contained consumer hook registration", () => {
    const packageJson = readJson<{ files?: string[] }>("package.json");
    const codexHooks = readText(".codex/hooks.json");
    const claudeBashGuard = readText(".claude/hooks/guards/bash-policy-checks.mjs");
    const codexGeneralGuard = readText(".codex/hooks/general-guard.mjs");

    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        ".agents/skills/supaschema",
        ".claude/hooks/guards/bash-policy-checks.mjs",
        ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
        ".claude/rules/supaschema.md",
        ".claude/skills/supaschema",
        ".codex/hooks/general-guard.mjs",
        ".codex/hooks/guards/bash-policy-checks.mjs",
        ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
        ".codex/hooks.json",
        ".codex/rules/supaschema.rules",
      ])
    );
    expect(codexHooks).toContain("general-guard.mjs");
    expect(codexHooks).toContain("supaschema hook generated-migration-edit");
    expect(codexHooks).toContain("supaschema hook schema-write");
    expect(codexHooks).not.toContain("context-");
    expect(codexHooks).not.toContain("scripts/agent-hooks");
    expect(claudeBashGuard).not.toContain("user-codex-skill-policy");
    expect(codexGeneralGuard).not.toContain("user-codex-skill-policy");
  });
});
