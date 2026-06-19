import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { checkMigrationSql } from "./check.js";
import {
  CHECK_REPORTER_DISPLAY,
  type FileDiagnostics,
  parseCheckReporter,
  renderCheckReport,
} from "./check-reporters.js";
import {
  defaultTreeSource,
  latestMigrationFile,
  migrationFiles,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "./cli-defaults.js";
import { registerDiffCommands } from "./cli-diff.js";
import { registerReportCommands } from "./cli-reports.js";
import { registerToolCommands } from "./cli-tools.js";
import type { SupaschemaConfig } from "./config.js";
import {
  formatConfigValidationDiagnostics,
  loadConfig,
  pendingInstallPathConfirmationDiagnostic,
  validateConfig,
} from "./config.js";
import type { Diagnostic } from "./core.js";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "./database-url.js";
import { diagnosticCatalog, formatDiagnostics, hasErrors } from "./diagnostics.js";
import { filterModel } from "./pipeline-services.js";
import { redactSecrets } from "./redaction.js";
import { selfCheckCatalog } from "./selfcheck.js";
import { extractSourceModel } from "./source.js";
import { verifyMigration } from "./verify.js";
import { generatedMigrationEditHookOutput, schemaWriteHookOutput } from "./workflow.js";

interface GlobalOptions {
  config?: string;
  env?: string;
  quiet?: boolean;
}
interface InitOptions {
  agentBundle?: boolean;
  dryRun?: boolean;
  json?: boolean;
  repair?: boolean;
}
interface InspectOptions {
  from?: string;
  schema?: string;
}
interface VerifyOptions {
  databaseUrl?: string;
  ensureEnvironment?: boolean;
  ensureRoles?: boolean;
  from?: string;
  keepDatabases?: boolean;
  migration?: string;
  migrationsDir?: string;
  to?: string;
}

const cliVersion = await readPackageVersion();
const program = new Command();
program
  .name("supaschema")
  .description("Generate deterministic, replay-safe PostgreSQL/Supabase migrations from SQL trees.")
  .option("--config <path>", "explicit JSON config file path")
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
`
  );

program
  .command("init")
  .description(
    "Scaffold supaschema config plus schema/migration directories in the current directory. Agent rules, skills, hooks, and settings stay in the packaged raw agent bundle unless --agent-bundle is explicitly passed."
  )
  .option("--dry-run", "print the scaffold/repair plan without writing files")
  .option("--json", "print the init result as redacted JSON")
  .option("--repair", "rewrite supaschema.config.json from the canonical contract when needed")
  .option("--agent-bundle", "install the reviewed AI-agent rule, skill, hook, and settings bundle")
  .action(async (options: InitOptions) => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const packageVersion = await readPackageVersion();
    const { scaffoldProject } = await import(
      pathToFileURL(join(packageRoot, "bin", "scaffold.mjs")).href
    );
    const result = await scaffoldProject({
      dryRun: options.dryRun === true,
      interactive: true,
      installAgentBundle: options.agentBundle === true,
      packageRoot,
      packageVersion,
      repair: options.repair === true,
      targetDir: process.cwd(),
    });
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(redactJson(result), null, 2)}\n`);
      return;
    }
    const { agentBundle, installed, pathConfirmationNeeded, preserved = [], skipped } = result;
    const verb = options.dryRun === true ? "would install" : "installed";
    const details = [
      preserved.length > 0 ? `preserved existing ${preserved.join(", ")}` : undefined,
      skipped.length > 0 ? `skipped ${skipped.join(", ")}` : undefined,
    ].filter((detail): detail is string => detail !== undefined);
    const suffix = details.length > 0 ? `; ${details.join("; ")}` : "";
    let status = options.dryRun === true ? "would make no changes" : "no changes";
    if (installed.length > 0) {
      status = `${verb} ${installed.join(", ")}`;
    }
    process.stdout.write(`supaschema: ${status}${suffix}\n`);
    if (agentBundle?.installed !== true) {
      process.stdout.write(
        `supaschema: agent bundle not installed by default; review ${agentBundle?.instructions ?? "node_modules/supaschema/agent-bundle/INSTALL.md"} before installing it on demand\n`
      );
    }
    if (pathConfirmationNeeded) {
      process.stdout.write(
        "supaschema: confirm detected schema/migration paths in .supaschema/install.json before the first diff\n"
      );
    }
  });

