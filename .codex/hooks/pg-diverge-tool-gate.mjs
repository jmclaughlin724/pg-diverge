#!/usr/bin/env node
import { readFileSync } from "node:fs";

const lineageMarker = "-- pg-diverge: lineage ";
const patchFileHeaders = ["*** Update File: "];

function patchTargets(patchText) {
  const targets = [];
  for (const line of patchText.split("\n")) {
    for (const header of patchFileHeaders) {
      if (line.startsWith(header)) {
        targets.push(line.slice(header.length).trim());
      }
    }
  }
  return targets;
}

function editTargets(payload) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const input = payload?.tool_input ?? {};
  if (toolName === "apply_patch") {
    const patch = typeof input.patch === "string" ? input.patch : (input.input ?? "");
    return typeof patch === "string" ? patchTargets(patch) : [];
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [input.file_path];
  }
  return [];
}

function isGeneratedMigration(path) {
  if (!path.endsWith(".sql")) {
    return false;
  }
  try {
    return readFileSync(path, "utf8").includes(lineageMarker);
  } catch {
    return false;
  }
}

function emit(result) {
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const blocked = editTargets(payload).find((path) => isGeneratedMigration(path));
  if (!blocked) {
    emit({});
  }
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${blocked} is a pg-diverge-generated migration (lineage marker present). Do not hand-edit it: change the declarative schema tree, delete this file if it is stale, and regenerate with \`pg-diverge diff\`. See .claude/rules/pg-diverge.md.`,
    },
  });
} catch (error) {
  emit({
    systemMessage: `pg-diverge-tool-gate hook error (fail-open): ${error instanceof Error ? error.message : String(error)}`,
  });
}
