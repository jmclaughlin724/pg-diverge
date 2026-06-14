#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const lineageMarker = "-- supaschema: lineage ";
const editTools = new Set(["Edit", "MultiEdit", "Write", "edit_file", "apply_patch"]);
const updateHeader = "*** Update File: ";
const deleteHeader = "*** Delete File: ";
const addHeader = "*** Add File: ";
const moveHeader = "*** Move to: ";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || ".",
  );
  const blocked = editTargets(payload, projectDir).find((path) => isGeneratedMigration(path));
  if (!blocked) {
    process.exit(0);
  }
  process.stderr.write(
    `${blocked} is a supaschema-generated migration (lineage marker present). ` +
      "Do not hand-edit it: change the declarative schema tree, delete this file if it is stale, " +
      "and regenerate with `supaschema diff`. See .claude/rules/supaschema.md.\n",
  );
  process.exit(2);
} catch {
  process.exit(0);
}

function editTargets(payload, projectDir) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = payload?.tool_input ?? {};
  if (toolName === "apply_patch") {
    const patch =
      typeof input.command === "string"
        ? input.command
        : typeof input.patch === "string"
          ? input.patch
          : typeof input.input === "string"
            ? input.input
            : "";
    return patchTargets(patch, projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [resolveTarget(projectDir, input.file_path)];
  }
  return [];
}

function patchTargets(patchText, projectDir) {
  const updates = [];
  const deletes = [];
  const adds = new Set();
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      updates.push(resolveTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      deletes.push(resolveTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      adds.add(resolveTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      updates.push(resolveTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  const rewrites = deletes.filter((path) => adds.has(path));
  return [...updates, ...adds, ...rewrites];
}

function resolveTarget(projectDir, path) {
  return isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
}

function isGeneratedMigration(path) {
  if (!path.endsWith(".sql")) {
    return false;
  }
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  return existing.includes(lineageMarker);
}
