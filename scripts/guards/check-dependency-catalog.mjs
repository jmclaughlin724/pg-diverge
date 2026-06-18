#!/usr/bin/env node

import { assert, ok, readJson } from "./lib/guard-utils.js";

const catalog = readJson("scripts/dependency-catalog.json");
const keys = Object.keys(catalog).sort();

assert(catalog.packageManager === "npm", "dependency catalog must match this repo's npm contract");
assert(
  keys.length === 1 && keys[0] === "packageManager",
  `dependency catalog must not retain private tool pins: ${keys.join(", ")}`
);

ok("DEPENDENCY_CATALOG_OK");
