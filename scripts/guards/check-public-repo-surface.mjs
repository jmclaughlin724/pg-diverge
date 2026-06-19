#!/usr/bin/env node
import { assert, exists, ok, run } from "./lib/guard-utils.js";

const allowed = new Set([
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
]);

const privatePrefixes = [
  ".planning/",
  ".vscode/",
  "advisor-plans/",
  "cloudflare/",
  "scripts/agent-hooks/",
  "scripts/code-atlas/",
  "scripts/stripe/",
  "services/agent-mcp/",
  "services/license-worker/",
];

const privateExact = new Set([
  ".mcp.json",
  "fastmcp.json",
  "pyproject.toml",
  "uv.lock",
  "wrangler.toml",
]);

function gitPaths(args) {
  return run("git", [...args, "-z"])
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
}

function isPrivateAgentSurface(file) {
  if (allowed.has(file)) {
    return false;
  }
  return file.startsWith(".agents/") || file.startsWith(".claude/") || file.startsWith(".codex/");
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

const tracked = gitPaths(["ls-files", "--cached"]).filter(exists).filter(isPrivateSurface);

const stageable = gitPaths(["ls-files", "--others", "--exclude-standard"])
  .filter(exists)
  .filter(isPrivateSurface);

assert(tracked.length === 0 && stageable.length === 0, failureMessage(tracked, stageable));

ok("PUBLIC_REPO_SURFACE_OK");
