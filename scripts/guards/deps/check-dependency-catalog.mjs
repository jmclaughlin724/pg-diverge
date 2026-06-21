#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, ROOT, readJson } from "../lib/guard-utils.js";

export function check(root = ROOT) {
  const catalog = readJson("scripts/dependency-catalog.json", root);
  const keys = Object.keys(catalog).sort();

  assert(
    catalog.packageManager === "npm",
    "dependency catalog must match this repo's npm contract"
  );
  assert(
    keys.length === 1 && keys[0] === "packageManager",
    `dependency catalog must not retain private tool pins: ${keys.join(", ")}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("DEPENDENCY_CATALOG_OK");
}
