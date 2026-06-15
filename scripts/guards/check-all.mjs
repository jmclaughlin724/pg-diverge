#!/usr/bin/env node
import { ok, run } from "./lib/guard-utils.js";

const guards = [
  ["node", ["scripts/guards/check-code-atlas.mjs"]],
  ["node", ["scripts/guards/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/check-fastmcp-agent.mjs"]],
  ["node", ["scripts/guards/check-dependency-catalog.mjs"]],
  ["node", ["scripts/guards/check-lsp-coverage.mjs"]],
  ["node", ["scripts/guards/check-agent-hooks.mjs"]],
  ["node", ["scripts/guards/check-agent-surface-parity.mjs"]],
  ["node", ["scripts/guards/check-no-regex-in-scripts.mjs"]],
];

for (const [command, args] of guards) {
  run(command, args, { stdio: "inherit" });
}

ok("ALL_GUARDS_OK");
