#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, gitTrackedFiles, ok, ROOT } from "../lib/guard-utils.js";

const dumpTerms = ["shared", "_shared", "utils", "helpers", "common", "misc"];

function isPrivateUnderscoreDir(name) {
  return name.startsWith("_") && name.length >= 2 && name[1] >= "a" && name[1] <= "z";
}

function forbiddenDirName(name) {
  return dumpTerms.includes(name.toLowerCase()) || isPrivateUnderscoreDir(name);
}

function forbiddenFileStem(stem) {
  return dumpTerms.includes(stem.toLowerCase());
}

export function check(root = ROOT) {
  const violations = new Set();
  for (const file of gitTrackedFiles(root)) {
    const segments = file.split("/");
    const filename = segments.pop() ?? "";
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (forbiddenDirName(seg)) {
        violations.add(acc);
      }
    }
    const stem = path.parse(filename).name;
    if (forbiddenFileStem(stem)) {
      violations.add(file);
    }
  }

  assert(
    violations.size === 0,
    `authored source must not use shared/_shared/private-_/utils/helpers/common/misc folders or files (organize by owner, not by dumping):\n${[...violations].join("\n")}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("REPO_LAYOUT_OK");
}
