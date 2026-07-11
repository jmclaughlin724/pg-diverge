import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { lineagePrefix } from "../migrations/lineage.js";
import { pathContainsOrEqual } from "../paths.js";

const editTools = new Set(["Edit", "MultiEdit", "Write"]);
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";

export interface ChangedSchemaGroup {
  changed: string[];
  display: string;
}

export function hookProjectDir(payload: unknown): string {
  const cwdValue =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, "cwd") : undefined;
  const cwd = typeof cwdValue === "string" && cwdValue.length > 0 ? cwdValue : undefined;
  return resolve(cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_PROJECT_DIR ?? ".");
}

export function hookEditTargets(payload: unknown, projectDir: string): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const toolNameValue = Reflect.get(payload, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  const inputValue = Reflect.get(payload, "tool_input");
  if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
    return [];
  }
  if (toolName === "apply_patch") {
    const command = Reflect.get(inputValue, "command");
    return typeof command === "string" ? hookPatchTargets(command, projectDir) : [];
  }
  if (!editTools.has(toolName)) {
    return [];
  }
  const filePath = Reflect.get(inputValue, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [resolveHookTarget(projectDir, filePath)];
  }
  return [];
}

export function generatedMigrationEditTargets(payload: unknown, projectDir: string): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const toolNameValue = Reflect.get(payload, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  const inputValue = Reflect.get(payload, "tool_input");
  if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
    return [];
  }
  if (toolName === "apply_patch") {
    const command = Reflect.get(inputValue, "command");
    return typeof command === "string" ? generatedMigrationPatchTargets(command, projectDir) : [];
  }
  if (!editTools.has(toolName)) {
    return [];
  }
  const filePath = Reflect.get(inputValue, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [resolveHookTarget(projectDir, filePath)];
  }
  return [];
}

export function changedSchemaTargets(
  paths: string[],
  schemaRoots: { display: string; root: string }[]
): { changed: string[]; groups: ChangedSchemaGroup[] } {
  const groups = new Map<string, ChangedSchemaGroup>();
  const changed: string[] = [];
  for (const path of paths) {
    if (!path.endsWith(".sql") || isGeneratedMigration(path)) {
      continue;
    }
    const matched = matchedSchemaRoot(path, schemaRoots);
    if (matched === undefined) {
      continue;
    }
    changed.push(path);
    const group = groups.get(matched.root) ?? { changed: [], display: matched.display };
    group.changed.push(path);
    groups.set(matched.root, group);
  }
  return { changed, groups: Array.from(groups.values()) };
}

export function migrationOutputs(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"))
    .map(slashPath);
}

export function isGeneratedMigration(path: string): boolean {
  if (!path.endsWith(".sql")) {
    return false;
  }
  try {
    return readFileSync(path, "utf8").includes(lineagePrefix);
  } catch {
    return false;
  }
}

export function rel(projectDir: string, path: string): string {
  const relPath = relative(projectDir, path);
  return slashPath(relPath.startsWith("..") ? path : relPath);
}

export function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function hookPatchTargets(patch: string, projectDir: string): string[] {
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    const target = hookPatchLineTarget(line, projectDir);
    if (target !== undefined) {
      out.push(target);
    }
  }
  return out;
}

function generatedMigrationPatchTargets(patchText: string, projectDir: string): string[] {
  const updates: string[] = [];
  const deletes: string[] = [];
  const adds = new Set<string>();
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      updates.push(resolveHookTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      deletes.push(resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      adds.add(resolveHookTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      updates.push(resolveHookTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  const rewrites = deletes.filter((path) => adds.has(path));
  return [...updates, ...adds, ...rewrites];
}

function hookPatchLineTarget(line: string, projectDir: string): string | undefined {
  if (line.startsWith(addHeader)) {
    return resolveHookTarget(projectDir, line.slice(addHeader.length).trim());
  }
  if (line.startsWith(deleteHeader)) {
    return resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim());
  }
  if (line.startsWith(updateHeader)) {
    return resolveHookTarget(projectDir, line.slice(updateHeader.length).trim());
  }
  if (line.startsWith(moveHeader)) {
    return resolveHookTarget(projectDir, line.slice(moveHeader.length).trim());
  }
}

function resolveHookTarget(projectDir: string, path: string): string {
  const normalized = slashPath(path);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(projectDir, normalized);
}

function matchedSchemaRoot(
  path: string,
  schemaRoots: { display: string; root: string }[]
): { display: string; root: string } | undefined {
  const matches = schemaRoots.filter((entry) => pathContainsOrEqual(entry.root, path));
  return matches.sort((left, right) => right.root.length - left.root.length)[0];
}
