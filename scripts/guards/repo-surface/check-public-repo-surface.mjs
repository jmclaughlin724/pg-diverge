#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { run } from "../lib/process.js";
import { exists, ROOT } from "../lib/repository.js";

const privatePrefixes = [
  ".claude/agents/",
  ".claude/plans/",
  ".codex/agents/",
  ".planning/",
  ".vscode/",
  "advisor-plans/",
  "scripts/stripe/",
  "services/license-worker/",
];

const wiredPrefixes = ["cloudflare/", "services/agent-mcp/"];
const wiredExact = new Set([
  ".codex/config.toml",
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
  return privatePrefixes.some((prefix) => file.startsWith(prefix));
}

function bulletList(files) {
  return files.map((file) => `- ${file}`).join("\n");
}

function untrackedWiredSurfaces(tracked, root) {
  const missing = [];
  for (const file of wiredExact) {
    if (exists(file, root) && !tracked.includes(file)) {
      missing.push(file);
    }
  }
  for (const prefix of wiredPrefixes) {
    if (exists(prefix, root) && !tracked.some((file) => file.startsWith(prefix))) {
      missing.push(prefix);
    }
  }
  return missing;
}

function failureMessage({ trackedPrivate, stageablePrivate, untrackedWired }) {
  const sections = [];
  if (trackedPrivate.length > 0 || stageablePrivate.length > 0) {
    sections.push("private surfaces must stay local-only");
    if (trackedPrivate.length > 0) {
      sections.push(`tracked public GitHub exposure:\n${bulletList(trackedPrivate)}`);
    }
    if (stageablePrivate.length > 0) {
      sections.push(`unignored local files that could be staged:\n${bulletList(stageablePrivate)}`);
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
  }
  if (untrackedWired.length > 0) {
    sections.push("wired maintainer tooling must be tracked, never ignored or untracked");
    sections.push(`present but not tracked:\n${bulletList(untrackedWired)}`);
    sections.push(
      [
        "FIX BY:",
        "- git add the path: tracked files reference it, so tracking keeps agents",
        "  and fresh clones working; do not hide wired surfaces in .gitignore",
        "- or remove every tracked reference to the path in the same change",
      ].join("\n")
    );
  }
  return sections.join("\n\n");
}

export function check(root = ROOT) {
  const tracked = gitPaths(["ls-files", "--cached"], root).filter((file) => exists(file, root));
  const stageable = gitPaths(["ls-files", "--others", "--exclude-standard"], root).filter((file) =>
    exists(file, root)
  );

  const trackedPrivate = tracked.filter(isPrivateSurface);
  const stageablePrivate = stageable.filter(isPrivateSurface);
  const untrackedWired = untrackedWiredSurfaces(tracked, root);

  assert(
    trackedPrivate.length === 0 && stageablePrivate.length === 0 && untrackedWired.length === 0,
    failureMessage({ trackedPrivate, stageablePrivate, untrackedWired })
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("PUBLIC_REPO_SURFACE_OK");
}
