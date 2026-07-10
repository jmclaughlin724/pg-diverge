#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { run } from "../lib/process.js";
import { exists, ROOT } from "../lib/repository.js";

const privatePrefixes = [
  ".planning/",
  ".vscode/",
  "advisor-plans/",
  "cloudflare/",
  "scripts/code-atlas/",
  "scripts/stripe/",
  "services/agent-mcp/",
  "services/license-worker/",
];

const privateExact = new Set([
  ".github/workflows/python.yml",
  ".mcp.json",
  "fastmcp.json",
  "pyproject.toml",
  "uv.lock",
  "wrangler.toml",
]);

function gitPaths(args, root) {
  return run("git", [...args, "-z"], {}, root)
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
}

function isPrivateSurface(file) {
  return privateExact.has(file) || privatePrefixes.some((prefix) => file.startsWith(prefix));
}

function bulletList(files) {
  return files.map((file) => `- ${file}`).join("\n");
}

function failureMessage(tracked, stageable) {
  const sections = ["private surfaces must stay local-only"];
  if (tracked.length > 0) {
    sections.push(`tracked public GitHub exposure:\n${bulletList(tracked)}`);
  }
  if (stageable.length > 0) {
    sections.push(`unignored local files that could be staged:\n${bulletList(stageable)}`);
  }
  sections.push(
    [
      "FIX BY:",
      "- keep the local files on disk",
      "- add or repair .gitignore coverage for unignored private paths",
      "- remove tracked private paths with git rm --cached -- <path>",
      "- do not delete local skills, agents, rules, or hooks to satisfy this guard",
    ].join("\n")
  );
  return sections.join("\n\n");
}

export function check(root = ROOT) {
  const tracked = gitPaths(["ls-files", "--cached"], root)
    .filter((file) => exists(file, root))
    .filter(isPrivateSurface);

  const stageable = gitPaths(["ls-files", "--others", "--exclude-standard"], root)
    .filter((file) => exists(file, root))
    .filter(isPrivateSurface);

  assert(tracked.length === 0 && stageable.length === 0, failureMessage(tracked, stageable));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("PUBLIC_REPO_SURFACE_OK");
}
