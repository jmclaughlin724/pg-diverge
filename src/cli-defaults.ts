import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SupaschemaConfig } from "./config.js";
import type { MigrationPlan } from "./core.js";
import { redactSecrets } from "./diagnostics.js";

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
  config: SupaschemaConfig,
): string {
  return flagValue ?? config.migrationsDir;
}

/**
 * Zero-flag source resolution: --to defaults to the declarative tree from
 * config.schemaPaths, --from defaults to the resolved database (the applied
 * state) and falls back to git:HEAD when no database URL resolves. The
 * notice names every defaulted lane so the chosen sources are never silent.
 */
export async function resolveSourceDefaults(
  options: { from?: string; to?: string },
  config: SupaschemaConfig,
  resolveDbUrl: () => Promise<string | undefined>,
): Promise<ResolvedSources> {
  const defaulted: string[] = [];
  const to = options.to ?? defaultTreeSource(config);
  if (options.to === undefined) {
    defaulted.push(`--to ${to}`);
  }
  let from = options.from;
  if (from === undefined) {
    const databaseUrl = await resolveDbUrl();
    from = databaseUrl === undefined ? "git:HEAD" : `database:${databaseUrl}`;
    defaulted.push(`--from ${redactSecrets(from)}`);
  }
  const notice =
    defaulted.length > 0 ? `defaults: ${defaulted.join(" · ")} (flags override)\n` : undefined;
  return { from, notice, to };
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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 60);
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
