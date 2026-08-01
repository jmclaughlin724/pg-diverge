#!/usr/bin/env node
import { ok } from "./lib/assertions.js";
import { run } from "./lib/process.js";
import { ROOT } from "./lib/repository.js";

const guards = [
  ["npm", ["run", "sync:llm"]],
  ["node", ["scripts/guards/toolchain/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/fastmcp/check-fastmcp-agent.mjs"]],
  ["node", ["scripts/guards/repo-surface/check-public-repo-surface.mjs"]],
  ["node", ["scripts/guards/toolchain/check-lsp-coverage.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-agent-hooks.mjs"]],
  ["node", ["scripts/guards/ci-release/check-codex-execpolicy.mjs"]],
  ["node", ["scripts/guards/code-shape/check-canonical-surfaces.mjs"]],
  ["node", ["scripts/guards/code-shape/check-child-process-shell.mjs"]],
  ["node", ["scripts/guards/code-shape/check-path-comparison.mjs"]],
  ["node", ["scripts/guards/repo-surface/check-repo-layout.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-claude-agents.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-hook-import-graph.mjs"]],
  ["node", ["scripts/guards/docs-config/check-schema.mjs"]],
  ["node", ["scripts/guards/docs-config/check-config-standardization.mjs"]],
  ["node", ["scripts/guards/docs-config/check-rule-citations.mjs"]],
  ["node", ["scripts/guards/ci-release/check-ci-governance.mjs"]],
  ["node", ["scripts/guards/ci-release/check-github-process.mjs"]],
  ["node", ["scripts/guards/ci-release/check-release-version-surfaces.mjs"]],
];

for (const [command, args] of guards) {
  run(command, args, { stdio: "inherit" }, ROOT);
}

ok("ALL_GUARDS_OK");
