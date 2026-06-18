import { resolve } from "node:path";
import type { Command } from "commander";
import { auditModel, renderAuditReport } from "./audit.js";
import { type CheckReporter, renderCheckReport } from "./check-reporters.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { renderCorpusReport, runCorpus } from "./corpus.js";
import { hasErrors } from "./diagnostics.js";
import { isEntitledFromEnv } from "./license.js";
import { migrationsStatus, renderMigrationsStatus } from "./migrations-status.js";
import { buildReadinessReport, classifyMigrationSystems, renderReadiness } from "./onboard.js";
import { evaluateTypeContract, scanSchemaSafety } from "./pipeline-services.js";
import { redactSecrets } from "./redaction.js";
import { buildRemediationPlan } from "./remediation.js";
import { renderScan, scoreGrade } from "./scan.js";
import { extractSourceModel } from "./source.js";
import { syncMigrations } from "./workflow.js";

export interface ReportCommandContext {
  cliVersion: string;
  globalEnvName: () => string | undefined;
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
}

interface SyncCommandOptions {
  databaseUrl?: string;
  diff?: boolean;
  migrationsDir?: string;
  runner?: string;
  target?: string;
}

function resolveReporter(value: string | undefined): CheckReporter | null {
  const reporter = value ?? "text";
  if (reporter !== "text" && reporter !== "json" && reporter !== "github" && reporter !== "sarif") {
    process.stderr.write(
      `supaschema: unknown --reporter "${value}" (use text|json|github|sarif)\n`
    );
    return null;
  }
  return reporter;
}

export function registerReportCommands(program: Command, context: ReportCommandContext): void {
  program
    .command("audit")
    .requiredOption("--from <source>", "source to audit against the support matrix")
    .option("--json", "print the report as JSON")
    .description(
      "Report support-matrix coverage: modeled objects and statements outside the contract."
    )
    .action(async (options: { from: string; json?: boolean }) => {
      const config = await context.loadCliConfig();
      const model = await extractSourceModel(options.from, { config });
      const report = auditModel(model);
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderAuditReport(report)
      );
      if (!report.supported) {
        process.exitCode = 2;
      }
    });

  program
    .command("scan")
    .option("--from <source>", "source to scan (defaults to the declarative tree)")
    .option("--reporter <reporter>", "text | json | github | sarif", "text")
    .description("Scan the declarative schema with the rule packs and report a safety score.")
    .action(async (options: { from?: string; reporter?: CheckReporter }) => {
      const config = await context.loadCliConfig();
      const reporter = resolveReporter(options.reporter);
      if (reporter === null) {
        process.exitCode = 2;
        return;
      }
      const { result, source } = await scanSchemaSafety(config, options.from);
      if (reporter === "text") {
        process.stdout.write(
          `Postgres safety score: ${result.score}/100 (${scoreGrade(result.score)})\n`
        );
        const body = renderScan(result, "text", source);
        if (body.length > 0) {
          process.stdout.write(redactSecrets(body));
        }
      } else {
        process.stdout.write(redactSecrets(renderScan(result, reporter, source)));
      }
      if (result.errorCount > 0) {
        process.exitCode = 2;
      }
    });

  program
    .command("onboard")
    .option("--from <source>", "schema source to score (defaults to the declarative tree)")
    .description("Detect the current migration system and report onboarding readiness.")
    .action(async (options: { from?: string }) => {
      const config = await context.loadCliConfig();
      const systems = classifyMigrationSystems(process.cwd());
      const { result } = await scanSchemaSafety(config, options.from);
      const readiness = buildReadinessReport(systems, result, scoreGrade(result.score));
      process.stdout.write(`${renderReadiness(readiness)}\n`);
      if (!readiness.ready && result.diagnostics.length > 0) {
        const steps = buildRemediationPlan(result.diagnostics)
          .map((step) => `  ${step.order}. ${step.diagnostic.code}`)
          .join("\n");
        process.stdout.write(`Remediate in order:\n${redactSecrets(steps)}\n`);
      }
    });

  program
    .command("type-contract")
    .option("--from <source>", "previous schema source (default git:HEAD)")
    .option("--to <source>", "new schema source (defaults to the declarative tree)")
    .option("--reporter <reporter>", "text | json | github | sarif", "text")
    .option("--enforce", "fail (exit 2) on breaking changes — licensed; free is report-only")
    .description("Gate breaking changes in the generated type contract between two schema sources.")
    .action(
      async (options: {
        enforce?: boolean;
        from?: string;
        reporter?: CheckReporter;
        to?: string;
      }) => {
        const config = await context.loadCliConfig();
        const reporter = resolveReporter(options.reporter);
        if (reporter === null) {
          process.exitCode = 2;
          return;
        }
        const fromSource = options.from ?? "git:HEAD";
        const toSource = options.to ?? config.sources.to;
        const contract = await evaluateTypeContract({ config, fromSource, toSource });
        const report = renderCheckReport(
          reporter,
          [
            { diagnostics: contract.beforeDiagnostics, file: fromSource },
            { diagnostics: contract.afterDiagnostics, file: toSource },
            { diagnostics: contract.diagnostics, file: toSource },
          ].filter((entry) => entry.diagnostics.length > 0)
        );
        process.stdout.write(redactSecrets(report));
        if (contract.sourceDiagnostics.some((item) => item.severity === "error")) {
          process.exitCode = 2;
          return;
        }
        if (
          !contract.diagnostics.some((item) => item.severity === "error") ||
          options.enforce !== true
        ) {
          return;
        }
        if (isEntitledFromEnv(process.env, Math.floor(Date.now() / 1000))) {
          process.exitCode = 2;
        } else {
          process.stderr.write(
            "supaschema: --enforce requires a license; reporting only (free tier).\n"
          );
        }
      }
    );

  program
    .command("migrations")
    .option("--migrations-dir <dir>", "migration files directory")
    .option(
      "--database-url <url>",
      "target whose applied history to compare (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack); run once per target to compare local and remote"
    )
    .option("--history-table <schema.table>", "migration history table", undefined)
    .option("--json", "print the report as JSON")
    .description("Reconcile migration files on disk against a target's applied history.")
    .action(
      async (options: {
        databaseUrl?: string;
        historyTable?: string;
        json?: boolean;
        migrationsDir?: string;
      }) => {
        const config = await context.loadCliConfig();
        const databaseUrl = await context.resolveCliDatabaseUrl(options.databaseUrl);
        const { diagnostics, report } = await migrationsStatus({
          directory: resolve(process.cwd(), options.migrationsDir ?? config.migrationsDir),
          ...(databaseUrl === undefined ? {} : { databaseUrl }),
          ...(options.historyTable === undefined ? {} : { historyTable: options.historyTable }),
        });
        context.printDiagnostics(diagnostics);
        process.stdout.write(
          options.json === true
            ? `${JSON.stringify(report, null, 2)}\n`
            : renderMigrationsStatus(report)
        );
        if (hasErrors(diagnostics)) {
          process.exitCode = 2;
        }
      }
    );

  program
    .command("corpus")
    .option("--corpus-dir <dir>", "corpus directory", "corpus/supabase-style")
    .option(
      "--database-url <url>",
      "admin URL for disposable corpus databases (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack)"
    )
    .option("--json", "print the report as JSON")
    .description(
      "Run the corpus oracle: replay the dirty-real migrations corpus, diff against its tree, apply the reconciliation twice, and require reconvergence to zero."
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
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderCorpusReport(report)
      );
      if (hasErrors(diagnostics)) {
        process.exitCode = 2;
      }
    });

  program
    .command("sync")
    .option("--migrations-dir <dir>", "migration files directory")
    .option(
      "--database-url <url>",
      "target whose applied history gates the sync (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack)"
    )
    .option("--target <name>", "operator override for one configured sync target")
    .option("--runner <runner>", "operator override: direct | supabase-cli")
    .option("--no-diff", "skip schema diff generation and generated output refresh")
    .description(
      "Run the sync pipeline: schema diff, generated outputs, safety gates, target reconciliation, and selected runner apply/deploy."
    )
    .action((options: SyncCommandOptions) => runSyncCommand(options, context));
}

