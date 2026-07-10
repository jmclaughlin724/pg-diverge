#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { run } from "../lib/process.js";
import { exists, ROOT, readJson } from "../lib/repository.js";

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

export function check(root = ROOT) {
  if (process.env.SUPASCHEMA_PUBLIC_CHECKOUT === "1" || !exists(".claude/cclsp.json", root)) {
    return "LSP_COVERAGE_SKIPPED_LOCAL_ONLY";
  }

  const config = readJson(".claude/cclsp.json", root);
  const mapped = new Set();
  for (const server of config.servers ?? []) {
    for (const extension of server.extensions ?? []) {
      mapped.add(extension.toLowerCase());
    }
  }

  const trackedFiles = run("git", ["ls-files", "-z", "--cached"], {}, root)
    .stdout.split("\0")
    .filter(Boolean);

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

  return "LSP_COVERAGE_OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ok(check());
}
