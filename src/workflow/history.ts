import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkMigrationSql } from "../check/migration.js";
import type { Diagnostic, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { MigrationRunnerKind, MigrationRunnerResult } from "../migrations/runners.js";
import { migrationsStatus } from "../migrations/status.js";
import { render } from "./report.js";
import type { SyncOptions, SyncResult } from "./sync.js";

export function loadSyncStatus(options: SyncOptions, selectedRunner: MigrationRunnerKind) {
  return migrationsStatus({
    allowMissingHistoryTable: selectedRunner === "direct",
    directory: options.directory,
    ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
    ...(options.historyTable === undefined ? {} : { historyTable: options.historyTable }),
  });
}

export async function checkPendingMigrations(
  directory: string,
  pending: string[],
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  lines: string[],
  operation: "apply" | "sync" = "sync"
): Promise<SyncResult | undefined> {
  for (const file of pending) {
    const sql = await readFile(join(directory, file), "utf8");
    const checkDiagnostics = await checkMigrationSql(sql, { config });
    const errors = checkDiagnostics.filter((item) => item.severity === "error");
    diagnostics.push(...errors);
    if (errors.length > 0) {
      lines.push(`refusing to ${operation}: ${file} fails the replay-safety check`);
      return {
        applied: false,
        diagnostics,
        pending,
        report: render(lines),
      };
    }
    lines.push(`checked: ${file} (replay-safe)`);
  }
  return;
}

export function runnerFailureResult(
  outcome: MigrationRunnerResult,
  selectedRunner: MigrationRunnerKind,
  pending: string[],
  diagnostics: Diagnostic[],
  lines: string[]
): SyncResult | undefined {
  if (outcome.ok) {
    return;
  }
  diagnostics.push(
    outcome.kind === "unavailable"
      ? diagnostic("SUPA_SYNC_RUNNER_UNAVAILABLE", "error", outcome.message, {
          hint: runnerUnavailableHint(selectedRunner),
        })
      : diagnostic("SUPA_SYNC_RUNNER_FAILED", "error", outcome.message, {
          hint: "The migration runner owns apply/deploy; inspect its output above.",
        })
  );
  return {
    applied: false,
    diagnostics,
    pending,
    report: render(lines),
  };
}

function runnerUnavailableHint(selectedRunner: MigrationRunnerKind): string {
  if (selectedRunner === "supabase-cli") {
    return "Install the Supabase CLI (https://supabase.com/docs/guides/local-development) and ensure `supabase` is on PATH, or set the target runner to direct with a resolved database URL.";
  }
  return "Pass --database-url or select a configured sync target with a resolved database URL.";
}
