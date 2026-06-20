#!/usr/bin/env node
import { ok, run } from "./lib/guard-utils.js";

const guards = [
  ["node", ["scripts/guards/check-code-atlas.mjs"]],
  ["node", ["scripts/guards/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/check-fastmcp-agent.mjs"]],
  ["node", ["scripts/guards/check-public-repo-surface.mjs"]],
  ["node", ["scripts/guards/check-dependency-catalog.mjs"]],
  ["node", ["scripts/guards/check-lsp-coverage.mjs"]],
  ["node", ["scripts/guards/check-agent-hooks.mjs"]],
  ["node", ["scripts/guards/check-codex-execpolicy.mjs"]],
  ["node", ["scripts/guards/check-agent-policy-standardization.mjs"]],
  ["node", ["scripts/guards/check-canonical-surfaces.mjs"]],
  ["node", ["scripts/guards/check-claude-agents.mjs"]],
  ["node", ["scripts/guards/check-hook-import-graph.mjs"]],
  ["node", ["scripts/guards/check-agent-surface-parity.mjs"]],
  ["node", ["scripts/check-schema.mjs"]],
  ["node", ["scripts/guards/check-config-standardization.mjs"]],
  ["node", ["scripts/guards/check-rule-citations.mjs"]],
  ["node", ["scripts/guards/check-ci-governance.mjs"]],
  ["node", ["scripts/guards/check-github-process.mjs"]],
  ["node", ["scripts/guards/check-release-version-surfaces.mjs"]],
];

const publicCheckoutGuards = [
  ["node", ["scripts/guards/check-code-atlas.mjs"]],
  ["node", ["scripts/guards/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/check-fastmcp-agent.mjs"]],
  ["node", ["scripts/guards/check-lsp-coverage.mjs"]],
  ["node", ["scripts/guards/check-agent-hooks.mjs"]],
];

for (const [command, args] of guards) {
  run(command, args, { stdio: "inherit" });
}

if (process.env.SUPASCHEMA_PUBLIC_CHECKOUT !== "1") {
  const publicCheckoutEnv = { ...process.env, SUPASCHEMA_PUBLIC_CHECKOUT: "1" };
  for (const [command, args] of publicCheckoutGuards) {
    run(command, args, { env: publicCheckoutEnv, stdio: "inherit" });
  }
  ok("PUBLIC_CHECKOUT_GUARDS_OK");
}

ok("ALL_GUARDS_OK");
