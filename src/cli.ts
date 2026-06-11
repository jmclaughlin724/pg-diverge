import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { checkMigrationSql } from "./check.js";
import type { CheckReporter, FileDiagnostics } from "./check-reporters.js";
import { renderCheckReport } from "./check-reporters.js";
import { filterModel, registerDiffCommands } from "./cli-diff.js";
import { registerReportCommands } from "./cli-reports.js";
import { registerToolCommands } from "./cli-tools.js";
import type { PgDivergeConfig } from "./config.js";
import { defaultConfigFile, loadConfig } from "./config.js";
import type { Diagnostic } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { diagnosticCatalog, formatDiagnostics, hasErrors } from "./diagnostics.js";
import { selfCheckCatalog } from "./selfcheck.js";
import { extractSourceModel } from "./source.js";
import { verifyMigration } from "./verify.js";

type GlobalOptions = { config?: string; env?: string; quiet?: boolean };
type InspectOptions = { from: string; schema?: string };
type VerifyOptions = {
  from: string;
  to: string;
  databaseUrl?: string;
  ensureRoles?: boolean;
  ensureEnvironment?: boolean;
  keepDatabases?: boolean;
  migration: string;
};

const cliVersion = await readPackageVersion();
const program = new Command();
program
  .name("pg-diverge")
  .description("Generate deterministic, replay-safe PostgreSQL/Supabase migrations from SQL trees.")
  .option("--config <path>", "explicit config file path (.json, .mjs, or .js)")
  .option("--env <name>", "named environment from config.environments for the database URL")
  .option("--quiet", "suppress diagnostic output on stderr")
  .version(cliVersion)
  .addHelpText(
    "after",
    `
Exit codes:
  0  success
  1  runtime error (bad arguments, unreadable input, crash)
  2  diagnostics contained at least one error
  3  --fail-on-diff was set and the plan contained operations
`,
  );

