#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSurfaceTargetPaths,
  assertSafeAgentSurfaceSources,
  assertSafeAgentSurfaceTargets,
} from "../skills/agent-surface-safety.mjs";
import { assert, ok } from "./lib/assertions.js";
import { run } from "./lib/process.js";
import { gitFiles, gitTrackedFiles, ROOT } from "./lib/repository.js";

const guards = [
  ["node", ["scripts/guards/toolchain/check-tooling-stack.mjs"]],
  ["node", ["scripts/guards/fastmcp/check-fastmcp-agent.mjs"]],
  ["node", ["scripts/guards/repo-surface/check-public-repo-surface.mjs"]],
  ["node", ["scripts/guards/toolchain/check-lsp-coverage.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-agent-hooks.mjs"]],
  ["node", ["scripts/guards/ci-release/check-codex-execpolicy.mjs"]],
  ["node", ["scripts/guards/code-shape/check-canonical-surfaces.mjs"]],
  ["node", ["scripts/guards/code-shape/check-child-process-shell.mjs"]],
  ["node", ["scripts/guards/code-shape/check-path-comparison.mjs"]],
  ["node", ["scripts/guards/repo-surface/check-repo-layout.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-claude-agents.mjs"]],
  ["node", ["scripts/guards/agent-surface/check-hook-import-graph.mjs"]],
  ["node", ["scripts/guards/docs-config/check-schema.mjs"]],
  ["node", ["scripts/guards/docs-config/check-config-standardization.mjs"]],
  ["node", ["scripts/guards/docs-config/check-rule-citations.mjs"]],
  ["node", ["scripts/guards/ci-release/check-ci-governance.mjs"]],
  ["node", ["scripts/guards/ci-release/check-github-process.mjs"]],
  ["node", ["scripts/guards/ci-release/check-release-version-surfaces.mjs"]],
];

function isAgentSurfaceTarget(file, targets) {
  return targets.some((target) => file === target || file.startsWith(`${target}/`));
}

function readWorktreeFile(file, root) {
  try {
    return fs.readFileSync(path.join(root, file));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function filesystemTargetFiles(root, targets) {
  const files = new Set();

  function visit(relativePath) {
    const absolutePath = path.join(root, relativePath);
    let stats;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      throw new Error(
        `unsafe generated agent-surface target ${relativePath}: symbolic links are not allowed`
      );
    }
    if (stats.isFile()) {
      files.add(relativePath);
      return;
    }
    if (!stats.isDirectory()) {
      throw new Error(
        `unsafe generated agent-surface target ${relativePath}: expected a regular file or directory`
      );
    }
    for (const entry of fs.readdirSync(absolutePath)) {
      visit(path.posix.join(relativePath, entry));
    }
  }

  for (const target of targets) {
    visit(target);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function agentSurfaceWorktreeSnapshot(root) {
  assertSafeAgentSurfaceSources(root);
  assertSafeAgentSurfaceTargets(root);
  const targets = agentSurfaceTargetPaths();
  const tracked = new Set(
    gitTrackedFiles(root).filter((file) => isAgentSurfaceTarget(file, targets))
  );
  const visible = new Set(gitFiles(root).filter((file) => isAgentSurfaceTarget(file, targets)));
  for (const file of filesystemTargetFiles(root, targets)) {
    visible.add(file);
  }
  return new Map(
    [...visible]
      .sort((left, right) => left.localeCompare(right))
      .map((file) => [
        file,
        {
          content: readWorktreeFile(file, root),
          tracked: tracked.has(file),
        },
      ])
  );
}

function sameSnapshotEntry(left, right) {
  if (!(left && right) || left.tracked !== right.tracked) {
    return false;
  }
  if (left.content === undefined || right.content === undefined) {
    return left.content === right.content;
  }
  return left.content.equals(right.content);
}

function changedSnapshotPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((file) => !sameSnapshotEntry(before.get(file), after.get(file)))
    .sort((left, right) => left.localeCompare(right));
}

function changeLabel(file, before, after) {
  if (before === undefined && after?.tracked === false) {
    return `${file} (new untracked projection)`;
  }
  if (before?.tracked === true || after?.tracked === true) {
    return `${file} (tracked projection changed)`;
  }
  return `${file} (untracked projection changed)`;
}

export function runAgentSurfaceSyncGuard(root = ROOT, runCommand = run) {
  const before = agentSurfaceWorktreeSnapshot(root);
  runCommand("npm", ["run", "sync:llm"], { stdio: "inherit" }, root);
  const after = agentSurfaceWorktreeSnapshot(root);
  const changed = changedSnapshotPaths(before, after);
  assert(
    changed.length === 0,
    `npm run sync:llm changed generated agent surfaces; include the regenerated projections:\n${changed
      .map((file) => changeLabel(file, before.get(file), after.get(file)))
      .join("\n")}`
  );
}

export function check(root = ROOT, runCommand = run) {
  runAgentSurfaceSyncGuard(root, runCommand);
  for (const [command, args] of guards) {
    runCommand(command, args, { stdio: "inherit" }, root);
  }
  return "ALL_GUARDS_OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ok(check());
}
