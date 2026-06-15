import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkMigrationSql } from "./check.js";
import { resolveConfig } from "./config.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { migrationsStatus, renderMigrationsStatus } from "./migrations-status.js";

export interface SyncOptions {
  config?: Partial<SupaschemaConfig>;
  databaseUrl?: string;
  directory: string;
  /** Apply pending migrations to the target via `supabase migration up`. */
  local?: boolean;
  /** Push pending migrations to the linked project via `supabase db push`. */
  remote?: boolean;
}

export interface SyncResult {
  applied: boolean;
  diagnostics: Diagnostic[];
  pending: string[];
  report: string;
}

/**
 * Auto-sync orchestration: supaschema gates, the Supabase CLI applies. Every
 * pending migration must pass the static replay-safety check before any
 * runner executes; ghost or out-of-order history refuses outright; and
 * nothing touches a database unless `local`/`remote` was explicitly chosen —
 * the default is a dry run that prints exactly what would execute. History
 * stays runner-owned: supaschema never writes
 * supabase_migrations.schema_migrations itself.
 */
export async function syncMigrations(options: SyncOptions): Promise<SyncResult> {
  const config = resolveConfig(options.config);
  const diagnostics: Diagnostic[] = [];
  if (
    (options.local === true || options.remote === true) &&
    config.workflow.migration_sync === "disabled"
  ) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_DISABLED",
        "error",
        'workflow.migration_sync is "disabled"; remove the apply flag or change it to "explicit_request_only".',
        {
          hint: "supaschema sync without --local/--remote still runs the dry-run status and replay-safety gates.",
        }
      )
    );
    return {
      applied: false,
      diagnostics,
      pending: [],
      report:
        'refusing to sync: workflow.migration_sync is "disabled"; no apply handoff was attempted\n',
    };
  }
  const status = await migrationsStatus({
    directory: options.directory,
    ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
  });
  diagnostics.push(...status.diagnostics);
  const lines: string[] = [renderMigrationsStatus(status.report).trimEnd()];
  if (hasErrors(status.diagnostics)) {
    lines.push("refusing to sync: resolve ghost or out-of-order history first");
    return { applied: false, diagnostics, pending: status.report.pending, report: render(lines) };
  }
  if (status.report.pending.length === 0) {
    lines.push("nothing to sync: disk and target history match");
    return { applied: false, diagnostics, pending: [], report: render(lines) };
  }
  for (const file of status.report.pending) {
    const sql = await readFile(join(options.directory, file), "utf8");
    const checkDiagnostics = await checkMigrationSql(sql, {
      config,
    });
    const errors = checkDiagnostics.filter((item) => item.severity === "error");
    diagnostics.push(...errors);
    if (errors.length > 0) {
      lines.push(`refusing to sync: ${file} fails the replay-safety check`);
      return {
        applied: false,
        diagnostics,
        pending: status.report.pending,
        report: render(lines),
      };
    }
    lines.push(`checked: ${file} (replay-safe)`);
  }
  const planned: string[][] = [];
  if (options.local === true) {
    planned.push(["supabase", "migration", "up"]);
  }
  if (options.remote === true) {
    planned.push(["supabase", "db", "push"]);
  }
  if (planned.length === 0) {
    lines.push(
      `dry run: pass --local to apply ${status.report.pending.length} pending migration(s) via \`supabase migration up\`, --remote to push via \`supabase db push\``
    );
    return { applied: false, diagnostics, pending: status.report.pending, report: render(lines) };
  }
  for (const [command, ...args] of planned) {
    lines.push(`running: ${command} ${args.join(" ")}`);
    const exitCode = await run(command ?? "", args);
    if (exitCode !== 0) {
      diagnostics.push(
        diagnostic(
          "SUPA_SYNC_RUNNER_FAILED",
          "error",
          `\`${command} ${args.join(" ")}\` exited with code ${exitCode}`,
          { hint: "The migration runner owns apply/deploy; inspect its output above." }
        )
      );
      return {
        applied: false,
        diagnostics,
        pending: status.report.pending,
        report: render(lines),
      };
    }
  }
  return { applied: true, diagnostics, pending: status.report.pending, report: render(lines) };
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    // Inherit stdio so the runner's own confirmation prompts reach the user.
    // shell:true on Windows so the Supabase CLI's `.cmd`/`.ps1` shim is
    // spawnable — since Node's CVE-2024-27980 fix, spawn refuses to run a
    // `.cmd` without a shell, which otherwise fails the apply lane with a
    // confusing exit-127. The args are static literals ("migration"/"up",
    // "db"/"push"), never user input, so there is no shell-quoting hazard.
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", () => resolvePromise(127));
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

function render(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}
