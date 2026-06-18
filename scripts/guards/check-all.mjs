#!/usr/bin/env node
import { ok, run } from "./lib/guard-utils.js";

const guards = [
  ["node", ["scripts/guards/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/check-public-repo-surface.mjs"]],
  ["node", ["scripts/guards/check-dependency-catalog.mjs"]],
  ["node", ["scripts/guards/check-canonical-surfaces.mjs"]],
  ["node", ["scripts/check-schema.mjs"]],
  ["node", ["scripts/guards/check-config-standardization.mjs"]],
  ["node", ["scripts/guards/check-ci-governance.mjs"]],
  ["node", ["scripts/guards/check-github-process.mjs"]],
  ["node", ["scripts/guards/check-release-version-surfaces.mjs"]],
];

for (const [command, args] of guards) {
  run(command, args, { stdio: "inherit" });
}

ok("ALL_GUARDS_OK");
