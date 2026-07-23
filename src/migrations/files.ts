import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MigrationPlan } from "../types.js";

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

export function migrationTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

export async function nextMigrationFile(
  directory: string,
  name: string,
  now = new Date()
): Promise<string> {
  const currentSecond = Math.floor(now.getTime() / 1000) * 1000;
  const newestExisting = (await migrationFiles(directory)).reduce((latest, file) => {
    const date = migrationDate(basename(file));
    return date === undefined ? latest : Math.max(latest, date.getTime());
  }, 0);
  const next = new Date(Math.max(currentSecond, newestExisting + 1000));
  return join(directory, `${migrationTimestamp(next)}_${name}.sql`);
}

function isLowercaseAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function migrationDate(file: string): Date | undefined {
  const version = file.slice(0, 14);
  if (version.length !== 14 || [...version].some((char) => !isDigit(char))) {
    return;
  }
  const date = new Date(
    Date.UTC(
      Number(version.slice(0, 4)),
      Number(version.slice(4, 6)) - 1,
      Number(version.slice(6, 8)),
      Number(version.slice(8, 10)),
      Number(version.slice(10, 12)),
      Number(version.slice(12, 14))
    )
  );
  return migrationTimestamp(date) === version ? date : undefined;
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
