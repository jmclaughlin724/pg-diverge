import { resolve } from "node:path";
import type { Command } from "commander";
import { auditModel, renderAuditReport } from "./audit.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { renderCorpusReport, runCorpus } from "./corpus.js";
import { hasErrors } from "./diagnostics.js";
import { migrationsStatus, renderMigrationsStatus } from "./migrations-status.js";
import { extractSourceModel } from "./source.js";
import { syncMigrations } from "./sync.js";

export interface ReportCommandContext {
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
}

export function registerReportCommands(program: Command, context: ReportCommandContext): void {
  program
    .command("audit")
    .requiredOption("--from <source>", "source to audit against the support matrix")
    .option("--json", "print the report as JSON")
    .description(
      "Report support-matrix coverage: modeled objects and statements outside the contract.",
    )
    .action(async (options: { from: string; json?: boolean }) => {
      const config = await context.loadCliConfig();
      const model = await extractSourceModel(options.from, { config });
      const report = auditModel(model);
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderAuditReport(report),
      );
      if (!report.supported) {
        process.exitCode = 2;
      }
    });

  program
    .command("migrations")
    .option("--migrations-dir <dir>", "migration files directory", "supabase/migrations")
    .option(
      "--database-url <url>",
      "target whose applied history to compare (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack); run once per target to compare local and remote",
    )
    .option("--history-table <schema.table>", "migration history table", undefined)
    .option("--json", "print the report as JSON")
    .description("Reconcile migration files on disk against a target's applied history.")
    .action(
      async (options: {
        databaseUrl?: string;
        historyTable?: string;
        json?: boolean;
        migrationsDir: string;
      }) => {
        const databaseUrl = await context.resolveCliDatabaseUrl(options.databaseUrl);
        const { diagnostics, report } = await migrationsStatus({
          directory: resolve(process.cwd(), options.migrationsDir),
          ...(databaseUrl === undefined ? {} : { databaseUrl }),
          ...(options.historyTable === undefined ? {} : { historyTable: options.historyTable }),
        });
        context.printDiagnostics(diagnostics);
        process.stdout.write(
          options.json === true
            ? `${JSON.stringify(report, null, 2)}\n`
            : renderMigrationsStatus(report),
        );
        if (hasErrors(diagnostics)) {
          process.exitCode = 2;
        }
      },
    );

  program
    .command("corpus")
    .option("--corpus-dir <dir>", "corpus directory", "corpus/supabase-style")
    .option(
      "--database-url <url>",
      "admin URL for disposable corpus databases (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack)",
    )
    .option("--json", "print the report as JSON")
    .description(
      "Run the corpus oracle: replay the dirty-real migrations corpus, diff against its tree, apply the reconciliation twice, and require reconvergence to zero.",
    )
    .action(async (options: { corpusDir: string; databaseUrl?: string; json?: boolean }) => {
      const databaseUrl = await context.resolveCliDatabaseUrl(options.databaseUrl);
      if (databaseUrl === undefined) {
        process.stdout.write("corpus: skipped (no database URL resolved)\n");
        return;
      }
      const { diagnostics, report } = await runCorpus({
        corpusDir: resolve(process.cwd(), options.corpusDir),
        databaseUrl,
      });
      context.printDiagnostics(diagnostics);
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderCorpusReport(report),
      );
      if (hasErrors(diagnostics)) {
        process.exitCode = 2;
      }
    });

  program
    .command("sync")
    .option("--migrations-dir <dir>", "migration files directory", "supabase/migrations")
    .option(
      "--database-url <url>",
      "target whose applied history gates the sync (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack)",
    )
    .option("--local", "apply pending migrations to the target via `supabase migration up`")
    .option("--remote", "push pending migrations to the linked project via `supabase db push`")
    .description(
      "Gate and apply pending migrations: status + replay-safety checks, then the Supabase CLI runs the actual apply/deploy. Dry run without --local/--remote.",
    )
    .action(
      async (options: {
        databaseUrl?: string;
        local?: boolean;
        migrationsDir: string;
        remote?: boolean;
      }) => {
        const config = await context.loadCliConfig();
        const databaseUrl = await context.resolveCliDatabaseUrl(options.databaseUrl);
        const result = await syncMigrations({
          config,
          directory: resolve(process.cwd(), options.migrationsDir),
          ...(databaseUrl === undefined ? {} : { databaseUrl }),
          ...(options.local === true ? { local: true } : {}),
          ...(options.remote === true ? { remote: true } : {}),
        });
        context.printDiagnostics(result.diagnostics);
        process.stdout.write(result.report);
        if (hasErrors(result.diagnostics)) {
          process.exitCode = 2;
        }
      },
    );
}
