import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationPlan } from "./core.js";

export function defaultMigrationName(plan: MigrationPlan): string {
  const first = plan.operations[0];
  if (plan.operations.length === 1 && first) {
    const name = first.ref.name ?? first.key;
    return migrationNameSlug(`${first.kind}_${first.ref.kind}_${name}`);
  }
  return "schema_diff";
}

export function migrationNameSlug(value: string): string {
  const parts: string[] = [];
  let current = "";
  for (const char of value.toLowerCase()) {
    if (isLowercaseAscii(char) || isDigit(char)) {
      current += char;
      continue;
    }
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.join("_").slice(0, 60);
}

function isLowercaseAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export async function migrationFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(directory, entry));
}

export async function latestMigrationFile(directory: string): Promise<string | undefined> {
  const files = await migrationFiles(directory);
  return files.at(-1);
}
