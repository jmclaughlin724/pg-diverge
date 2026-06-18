#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { collectFiles } from "./lib/walk-files.mjs";

const roots = process.argv.slice(2);
const files = collectFiles(roots.length > 0 ? roots : ["."], ".toml");

for (const file of files) {
  execFileSync("taplo", ["format", file], { stdio: "inherit" });
}

process.stdout.write(`taplo: formatted ${files.length} TOML file(s)\n`);