const configCommand = program.command("config").description("Inspect and validate configuration.");

configCommand
  .command("validate")
  .option("--json", "print validation diagnostics as JSON")
  .description("Validate supaschema.config.json paths, sources, and credential references.")
  .action(async (options: { json?: boolean }) => {
    const config = await loadCliConfig();
    const configPath = currentConfigPath();
    const diagnostics = await validateConfig(config, process.cwd(), {
      ...(configPath === undefined ? {} : { configPath }),
      includeInstallState: true,
    });
    const hasErrorDiagnostics = diagnostics.some((item) => item.severity === "error");
    if (options.json === true) {
      process.stdout.write(
        `${JSON.stringify({ diagnostics, ok: !hasErrorDiagnostics }, null, 2)}\n`
      );
    } else if (diagnostics.length === 0) {
      process.stdout.write("config ok\n");
    } else {
      process.stdout.write(formatConfigValidationDiagnostics(diagnostics));
    }
    if (hasErrorDiagnostics) {
      process.exitCode = 2;
    }
  });

program
  .command("inspect")
  .option("--from <source>", "source to inspect (default: the config schema tree)")
  .option("--schema <names>", "comma-separated schema filter")
  .description("Extract and print a deterministic schema model.")
  .action(async (options: InspectOptions) => {
    const config = await loadCliConfig();
    const source = options.from ?? defaultTreeSource(config);
    const model = filterModel(await extractSourceModel(source, { config }), options.schema);
    printDiagnostics(model.diagnostics);
    process.stdout.write(`${JSON.stringify(redactJson(model), null, 2)}\n`);
    if (hasErrors(model.diagnostics)) {
      process.exitCode = 2;
    }
  });

registerDiffCommands(program, {
  cliVersion,
  configPath: currentConfigPath,
  loadCliConfig,
  printDiagnostics,
  resolveCliDatabaseUrl,
});
registerReportCommands(program, {
  cliVersion,
  globalEnvName: () => program.opts<GlobalOptions>().env,
  loadCliConfig,
  printDiagnostics,
  resolveCliDatabaseUrl,
});
registerToolCommands(program, {
  configPath: currentConfigPath,
  loadCliConfig,
  printDiagnostics,
  resolveCliDatabaseUrl,
  resolveCliDatabaseUrlInfo,
});

program
  .command("check")
  .argument("[migrations...]", "migration files (default: every .sql in config.migrationsDir)")
  .option("--allow-empty", "exit 0 when config.migrationsDir contains no .sql files")
  .option("--reporter <name>", "text | github | sarif | json", "text")
  .description(
    "Validate replay-safety and parser diagnostics for migration files (shell globs expand to a directory gate; `-` reads stdin; zero args checks the migrations directory)."
  )
  .action(async (migrationArgs: string[], options: { allowEmpty?: boolean; reporter: string }) => {
    const config = await loadCliConfig();
    if (migrationArgs.length === 0) {
      const pendingInstall = await pendingInstallPathConfirmationDiagnostic(
        process.cwd(),
        currentConfigPath()
      );
      if (pendingInstall) {
        process.stderr.write(formatConfigValidationDiagnostics([pendingInstall]));
        process.exitCode = 2;
        return;
      }
    }
    const migrationPaths =
      migrationArgs.length > 0
        ? migrationArgs
        : await migrationFiles(resolve(process.cwd(), config.migrationsDir));
    if (migrationPaths.length === 0) {
      process.stderr.write(`no migrations found in ${config.migrationsDir}\n`);
      if (options.allowEmpty !== true) {
        process.exitCode = 1;
      }
      return;
    }
    const results: FileDiagnostics[] = [];
    for (const migrationPath of migrationPaths) {
      const sql = migrationPath === "-" ? await readStdin() : await readFile(migrationPath, "utf8");
      const diagnostics = await checkMigrationSql(sql, { config, cwd: process.cwd() });
      results.push({ diagnostics, file: migrationPath === "-" ? "<stdin>" : migrationPath });
    }
    const reporter = parseCheckReporter(options.reporter);
    if (reporter === undefined) {
      process.stderr.write(
        `supaschema: unknown --reporter "${options.reporter}" (use ${CHECK_REPORTER_DISPLAY})\n`
      );
      process.exitCode = 2;
      return;
    }
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
        migrationPaths.length > 1 ? `ok (${migrationPaths.length} files)\n` : "ok\n"
      );
    }
  });

