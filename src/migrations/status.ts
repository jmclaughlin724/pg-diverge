import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import type { Diagnostic } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { redactSecrets } from "../redaction.js";
import { quoteIdent } from "../sql/identifiers.js";
import type { MigrationLineage } from "./lineage.js";
import { parseLineage } from "./lineage.js";

export interface MigrationsStatusOptions {
  allowMissingHistoryTable?: boolean;
  databaseUrl?: string;
  directory: string;
  expectedAppliedVersions?: string[];
  historyTable?: string;
  runnerLabel?: string;
  targetLabel?: string;
}

export interface MigrationHistoryComparison {
  expectedAppliedVersions: string[];
  missingExpectedVersions: string[];
  unexpectedAppliedVersions: string[];
}

export interface MigrationsStatusReport {
  applied: string[];
  expectedAppliedVersions: string[];
  files: string[];

  ghosts: string[];
  historyTable: string;

  missingExpectedVersions: string[];

  outOfOrder: string[];

  pending: string[];

  pendingLineage: MigrationLineage[];
  runnerLabel?: string;
  target?: string;
  targetLabel?: string;

  unexpectedAppliedVersions: string[];
}

const defaultHistoryTable = "supabase_migrations.schema_migrations";
const lineageScanBytes = 4096;

export async function migrationsStatus(
  options: MigrationsStatusOptions
): Promise<{ diagnostics: Diagnostic[]; report: MigrationsStatusReport }> {
  const diagnostics: Diagnostic[] = [];
  const historyTable = options.historyTable ?? defaultHistoryTable;
  const files = (await readdir(options.directory))
    .filter((name) => name.endsWith(".sql") && migrationFileVersion(name) !== undefined)
    .sort((left, right) => left.localeCompare(right));
  const versionsByFile = new Map(files.map((name) => [name, migrationFileVersion(name) ?? ""]));
  const expectedAppliedVersions =
    options.expectedAppliedVersions === undefined
      ? migrationFileVersions(files)
      : [...options.expectedAppliedVersions].sort();
  const report: MigrationsStatusReport = {
    applied: [],
    expectedAppliedVersions,
    files,
    ghosts: [],
    historyTable,
    missingExpectedVersions: [],
    outOfOrder: [],
    pending: [],
    pendingLineage: [],
    ...(options.runnerLabel === undefined ? {} : { runnerLabel: options.runnerLabel }),
    ...(options.targetLabel === undefined ? {} : { targetLabel: options.targetLabel }),
    unexpectedAppliedVersions: [],
  };
  if (!options.databaseUrl) {
    report.pending = files;
    report.missingExpectedVersions = expectedAppliedVersions;
    diagnostics.push(
      diagnostic(
        "SUPA_MIGRATIONS_NO_TARGET",
        "warning",
        "no database URL resolved; reporting disk files only",
        { hint: "Pass --database-url or set SUPASCHEMA_DATABASE_URL to compare against a target." }
      )
    );
    await annotateLineage(options.directory, report);
    return { diagnostics, report };
  }
  report.target = databaseTargetLabel(options.databaseUrl);
  const appliedVersions = await readHistory(options.databaseUrl, historyTable, diagnostics, {
    allowMissingHistoryTable: options.allowMissingHistoryTable === true,
  });
  if (appliedVersions === undefined) {
    return { diagnostics, report };
  }
  const diskVersions = new Set(versionsByFile.values());
  const newestApplied = [...appliedVersions].sort().at(-1) ?? "";
  const comparison = compareMigrationHistory(appliedVersions, expectedAppliedVersions);
  report.missingExpectedVersions = comparison.missingExpectedVersions;
  report.unexpectedAppliedVersions = comparison.unexpectedAppliedVersions;
  for (const file of files) {
    const version = versionsByFile.get(file) ?? "";
    if (appliedVersions.has(version)) {
      report.applied.push(file);
      continue;
    }
    report.pending.push(file);
    if (version < newestApplied) {
      report.outOfOrder.push(file);
    }
  }
  report.ghosts = [...appliedVersions].filter((version) => !diskVersions.has(version)).sort();
  await annotateLineage(options.directory, report);
  if (report.ghosts.length > 0) {
    diagnostics.push(
      diagnostic(
        "SUPA_MIGRATIONS_GHOST_VERSIONS",
        "error",
        `${report.ghosts.length} applied version(s) have no migration file on disk`,
        { hint: `ghost versions: ${report.ghosts.slice(0, 8).join(", ")}` }
      )
    );
  }
  if (report.outOfOrder.length > 0) {
    diagnostics.push(
      diagnostic(
        "SUPA_MIGRATIONS_OUT_OF_ORDER",
        "error",
        `${report.outOfOrder.length} pending file(s) are older than the target's newest applied version`,
        { hint: `out-of-order: ${report.outOfOrder.slice(0, 8).join(", ")}` }
      )
    );
  }
  return { diagnostics, report };
}

