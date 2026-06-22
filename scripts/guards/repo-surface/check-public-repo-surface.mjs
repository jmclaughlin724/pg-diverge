#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, exists, ok, ROOT, run } from "../lib/guard-utils.js";

const allowed = new Set([
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/settings.json",
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks.json",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/rules/supaschema.rules",
]);

const sourceRepoAgentRuntime = new Set([
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
  ".claude/hooks/supaschema-source-hook.mjs",
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
  ".codex/hooks/supaschema-source-hook.mjs",
]);

const privatePrefixes = [
  ".planning/",
  ".vscode/",
  "advisor-plans/",
  "cloudflare/",
  "scripts/code-atlas/",
  "scripts/stripe/",
  "services/agent-mcp/",
  "services/license-worker/",
];

const privateExact = new Set([
  ".github/workflows/python.yml",
  ".mcp.json",
  "fastmcp.json",
  "pyproject.toml",
  "uv.lock",
  "wrangler.toml",
]);

function gitPaths(args, root) {
  return run("git", [...args, "-z"], {}, root)
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
}

function isPrivateAgentSurface(file) {
  if (isPublicAgentSurface(file)) {
    return false;
  }
  return file.startsWith(".agents/") || file.startsWith(".claude/") || file.startsWith(".codex/");
}

function isPublicAgentSurface(file) {
  return (
    allowed.has(file) ||
    sourceRepoAgentRuntime.has(file) ||
    isPublicClaudeRule(file) ||
    isPublicCodexRule(file)
  );
}

function isPublicClaudeRule(file) {
  return file.startsWith(".claude/rules/") && file.endsWith(".md");
}

function isPublicCodexRule(file) {
  return file.startsWith(".codex/rules/") && file.endsWith(".rules");
}

function isPrivateSurface(file) {
  return (
    privateExact.has(file) ||
    privatePrefixes.some((prefix) => file.startsWith(prefix)) ||
    isPrivateAgentSurface(file)
  );
}

function bulletList(files) {
  return files.map((file) => `- ${file}`).join("\n");
}

function failureMessage(tracked, stageable) {
  const sections = ["private surfaces must stay local-only"];
  if (tracked.length > 0) {
    sections.push(`tracked public GitHub exposure:\n${bulletList(tracked)}`);
  }
  if (stageable.length > 0) {
    sections.push(`unignored local files that could be staged:\n${bulletList(stageable)}`);
  }
  sections.push(
    [
      "FIX BY:",
      "- keep the local files on disk",
      "- add or repair .gitignore coverage for unignored private paths",
      "- remove tracked private paths with git rm --cached -- <path>",
      "- do not delete local skills, agents, rules, or hooks to satisfy this guard",
    ].join("\n")
  );
  return sections.join("\n\n");
}

export function check(root = ROOT) {
  const tracked = gitPaths(["ls-files", "--cached"], root)
    .filter((file) => exists(file, root))
    .filter(isPrivateSurface);

  const stageable = gitPaths(["ls-files", "--others", "--exclude-standard"], root)
    .filter((file) => exists(file, root))
    .filter(isPrivateSurface);

  assert(tracked.length === 0 && stageable.length === 0, failureMessage(tracked, stageable));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("PUBLIC_REPO_SURFACE_OK");
}