program
  .command("verify")
  .option("--from <source>", "source model before the change (default: config.sources.from)")
  .option("--to <target>", "source model after the change (default: config.sources.to)")
  .option(
    "--migration <file>",
    "migration SQL file to apply twice (default: newest .sql in config.migrationsDir)"
  )
  .option("--migrations-dir <dir>", "migrations directory (default: config.migrationsDir)")
  .option(
    "--database-url <url>",
    "PostgreSQL URL whose role can create temporary databases (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack from supabase/config.toml)"
  )
  .option(
    "--ensure-roles",
    "create missing NOLOGIN roles referenced by grants/policies on the verification server (cluster-level; never dropped)"
  )
  .option(
    "--ensure-environment",
    "stub Supabase-provisioned surfaces (auth helpers, cron schema) in the temporary databases"
  )
  .option(
    "--no-ensure-environment",
    "disable the Supabase environment stub when another command or config enables it"
  )
  .option(
    "--keep-databases",
    "keep the temporary databases after the run and print their names (debugging failed verifies)"
  )
  .description("Apply from + migration twice and compare against target in temporary databases.")
  .action(async (options: VerifyOptions) => {
    const config = await loadCliConfig();
    const databaseUrl = await resolveCliDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
      process.stderr.write(
        "no database URL: pass --database-url, --env, set SUPASCHEMA_DATABASE_URL, or run inside a project with supabase/config.toml\n"
      );
      process.exitCode = 1;
      return;
    }
    const migrationsDir = resolveMigrationsDir(options.migrationsDir, config);
    const migrationPath =
      options.migration ?? (await latestMigrationFile(resolve(process.cwd(), migrationsDir)));
    if (migrationPath === undefined) {
      process.stderr.write(`no migration to verify: ${migrationsDir} has no .sql files\n`);
      process.exitCode = 1;
      return;
    }
    const sources = await resolveSourceDefaults(options, config, () =>
      resolveCliDatabaseUrl(options.databaseUrl)
    );
    if (sources.notice !== undefined) {
      process.stderr.write(sources.notice);
    }
    if (options.migration === undefined) {
      process.stderr.write(`defaults: --migration ${migrationPath} (flags override)\n`);
    }
    const diagnostics = await verifyMigration({
      config,
      databaseUrl,
      ensureRoles: options.ensureRoles === true,
      ...(options.ensureEnvironment === undefined
        ? {}
        : { ensureEnvironment: options.ensureEnvironment }),
      ...(options.keepDatabases === true ? { keepDatabases: true } : {}),
      from: sources.from,
      migrationPath,
      to: sources.to,
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
    "PostgreSQL URL to extract (default: SUPASCHEMA_DATABASE_URL, then the local Supabase stack from supabase/config.toml)"
  )
  .description("Re-extract the live catalog's rendered SQL and report identity normalization gaps.")
  .action(async (options: { databaseUrl?: string }) => {
    const databaseUrl = await resolveCliDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
      process.stderr.write(
        "no database URL: pass --database-url, --env, set SUPASCHEMA_DATABASE_URL, or run inside a project with supabase/config.toml\n"
      );
      process.exitCode = 1;
      return;
    }
    const result = await selfCheckCatalog({ databaseUrl });
    printDiagnostics(result.diagnostics);
    process.stdout.write(
      `selfcheck: ${result.checkedObjects} objects, ${result.mismatches} parity mismatches\n`
    );
    if (hasErrors(result.diagnostics)) {
      process.exitCode = 2;
    }
  });

program
  .command("explain")
  .argument("<code>", "diagnostic code, e.g. SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED")
  .description("Explain a supaschema diagnostic code.")
  .action((code: string) => {
    const summary = diagnosticCatalog[code.toUpperCase()];
    if (!summary) {
      process.stderr.write(`unknown diagnostic code "${code}"\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${code.toUpperCase()}: ${summary}\n`);
  });

const hookCommand = program
  .command("hook", { hidden: true })
  .description("Internal agent hook entrypoints.");

hookCommand
  .command("schema-write", { hidden: true })
  .description("Run the internal schema-write hook workflow.")
  .action(() =>
    runHookFailOpen(async () => {
      const payload = JSON.parse(await readStdin());
      const output = await schemaWriteHookOutput(payload);
      if (output !== undefined) {
        process.stdout.write(`${JSON.stringify(output)}\n`);
      }
    })
  );

hookCommand
  .command("generated-migration-edit", { hidden: true })
  .option("--runtime <runtime>", "claude | codex", "claude")
  .description("Run the internal generated-migration edit guard.")
  .action((options: { runtime?: string }) =>
    runHookFailOpen(async () => {
      const runtime = options.runtime === "codex" ? "codex" : "claude";
      const payload = JSON.parse(await readStdin());
      const output = generatedMigrationEditHookOutput(payload, runtime);
      if (runtime === "codex") {
        process.stdout.write(`${JSON.stringify(output ?? {})}\n`);
        return;
      }
      if (output?.reason !== undefined) {
        process.stderr.write(`${output.reason}\n`);
        process.exitCode = 2;
      }
    })
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${redactRawError(error)}\n`);
  process.exitCode = 1;
});

function loadCliConfig(): Promise<SupaschemaConfig> {
  const globals = program.opts<GlobalOptions>();
  return loadConfig(process.cwd(), globals.config);
}

function currentConfigPath(): string | undefined {
  return program.opts<GlobalOptions>().config;
}

async function runHookFailOpen(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
}

async function resolveCliDatabaseUrl(explicit?: string): Promise<string | undefined> {
  return (await resolveCliDatabaseUrlInfo(explicit)).url;
}

async function resolveCliDatabaseUrlInfo(
  explicit?: string
): Promise<{ lane: string; url: string | undefined }> {
  if (explicit) {
    return { lane: "explicit --database-url", url: resolveDatabaseUrl(explicit) };
  }
  const globals = program.opts<GlobalOptions>();
  if (globals.env) {
    const config = await loadCliConfig();
    const entry = config.environments[globals.env];
    if (!entry) {
      throw new Error(
        `--env "${globals.env}" is not defined in config.environments (known: ${Object.keys(config.environments).join(", ") || "none"})`
      );
    }
    return { lane: `--env ${globals.env}`, url: resolveDatabaseUrl(entry.databaseUrl) };
  }
  const url = resolveDatabaseUrl();
  const lane = resolvedDatabaseUrlLane();
  return { lane, url };
}

function resolvedDatabaseUrlLane(): string {
  if (process.env.SUPASCHEMA_DATABASE_URL) {
    return "SUPASCHEMA_DATABASE_URL";
  }
  if (resolveSupabaseLocalDatabaseUrl()) {
    return "supabase/config.toml auto-discovery";
  }
  return "none";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
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

function redactRawError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function redactJson(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item)]));
  }
  return value;
}

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const version = Reflect.get(parsed, "version");
      return typeof version === "string" ? version : "0.0.0";
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