export function renderMigrationsStatus(report: MigrationsStatusReport): string {
  const lines: string[] = [];
  const labels = [report.targetLabel, report.runnerLabel].filter((label) => label !== undefined);
  lines.push(
    `migrations${labels.length > 0 ? ` [${labels.join(" / ")}]` : ""}: ${report.files.length} file(s) on disk vs ${report.target ?? "no target"} (${report.historyTable})`
  );
  lines.push(
    `  applied: ${report.applied.length}  pending: ${report.pending.length}  ghosts: ${report.ghosts.length}  out-of-order: ${report.outOfOrder.length}`
  );
  for (const file of report.pending) {
    const lineage = report.pendingLineage.find((item) => item.file === file);
    lines.push(`  pending: ${file}${lineage ? " (supaschema lineage)" : ""}`);
  }
  for (const version of report.ghosts) {
    lines.push(`  ghost: ${version} (applied on target, no file on disk)`);
  }
  for (const file of report.outOfOrder) {
    lines.push(`  out-of-order: ${file}`);
  }
  return `${lines.join("\n")}\n`;
}

export function migrationFileVersion(file: string): string | undefined {
  let index = 0;
  while (index < file.length && isDigit(file[index] ?? "")) {
    index += 1;
  }
  return index >= 8 ? file.slice(0, index) : undefined;
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export function migrationFileVersions(files: string[]): string[] {
  return files
    .map((file) => migrationFileVersion(file))
    .filter((version): version is string => version !== undefined)
    .sort();
}

export function compareMigrationHistory(
  appliedVersions: Iterable<string>,
  expectedAppliedVersions: Iterable<string>
): MigrationHistoryComparison {
  const applied = new Set(appliedVersions);
  const expected = [...new Set(expectedAppliedVersions)].sort();
  const expectedSet = new Set(expected);
  return {
    expectedAppliedVersions: expected,
    missingExpectedVersions: expected.filter((version) => !applied.has(version)),
    unexpectedAppliedVersions: [...applied].filter((version) => !expectedSet.has(version)).sort(),
  };
}

async function readHistory(
  databaseUrl: string,
  historyTable: string,
  diagnostics: Diagnostic[],
  options: { allowMissingHistoryTable?: boolean } = {}
): Promise<Set<string> | undefined> {
  const parts = historyTable.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    diagnostics.push(
      diagnostic(
        "SUPA_MIGRATIONS_HISTORY_TABLE",
        "error",
        `history table "${historyTable}" must be schema-qualified`
      )
    );
    return;
  }
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const exists = await client.query<{ found: boolean }>(
      "select exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2) as found",
      [parts[0], parts[1]]
    );
    if (exists.rows[0]?.found !== true) {
      if (options.allowMissingHistoryTable === true) {
        diagnostics.push(
          diagnostic(
            "SUPA_MIGRATIONS_HISTORY_TABLE",
            "warning",
            `history table ${historyTable} does not exist on the target`,
            { hint: "The selected runner may create it before applying migrations." }
          )
        );
        return new Set();
      }
      diagnostics.push(
        diagnostic(
          "SUPA_MIGRATIONS_HISTORY_TABLE",
          "error",
          `history table ${historyTable} does not exist on the target`,
          { hint: "Pass --history-table for runners that record history elsewhere." }
        )
      );
      return;
    }
    const result = await client.query<{ version: string }>(
      `select version::text as version from ${quoteIdent(parts[0] ?? "")}.${quoteIdent(parts[1] ?? "")}`
    );
    return new Set(result.rows.map((row) => row.version));
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "SUPA_MIGRATIONS_TARGET_UNAVAILABLE",
        "error",
        error instanceof Error ? error.message : String(error),
        { hint: "Confirm the database URL is reachable." }
      )
    );
    return;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function annotateLineage(directory: string, report: MigrationsStatusReport): Promise<void> {
  for (const file of report.pending) {
    const handle = await readFile(join(directory, file), "utf8").catch(() => undefined);
    if (handle === undefined) {
      continue;
    }
    const lineage = parseLineage(handle.slice(0, lineageScanBytes));
    if (lineage) {
      report.pendingLineage.push({ file, ...lineage });
    }
  }
}

function databaseTargetLabel(value: string): string {
  try {
    new URL(value);
    return redactSecrets(value);
  } catch {
    return "<database>";
  }
}
