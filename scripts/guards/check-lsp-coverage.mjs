#!/usr/bin/env node
import path from "node:path";
import { assert, exists, ok, readJson, run } from "./lib/guard-utils.js";

if (!exists(".claude/cclsp.json")) {
  ok("LSP_COVERAGE_SKIPPED_LOCAL_ONLY");
  process.exit(0);
}

const config = readJson(".claude/cclsp.json");
const mapped = new Set();
for (const server of config.servers ?? []) {
  for (const extension of server.extensions ?? []) {
    mapped.add(extension.toLowerCase());
  }
}

const nonCode = new Set([
  "editorconfig",
  "gitattributes",
  "gitignore",
  "gitkeep",
  "license",
  "mintignore",
  "nvmrc",
  "prettierignore",
  "png",
  "snap",
  "svg",
  "tgz",
  "txt",
]);
const ignoredFiles = new Set(["package-lock.json", "uv.lock"]);

const trackedFiles = run("git", ["ls-files", "-z", "--cached"]).stdout.split("\0").filter(Boolean);

for (const file of trackedFiles) {
  if (ignoredFiles.has(file)) {
    continue;
  }
  const extension = extensionFor(file);
  if (!extension) {
    continue;
  }
  assert(
    mapped.has(extension) || nonCode.has(extension),
    `tracked extension .${extension} is not mapped in .claude/cclsp.json`
  );
}

ok("LSP_COVERAGE_OK");

function extensionFor(file) {
  const basename = path.basename(file).toLowerCase();
  if (basename === "dockerfile") {
    return "dockerfile";
  }
  const extension = path.extname(file).slice(1).toLowerCase();
  if (extension) {
    return extension;
  }
  if (basename.startsWith(".")) {
    return basename.slice(1);
  }
  return "";
}
