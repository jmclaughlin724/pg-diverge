import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SupaschemaConfig } from "./config.js";
import type { MigrationPlan } from "./core.js";
import { redactSecrets } from "./redaction.js";

const execFileAsync = promisify(execFile);

export interface ResolvedSources {
  from: string;
  notice: string | undefined;
  to: string;
}

export function defaultTreeSource(config: SupaschemaConfig): string {
  return `dir:${config.schemaPaths[0] ?? "database/schemas"}`;
}

export function resolveMigrationsDir(
  flagValue: string | undefined,
  config: SupaschemaConfig
): string {
  return flagValue ?? config.migrationsDir;
}

export async function resolveSourceDefaults(
  options: { from?: string; to?: string },
  config: SupaschemaConfig,
  resolveDbUrl: () => Promise<string | undefined>,
  gitHeadExists: () => Promise<boolean> = defaultGitHeadExists
): Promise<ResolvedSources> {
  const defaulted: string[] = [];
  const to = options.to ?? config.sources.to ?? defaultTreeSource(config);
  if (options.to === undefined) {
    defaulted.push(`--to ${to}`);
  }
  let from = options.from;
  if (from === undefined) {
    if (config.sources.from === "auto") {
      if (await gitHeadExists()) {
        from = "git:HEAD";
      } else {
        const databaseUrl = await resolveDbUrl();
        if (databaseUrl === undefined) {
          from = "empty:";
        } else {
          from = `database:${databaseUrl}`;
        }
      }
    } else {
      from = config.sources.from;
    }
    defaulted.push(`--from ${redactSecrets(from)}`);
  }
  const notice =
    defaulted.length > 0 ? `defaults: ${defaulted.join(" · ")} (flags override)\n` : undefined;
  return { from, notice, to };
}

async function defaultGitHeadExists(): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

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
