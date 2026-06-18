#!/usr/bin/env node
import { assert, exists, gitFiles, ok } from "./lib/guard-utils.js";

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

function isPrivateAgentSurface(file) {
  if (allowed.has(file)) {
    return false;
  }
  return file.startsWith(".agents/") || file.startsWith(".claude/") || file.startsWith(".codex/");
}

const leaked = gitFiles()
  .filter(exists)
  .filter(
    (file) =>
      privateExact.has(file) ||
      privatePrefixes.some((prefix) => file.startsWith(prefix)) ||
      isPrivateAgentSurface(file)
  );

assert(
  leaked.length === 0,
  `private surfaces are tracked publicly:\n${leaked.map((file) => `- ${file}`).join("\n")}`
);

ok("PUBLIC_REPO_SURFACE_OK");
