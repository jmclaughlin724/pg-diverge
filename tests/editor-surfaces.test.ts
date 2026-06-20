import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const allowedAgentFiles = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/settings.json",
  ".claude/hooks/context-permission-denied.mjs",
  ".claude/hooks/context-post-tool-use.mjs",
  ".claude/hooks/context-pre-tool-use.mjs",
  ".claude/hooks/context-session-end.mjs",
  ".claude/hooks/context-session-start.mjs",
  ".claude/hooks/context-stop.mjs",
  ".claude/hooks/context-subagent-start.mjs",
  ".claude/hooks/context-subagent-stop.mjs",
  ".claude/hooks/context-task-completed.mjs",
  ".claude/hooks/context-user-prompt-submit.mjs",
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".claude/hooks/supaschema-source-hook.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/01-operating-rules.md",
  ".claude/rules/02-mintlify-writing-standards.md",
  ".claude/rules/03-mintlify-component-reference.md",
  ".claude/rules/04-python-toolchain.md",
  ".claude/rules/05-decision-protocol.md",
  ".claude/rules/06-multi-language-toolchain.md",
  ".claude/rules/07-ast-over-regex.md",
  ".claude/rules/08-biome-ultracite-policy.md",
  ".claude/rules/09-ci-cd-efficiency-governance.md",
  ".claude/rules/10-code-atlas.md",
  ".claude/rules/11-agent-mcp-fastmcp.md",
  ".claude/rules/12-skill-loading-enforcement.md",
  ".claude/rules/13-npm-package-boundary.md",
  ".claude/rules/14-editing-worktree-git.md",
  ".claude/rules/15-security.md",
  ".claude/rules/16-file-size-and-composition.md",
  ".claude/rules/17-prompt-craft-standards.md",
  ".claude/rules/18-context-surface-sync.md",
  ".claude/rules/19-version-control-release.md",
  ".claude/rules/20-anti-patterns.md",
  ".claude/rules/21-github-process.md",
  ".claude/rules/22-agent-surface-sync-ownership.md",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks.json",
  ".codex/hooks/context-permission-denied.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-session-end.mjs",
  ".codex/hooks/context-session-start.mjs",
  ".codex/hooks/context-stop.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-task-completed.mjs",
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/supaschema-source-hook.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/rules/01-operating-rules.rules",
  ".codex/rules/02-mintlify-writing-standards.rules",
  ".codex/rules/03-mintlify-component-reference.rules",
  ".codex/rules/04-python-toolchain.rules",
  ".codex/rules/05-decision-protocol.rules",
  ".codex/rules/06-multi-language-toolchain.rules",
  ".codex/rules/07-ast-over-regex.rules",
  ".codex/rules/08-biome-ultracite-policy.rules",
  ".codex/rules/09-ci-cd-efficiency-governance.rules",
  ".codex/rules/10-code-atlas.rules",
  ".codex/rules/11-agent-mcp-fastmcp.rules",
  ".codex/rules/12-skill-loading-enforcement.rules",
  ".codex/rules/13-npm-package-boundary.rules",
  ".codex/rules/14-editing-worktree-git.rules",
  ".codex/rules/15-security.rules",
  ".codex/rules/16-file-size-and-composition.rules",
  ".codex/rules/17-prompt-craft-standards.rules",
  ".codex/rules/18-context-surface-sync.rules",
  ".codex/rules/19-version-control-release.rules",
  ".codex/rules/20-anti-patterns.rules",
  ".codex/rules/21-github-process.rules",
  ".codex/rules/22-agent-surface-sync-ownership.rules",
  ".codex/rules/supaschema.rules",
];

const sourceRepoAgentRuntimeFiles = [
  "scripts/agent-hooks/atlas.mjs",
  "scripts/agent-hooks/detectors.mjs",
  "scripts/agent-hooks/payload.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/skills.mjs",
  "scripts/agent-hooks/state.mjs",
];

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
  it("exposes only reviewed source-repo agent surfaces", () => {
    const agentFiles = trackedFiles().filter(
      (file) =>
        file.startsWith(".agents/") || file.startsWith(".claude/") || file.startsWith(".codex/")
    );
    const agentRuntimeFiles = trackedFiles().filter((file) =>
      file.startsWith("scripts/agent-hooks/")
    );

    expect(agentFiles.sort()).toEqual([...allowedAgentFiles].sort());
    expect(agentRuntimeFiles.sort()).toEqual([...sourceRepoAgentRuntimeFiles].sort());
    for (const file of allowedAgentFiles) {
      expect(existsSync(resolve(root, file)), file).toBe(true);
    }
    for (const file of sourceRepoAgentRuntimeFiles) {
      expect(existsSync(resolve(root, file)), file).toBe(true);
    }
    expect(ignoredFiles([...allowedAgentFiles, ...sourceRepoAgentRuntimeFiles])).toEqual([]);
  });

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
    expect(ignoredFiles([...allowedAgentFiles, ...sourceRepoAgentRuntimeFiles])).toEqual([]);
    expect(
      stageableFiles([".agents", ".claude", ".codex"]).filter(
        (file) => !allowedAgentFiles.includes(file)
      )
    ).toEqual([]);
    const privateFiles = [
      ".mcp.json",
      ".vscode/settings.json",
      ".vscode/extensions.json",
      ".claude/cclsp.json",
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
  });

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
    expect(
      findHookMatcher(JSON.parse(codexHooks), "sync-llm-on-claude-surface-change.mjs")
    ).toBeUndefined();
    expect(
      findStopHookCommand(JSON.parse(codexHooks), "sync-llm-on-claude-surface-change.mjs")
    ).toBeDefined();
    expect(claudeBashGuard).not.toContain("user-codex-skill-policy");
    expect(codexGeneralGuard).not.toContain("user-codex-skill-policy");
  });
});