function resolveSyncRunner(value: string | undefined): "direct" | "supabase-cli" | undefined {
  if (value === undefined) {
    return;
  }
  return value === "direct" || value === "supabase-cli" ? value : undefined;
}

function syncUsesConfiguredTargets(options: SyncCommandOptions, config: SupaschemaConfig): boolean {
  if (options.target !== undefined) {
    return true;
  }
  return (
    config.workflow.migration_sync === "auto" &&
    Object.values(config.sync.targets).some((target) => target.mode === "auto")
  );
}

async function runSyncCommand(
  options: SyncCommandOptions,
  context: ReportCommandContext
): Promise<void> {
  const config = await context.loadCliConfig();
  const runner = resolveSyncRunner(options.runner);
  if (runner === undefined && options.runner !== undefined) {
    process.stderr.write(
      `supaschema: unknown --runner "${options.runner}" (use direct|supabase-cli)\n`
    );
    process.exitCode = 2;
    return;
  }
  const databaseUrl =
    options.databaseUrl !== undefined || !syncUsesConfiguredTargets(options, config)
      ? await context.resolveCliDatabaseUrl(options.databaseUrl)
      : undefined;
  const envName = context.globalEnvName();
  const result = await syncMigrations({
    cliVersion: context.cliVersion,
    config,
    directory: resolve(process.cwd(), options.migrationsDir ?? config.migrationsDir),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(envName === undefined ? {} : { envName }),
    pipeline: true,
    ...(runner === undefined ? {} : { runner }),
    skipDiff: options.diff === false,
    ...(options.target === undefined ? {} : { target: options.target }),
  });
  context.printDiagnostics(result.diagnostics);
  process.stdout.write(result.report);
  if (hasErrors(result.diagnostics)) {
    process.exitCode = 2;
  }
}
