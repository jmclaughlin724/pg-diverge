import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function readText(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function findHookMatcher(config: unknown, commandFragment: string): string | undefined {
  if (!(config && typeof config === "object")) {
    return;
  }
  const hooksRoot = Reflect.get(config, "hooks");
  if (!(hooksRoot && typeof hooksRoot === "object")) {
    return;
  }
  const postToolUse = Reflect.get(hooksRoot, "PostToolUse");
  if (!Array.isArray(postToolUse)) {
    return;
  }
  for (const entry of postToolUse) {
    if (!(entry && typeof entry === "object")) {
      continue;
    }
    const hooks = Reflect.get(entry, "hooks");
    const matcher = Reflect.get(entry, "matcher");
    if (
      Array.isArray(hooks) &&
      hooks.some(
        (hook) =>
          hook &&
          typeof hook === "object" &&
          typeof Reflect.get(hook, "command") === "string" &&
          Reflect.get(hook, "command").includes(commandFragment)
      )
    ) {
      return typeof matcher === "string" ? matcher : undefined;
    }
  }
}

function findStopHookCommand(config: unknown, commandFragment: string): string | undefined {
  if (!(config && typeof config === "object")) {
    return;
  }
  const hooksRoot = Reflect.get(config, "hooks");
  if (!(hooksRoot && typeof hooksRoot === "object")) {
    return;
  }
  const stop = Reflect.get(hooksRoot, "Stop");
  if (!Array.isArray(stop)) {
    return;
  }
  for (const entry of stop) {
    if (!(entry && typeof entry === "object")) {
      continue;
    }
    const hooks = Reflect.get(entry, "hooks");
    if (!Array.isArray(hooks)) {
      continue;
    }
    for (const hook of hooks) {
      if (
        hook &&
        typeof hook === "object" &&
        typeof Reflect.get(hook, "command") === "string" &&
        Reflect.get(hook, "command").includes(commandFragment)
      ) {
        return Reflect.get(hook, "command");
      }
    }
  }
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && existsSync(resolve(root, file)));
}

function stageableFiles(paths: string[]): string[] {
  return execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...paths], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function ignoredFiles(paths: string[]): string[] {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: paths.join("\n"),
  });
  return result.stdout.split("\n").filter(Boolean).sort();
}

describe("public agent and editor surfaces", () => {
  it("keeps private maintainer and operator files out of the public repository", () => {
    const files = trackedFiles();
    const privateAgentFiles = [
      ".agents/prompts/internal.md",
      ".agents/skills/elegant/SKILL.md",
      ".agents/tmp.json",
      ".claude/agents/elegant.md",
      ".claude/skills/elegant/SKILL.md",
      ".codex/agents/elegant.toml",
      ".codex/config.toml",
    ];
    expect(ignoredFiles(privateAgentFiles)).toEqual([...privateAgentFiles].sort());
    expect(stageableFiles([".agents", ".claude", ".codex"])).toEqual([]);
    const privateFiles = [
      ".mcp.json",
      ".vscode/settings.json",
      ".vscode/extensions.json",
      ".codex/config.toml",
      "fastmcp.json",
      "pyproject.toml",
      "uv.lock",
      "wrangler.toml",
    ];
    for (const file of privateFiles) {
      expect(files, file).not.toContain(file);
    }
    expect(ignoredFiles(privateFiles.filter((file) => existsSync(resolve(root, file))))).toEqual(
      privateFiles.filter((file) => existsSync(resolve(root, file))).sort()
    );
    expect(stageableFiles(privateFiles)).toEqual([]);
    expect(existsSync(resolve(root, "cclsp.json"))).toBe(true);
    expect(ignoredFiles(["cclsp.json"])).toEqual([]);
    expect(
      files.includes("cclsp.json") || stageableFiles(["cclsp.json"]).includes("cclsp.json")
    ).toBe(true);
    const privatePrefixes = [
      "advisor-plans/",
      "cloudflare/",
      "scripts/code-atlas/",
      "scripts/stripe/",
      "services/agent-mcp/",
      "services/license-worker/",
    ];
    for (const prefix of privatePrefixes) {
      expect(
        files.some((file) => file.startsWith(prefix)),
        prefix
      ).toBe(false);
    }
    expect(stageableFiles(privatePrefixes)).toEqual([]);
  }, 15_000);

  it("ships self-contained raw consumer hook registration", () => {
    const packageJson = readJson<{ files?: string[] }>("package.json");
    const codexHooks = readText("agent-bundle/codex/hooks.npm.json");
    const claudeBashGuard = readText("agent-bundle/claude/hooks/guards/bash-policy-checks.mjs");
    const codexGeneralGuard = readText("agent-bundle/codex/hooks/general-guard.mjs");

    expect(packageJson.files).toEqual(expect.arrayContaining(["agent-bundle"]));
    expect(packageJson.files).not.toEqual(
      expect.arrayContaining([".agents/skills/supaschema", ".claude/rules/supaschema.md"])
    );
    expect(codexHooks).toContain("general-guard.mjs");
    expect(codexHooks).toContain("supaschema hook generated-migration-edit");
    expect(codexHooks).toContain("supaschema hook schema-write");
    expect(codexHooks).not.toContain("context-");
    expect(codexHooks).not.toContain("scripts/agent-hooks");
    expect(findHookMatcher(JSON.parse(codexHooks), "sync-llm-on-claude-surface-change.mjs")).toBe(
      "apply_patch"
    );
    expect(
      findStopHookCommand(JSON.parse(codexHooks), "sync-llm-on-claude-surface-change.mjs")
    ).toBe(`node "\${CODEX_PROJECT_DIR:-$PWD}/.codex/hooks/sync-llm-on-claude-surface-change.mjs"`);
    expect(claudeBashGuard).not.toContain("user-codex-skill-policy");
    expect(codexGeneralGuard).not.toContain("user-codex-skill-policy");
  });
});
