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
import { redactSecrets } from "./redaction.js";
import { buildRemediationPlan } from "./remediation.js";
import { grantPack, grantPolicyRule, hygienePack, type RulePack, rlsPack } from "./rules.js";
import { renderScan, type ScanResult, scanModel, scoreGrade } from "./scan.js";
import { extractSourceModel } from "./source.js";
import { syncMigrations } from "./sync.js";
import { diffTypeContract } from "./type-contract.js";
import { collectSchemaShapes } from "./typegen-model.js";

export interface ReportCommandContext {
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
}

const VALID_REPORTERS = new Set<CheckReporter>(["text", "json", "github", "sarif"]);

/** Validate a `--reporter` value; write an error and return null on an unknown one. */
function resolveReporter(value: string | undefined): CheckReporter | null {
  const reporter = (value ?? "text") as CheckReporter;
  if (!VALID_REPORTERS.has(reporter)) {
    process.stderr.write(
      `supaschema: unknown --reporter "${value}" (use text|json|github|sarif)\n`
    );
    return null;
  }
  return reporter;
}

const SCAN_PACKS = [grantPack, hygienePack, rlsPack];

/** Resolve a scan source (defaulting to the declarative tree) and run the rule packs. */
async function scanFromSource(
  config: SupaschemaConfig,
  from: string | undefined
): Promise<{ result: ScanResult; source: string }> {
  const source = from ?? config.sources.to;
  const model = await extractSourceModel(source, { config });
  const rolePolicyPack: RulePack = {
    id: "role-policy",
    rules: [grantPolicyRule(config.hints.allowedGrantees)],
    version: "0.1.0",
  };
  return { result: scanModel(model, [...SCAN_PACKS, rolePolicyPack]), source };
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
      const { result, source } = await scanFromSource(config, options.from);
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
      const { result } = await scanFromSource(config, options.from);
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
        const [beforeModel, afterModel] = await Promise.all([
          extractSourceModel(fromSource, { config }),
          extractSourceModel(toSource, { config }),
        ]);
        const [before, after] = await Promise.all([
          collectSchemaShapes(beforeModel),
          collectSchemaShapes(afterModel),
        ]);
        const sourceDiagnostics = [...beforeModel.diagnostics, ...afterModel.diagnostics];
        const diagnostics = diffTypeContract(before, after);
        const report = renderCheckReport(
          reporter,
          [
            { diagnostics: beforeModel.diagnostics, file: fromSource },
            { diagnostics: afterModel.diagnostics, file: toSource },
            { diagnostics, file: toSource },
          ].filter((entry) => entry.diagnostics.length > 0)
        );
        process.stdout.write(redactSecrets(report));
        if (sourceDiagnostics.some((item) => item.severity === "error")) {
          process.exitCode = 2;
          return;
        }
        if (!diagnostics.some((item) => item.severity === "error") || options.enforce !== true) {
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
    .option("--local", "apply pending migrations to the target via `supabase migration up`")
    .option("--remote", "push pending migrations to the linked project via `supabase db push`")
    .description(
      "Gate and apply pending migrations: status + replay-safety checks, then the Supabase CLI runs the actual apply/deploy. Dry run without --local/--remote."
    )
    .action(
      async (options: {
        databaseUrl?: string;
        local?: boolean;
        migrationsDir?: string;
        remote?: boolean;
      }) => {
        const config = await context.loadCliConfig();
        const databaseUrl = await context.resolveCliDatabaseUrl(options.databaseUrl);
        const result = await syncMigrations({
          config,
          directory: resolve(process.cwd(), options.migrationsDir ?? config.migrationsDir),
          ...(databaseUrl === undefined ? {} : { databaseUrl }),
          ...(options.local === true ? { local: true } : {}),
          ...(options.remote === true ? { remote: true } : {}),
        });
        context.printDiagnostics(result.diagnostics);
        process.stdout.write(result.report);
        if (hasErrors(result.diagnostics)) {
          process.exitCode = 2;
        }
      }
    );
}
