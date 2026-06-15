#!/usr/bin/env node
// pgformatter (pg_format, via the pg-formatter npm wrapper) owns SQL formatting for
// hand-authored declarative schema trees. Two surfaces are deliberately never
// reformatted: generated migrations carry the `-- supaschema: lineage` marker and are
// rendered deterministically by supaschema, and tests/fixtures + corpus + benchmark
// fixtures are behavioral evidence. So this defaults to the example declarative trees;
// a consuming project points it at its configured schemaPaths via `npm run format:sql -- <dir>`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { collectFiles } from "./lib/walk-files.mjs";

const lineageMarker = "-- supaschema: lineage";
const roots = process.argv.slice(2);
const files = collectFiles(roots.length > 0 ? roots : ["examples"], ".sql");

const formatted = [];
for (const file of files) {
  if (readFileSync(file, "utf8").includes(lineageMarker)) {
    continue; // never reformat a generated migration
  }
  execFileSync("pg-formatter", ["-i", "--spaces", "2", "--no-rc-file", file], {
    stdio: "inherit",
  });
  formatted.push(file);
}

process.stdout.write(`pg-format: formatted ${formatted.length} declarative SQL file(s)\n`);
