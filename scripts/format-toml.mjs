#!/usr/bin/env node
// taplo owns TOML formatting. It only formats — `reorder_keys`/`reorder_arrays`
// stay at their `false` defaults because TOML order is semantic here (pyproject
// sections, wrangler, the Codex config). Defaults to the whole repo (minus
// dependency/build/cache dirs); pass explicit roots with `npm run format:toml -- <dir>`.
import { execFileSync } from "node:child_process";
import { collectFiles } from "./lib/walk-files.mjs";

const roots = process.argv.slice(2);
const files = collectFiles(roots.length > 0 ? roots : ["."], ".toml");

for (const file of files) {
  execFileSync("taplo", ["format", file], { stdio: "inherit" });
}

process.stdout.write(`taplo: formatted ${files.length} TOML file(s)\n`);