program
  .command("init")
  .description("Create pg-diverge.config.json in the current directory.")
  .action(async () => {
    const path = resolve(process.cwd(), "pg-diverge.config.json");
    try {
      await writeFile(path, defaultConfigFile, { flag: "wx" });
      process.stdout.write(`${path}\n`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        process.stderr.write("pg-diverge.config.json already exists\n");
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

program
  .command("inspect")
  .requiredOption("--from <source>", "source to inspect")
  .option("--schema <names>", "comma-separated schema filter")
  .description("Extract and print a deterministic schema model.")
  .action(async (options: InspectOptions) => {
    const config = await loadCliConfig();
    const model = filterModel(await extractSourceModel(options.from, { config }), options.schema);
    printDiagnostics(model.diagnostics);
    process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    if (hasErrors(model.diagnostics)) {
      process.exitCode = 2;
    }
  });

registerDiffCommands(program, { cliVersion, loadCliConfig, printDiagnostics });
registerReportCommands(program, { loadCliConfig, printDiagnostics, resolveCliDatabaseUrl });
registerToolCommands(program, { loadCliConfig, printDiagnostics, resolveCliDatabaseUrl });

program
  .command("check")
  .argument("<migrations...>")
  .option("--reporter <name>", "text | github | sarif | json", "text")
  .description(
    "Validate replay-safety and parser diagnostics for one or more migration files (shell globs expand to a directory gate; `-` reads stdin).",
  )
  .action(async (migrationPaths: string[], options: { reporter: string }) => {
    const config = await loadCliConfig();
    const results: FileDiagnostics[] = [];
    for (const migrationPath of migrationPaths) {
      const sql = migrationPath === "-" ? await readStdin() : await readFile(migrationPath, "utf8");
      const diagnostics = await checkMigrationSql(sql, { config, cwd: process.cwd() });
      results.push({ diagnostics, file: migrationPath === "-" ? "<stdin>" : migrationPath });
    }
    const reporter = options.reporter as CheckReporter;
    const report = renderCheckReport(reporter, results);
    if (report.length > 0) {
      process.stdout.write(report);
    }
    if (results.some((entry) => hasErrors(entry.diagnostics))) {
      process.exitCode = 2;
      return;
    }
    if (reporter === "text") {
      process.stdout.write(
        migrationPaths.length > 1 ? `ok (${migrationPaths.length} files)\n` : "ok\n",
      );
    }
  });

program
  .command("verify")
  .requiredOption("--from <source>", "source model before the change")
  .requiredOption("--to <target>", "source model after the change")
  .requiredOption("--migration <file>", "migration SQL file to apply twice")
  .option(
    "--database-url <url>",
    "PostgreSQL URL whose role can create temporary databases (default: PG_DIVERGE_DATABASE_URL, then the local Supabase stack from supabase/config.toml)",
  )
  .option(
    "--ensure-roles",
    "create missing NOLOGIN roles referenced by grants/policies on the verification server (cluster-level; never dropped)",
  )
  .option(
    "--ensure-environment",
    "stub Supabase-provisioned surfaces (auth helpers, cron schema) in the temporary databases (default under adapter supabase-auto)",
  )
  .option(
    "--keep-databases",
    "keep the temporary databases after the run and print their names (debugging failed verifies)",
  )
  .description("Apply from + migration twice and compare against target in temporary databases.")
  .action(async (options: VerifyOptions) => {
    const config = await loadCliConfig();
    const databaseUrl = await resolveCliDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
      process.stderr.write(
        "no database URL: pass --database-url, --env, set PG_DIVERGE_DATABASE_URL, or run inside a project with supabase/config.toml\n",
      );
      process.exitCode = 1;
      return;
    }
    const diagnostics = await verifyMigration({
      config,
      databaseUrl,
      ensureRoles: options.ensureRoles === true,
      ...(options.ensureEnvironment === true ? { ensureEnvironment: true } : {}),
      ...(options.keepDatabases === true ? { keepDatabases: true } : {}),
      from: options.from,
      migrationPath: options.migration,
      to: options.to,
    });
    printDiagnostics(diagnostics);
    if (hasErrors(diagnostics)) {
      process.exitCode = 2;
      return;
    }
    process.stdout.write("ok\n");
  });

program
  .command("selfcheck")
  .option(
    "--database-url <url>",
    "PostgreSQL URL to extract (default: PG_DIVERGE_DATABASE_URL, then the local Supabase stack from supabase/config.toml)",
  )
  .description("Re-extract the live catalog's rendered SQL and report identity normalization gaps.")
  .action(async (options: { databaseUrl?: string }) => {
    const databaseUrl = await resolveCliDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
      process.stderr.write(
        "no database URL: pass --database-url, --env, set PG_DIVERGE_DATABASE_URL, or run inside a project with supabase/config.toml\n",
      );
      process.exitCode = 1;
      return;
    }
    const result = await selfCheckCatalog({ databaseUrl });
    printDiagnostics(result.diagnostics);
    process.stdout.write(
      `selfcheck: ${result.checkedObjects} objects, ${result.mismatches} parity mismatches\n`,
    );
    if (hasErrors(result.diagnostics)) {
      process.exitCode = 2;
    }
  });

program
  .command("explain")
  .argument("<code>", "diagnostic code, e.g. PD_PLAN_DESTRUCTIVE_HINT_REQUIRED")
  .description("Explain a pg-diverge diagnostic code.")
  .action((code: string) => {
    const summary = diagnosticCatalog[code.toUpperCase()];
    if (!summary) {
      process.stderr.write(`unknown diagnostic code "${code}"\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${code.toUpperCase()}: ${summary}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function loadCliConfig(): Promise<PgDivergeConfig> {
  const globals = program.opts<GlobalOptions>();
  return loadConfig(process.cwd(), globals.config);
}

/**
 * Database URL precedence: explicit flag, then the named --env entry from
 * config.environments, then the shared resolver (PG_DIVERGE_DATABASE_URL,
 * then supabase/config.toml discovery). Environment values support the same
 * $ENV_NAME indirection as the flag.
 */
async function resolveCliDatabaseUrl(explicit?: string): Promise<string | undefined> {
  if (explicit) {
    return resolveDatabaseUrl(explicit);
  }
  const globals = program.opts<GlobalOptions>();
  if (globals.env) {
    const config = await loadCliConfig();
    const entry = config.environments[globals.env];
    if (!entry) {
      throw new Error(
        `--env "${globals.env}" is not defined in config.environments (known: ${Object.keys(config.environments).join(", ") || "none"})`,
      );
    }
    return resolveDatabaseUrl(entry.databaseUrl);
  }
  return resolveDatabaseUrl();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  const globals = program.opts<GlobalOptions>();
  if (globals.quiet || diagnostics.length === 0) {
    return;
  }
  process.stderr.write(`${formatDiagnostics(diagnostics)}\n`);
}

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
