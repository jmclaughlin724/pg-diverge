// Shared file walker for the native-formatter lanes (sh-syntax, taplo). Regex-free
// per Rule 07. Skips dependency, build, cache, and scratch directories so a default
// whole-repo run never reaches node_modules or generated output.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tmp",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export function collectFiles(roots, extension) {
  const found = [];
  for (const root of roots) {
    walk(root, extension, found);
  }
  return found;
}

function walk(path, extension, out) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (path.endsWith(extension)) {
      out.push(path);
    }
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    walk(join(path, entry), extension, out);
  }
}
