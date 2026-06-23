import { join } from "node:path";
import type { Diagnostic, SupaschemaConfig } from "../core.js";
import { resolveDatabaseUrl } from "../database/url.js";
import { diagnostic, hasErrors } from "../diagnostics.js";
import { latestLineage } from "../migrations/lineage.js";
import { verifyMigrationChain } from "../verify/migration.js";
import { render } from "./report.js";
import type { SyncOptions, SyncResult, SyncSources } from "./sync.js";
import type { ResolvedSyncTarget } from "./targets.js";
import { operationName } from "./targets.js";

interface VerifyPendingMigrationsForSyncOptions {
  config: SupaschemaConfig;
  diagnostics: Diagnostic[];
  directory: string;
  lines: string[];
  options: SyncOptions;
  pending: string[];
  sources: SyncSources;
  target?: ResolvedSyncTarget;
}

export async function verifyPendingMigrationsForSync(
  options: VerifyPendingMigrationsForSyncOptions
): Promise<SyncResult | undefined> {
  if (operationName(options.options) !== "sync" || options.pending.length === 0) {
    return;
  }
  const databaseUrl = resolveSyncVerifyDatabaseUrl(options);
  if (databaseUrl === undefined) {
    if (shouldSkipSupabaseCliVerify(options)) {
      options.lines.push(
        `verify: skipped for ${options.target?.name} because the Supabase CLI target resolves credentials at runtime`
      );
      return;
    }
    options.diagnostics.push(
      diagnostic(
        "SUPA_SYNC_VERIFY_URL_UNRESOLVED",
        "error",
        syncVerifyUrlUnresolvedMessage(options),
        {
          hint: syncVerifyUrlUnresolvedHint(options),
        }
      )
    );
    options.lines.push("refusing to sync: verify has no database URL");
    return {
      applied: false,
      diagnostics: options.diagnostics,
      pending: options.pending,
      report: render(options.lines),
    };
  }
  const verifyDiagnostics = await verifyMigrationChain({
    config: options.config,
    databaseUrl,
    ...(options.options.ensureEnvironment === undefined
      ? {}
      : { ensureEnvironment: options.options.ensureEnvironment }),
    ensureRoles: options.options.ensureRoles === true,
    from: options.sources.from,
    migrationPaths: options.pending.map((file) => join(options.directory, file)),
    to: options.sources.to,
  });
  options.diagnostics.push(...verifyDiagnostics);
  if (hasErrors(options.diagnostics)) {
    options.lines.push("refusing to sync: verify failed for pending migrations");
    return {
      applied: false,
      diagnostics: options.diagnostics,
      pending: options.pending,
      report: render(options.lines),
    };
  }
  options.lines.push(`verify: ${options.pending.length} pending migration file(s) passed`);
  return;
}

export async function checkSyncLineageChain(
  fromFingerprint: string,
  toFingerprint: string,
  directory: string
): Promise<Diagnostic[]> {
  const latest = await latestLineage(directory);
  if (!latest) {
    return [];
  }
  if (latest.from === fromFingerprint && latest.to === toFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_DUPLICATE",
        "error",
        "a pending supaschema migration already covers this exact from/to transition",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before running sync again.",
        }
      ),
    ];
  }
  if (latest.to !== fromFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_GAP",
        "error",
        "the newest pending supaschema migration does not chain into the next schema diff",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before generating another one.",
        }
      ),
    ];
  }
  return [];
}

function shouldSkipSupabaseCliVerify(options: VerifyPendingMigrationsForSyncOptions): boolean {
  return (
    options.target?.runner === "supabase-cli" &&
    options.target.databaseUrl === undefined &&
    options.options.databaseUrl === undefined &&
    options.options.envName === undefined
  );
}

function resolveSyncVerifyDatabaseUrl(
  options: VerifyPendingMigrationsForSyncOptions
): string | undefined {
  try {
    if (options.target?.remote === true) {
      const databaseUrl = resolveDatabaseUrl();
      return databaseUrl === options.target.databaseUrl ? undefined : databaseUrl;
    }
    return options.target?.databaseUrl ?? resolveDatabaseUrl(options.options.databaseUrl);
  } catch {
    return;
  }
}

function syncVerifyUrlUnresolvedMessage(options: VerifyPendingMigrationsForSyncOptions): string {
  if (options.target?.remote === true) {
    return `sync requires a separate disposable database URL for verify before applying remote target ${options.target.name}`;
  }
  return "sync requires a database URL for verify before apply or dry-run completion";
}

function syncVerifyUrlUnresolvedHint(options: VerifyPendingMigrationsForSyncOptions): string {
  if (options.target?.remote === true) {
    return "Set SUPASCHEMA_DATABASE_URL to a disposable verification database URL or run inside a local Supabase project; remote target databaseUrl and --database-url apply to the target and are not used for verify.";
  }
  return "Pass --database-url, select a target with databaseUrl/environment, set SUPASCHEMA_DATABASE_URL, or run inside a Supabase project with supabase/config.toml.";
}
