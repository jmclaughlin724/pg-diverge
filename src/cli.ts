#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Command } from "commander";
import { checkMigrationSql } from "./check/migration.js";
import {
  CHECK_REPORTER_DISPLAY,
  type FileDiagnostics,
  parseCheckReporter,
  renderCheckReport,
} from "./check/report.js";
import { registerDiffCommands } from "./cli/diff.js";
import { registerReportCommands } from "./cli/reports.js";
import { registerToolCommands } from "./cli/tools.js";
import type { SupaschemaConfig } from "./config/schema.js";
import { loadConfig } from "./config/schema.js";
import {
  formatConfigValidationDiagnostics,
  pendingInstallPathConfirmationDiagnostic,
  validateConfig,
} from "./config/validate.js";
import type { Diagnostic } from "./core.js";
import { databaseUrlLane, resolveDatabaseUrl } from "./database/url.js";
import { diagnosticCatalog, formatDiagnostics, hasErrors } from "./diagnostics.js";
import { generatedMigrationEditHookOutput, schemaWriteHookOutput } from "./hooks/output.js";
import { latestMigrationFile, migrationFiles } from "./migrations/files.js";
import { filterModel } from "./pipeline/diff.js";
import { redactSecrets } from "./redaction.js";
import { selfCheckCatalog } from "./selfcheck.js";
import { extractSourceModel } from "./source/extract.js";
import {
  defaultTreeSource,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "./source/resolve.js";
import { verifyMigration } from "./verify/migration.js";

interface GlobalOptions {
  config?: string;
  env?: string;
  quiet?: boolean;
}
interface InitOptions {
  dryRun?: boolean;
  json?: boolean;
  repair?: boolean;
}
interface CheckOptions {
  allowEmpty?: boolean;
  base?: string;
  changed?: boolean;
  reporter: string;
  since?: string;
  staged?: boolean;
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
const execFileAsync = promisify(execFile);
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
    "Scaffold supaschema config, schema/migration directories, and active AI-agent enforcement files in the current directory."
  )
  .option("--dry-run", "print the scaffold/repair plan without writing files")
  .option("--json", "print the init result as redacted JSON")
  .option("--repair", "rewrite supaschema.config.json from the canonical contract when needed")
  .action(async (options: InitOptions) => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const packageVersion = await readPackageVersion();
    const { scaffoldProject } = await import(
      pathToFileURL(join(packageRoot, "bin", "scaffold.mjs")).href
    );
    const result = await scaffoldProject({
      dryRun: options.dryRun === true,
      interactive: true,
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
    if (agentBundle?.installed === false) {
      process.stdout.write(
        `supaschema: agent bundle installation incomplete; resolve skipped files, then review ${agentBundle?.instructions ?? "node_modules/supaschema/agent-bundle/INSTALL.md"}\n`
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
});
registerReportCommands(program, {
  cliVersion,
  configPath: currentConfigPath,
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
  .option("--changed", "check changed migration files in the working tree and index")
  .option("--staged", "check staged migration files")
  .option("--base <ref>", "check migration files changed against a base ref")
  .option("--since <ref>", "check migration files changed since a ref")
  .option("--reporter <name>", "text | github | sarif | json", "text")
  .description(
    "Validate replay-safety and parser diagnostics for migration files (shell globs expand to a directory gate; `-` reads stdin; zero args checks the migrations directory)."
  )
  .action((migrationArgs: string[], options: CheckOptions) =>
    runCheckCommand(migrationArgs, options)
  );

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

async function runCheckCommand(migrationArgs: string[], options: CheckOptions): Promise<void> {
  const config = await loadCliConfig();
  const selectionMode = checkSelectionMode(options);
  if (await blockInvalidCheckSelection(migrationArgs, options, selectionMode)) {
    return;
  }
  const migrationPaths = await resolveCheckMigrationPaths(config, migrationArgs, selectionMode);
  if (
    writeEmptyCheckSelection(config, migrationPaths, selectionMode, options.allowEmpty === true)
  ) {
    return;
  }
  const results = await checkMigrationPaths(config, migrationPaths);
  writeCheckResults(migrationPaths, results, options.reporter);
}

async function blockInvalidCheckSelection(
  migrationArgs: string[],
  options: CheckOptions,
  selectionMode: CheckSelectionMode | undefined
): Promise<boolean> {
  if (selectionMode !== undefined && migrationArgs.length > 0) {
    process.stderr.write(
      "supaschema: check git-selection flags cannot be combined with explicit migration files\n"
    );
    process.exitCode = 1;
    return true;
  }
  if (hasConflictingCheckSelection(options)) {
    process.stderr.write("supaschema: use only one of --changed, --staged, --base, or --since\n");
    process.exitCode = 1;
    return true;
  }
  if (migrationArgs.length > 0) {
    return false;
  }
  const pendingInstall = await pendingInstallPathConfirmationDiagnostic(
    process.cwd(),
    currentConfigPath()
  );
  if (!pendingInstall) {
    return false;
  }
  process.stderr.write(formatConfigValidationDiagnostics([pendingInstall]));
  process.exitCode = 2;
  return true;
}

async function resolveCheckMigrationPaths(
  config: SupaschemaConfig,
  migrationArgs: string[],
  selectionMode: CheckSelectionMode | undefined
): Promise<string[]> {
  if (migrationArgs.length > 0) {
    return migrationArgs;
  }
  if (selectionMode === undefined) {
    return await migrationFiles(resolve(process.cwd(), config.migrationsDir));
  }
  return await selectedCheckMigrationPaths(config, selectionMode);
}

function writeEmptyCheckSelection(
  config: SupaschemaConfig,
  migrationPaths: string[],
  selectionMode: CheckSelectionMode | undefined,
  allowEmpty: boolean
): boolean {
  if (migrationPaths.length > 0) {
    return false;
  }
  process.stderr.write(
    selectionMode === undefined
      ? `no migrations found in ${config.migrationsDir}\n`
      : `no selected migration files found in ${config.migrationsDir}\n`
  );
  if (!allowEmpty) {
    process.exitCode = 1;
  }
  return true;
}

async function checkMigrationPaths(
  config: SupaschemaConfig,
  migrationPaths: string[]
): Promise<FileDiagnostics[]> {
  const results: FileDiagnostics[] = [];
  for (const migrationPath of migrationPaths) {
    const sql = migrationPath === "-" ? await readStdin() : await readFile(migrationPath, "utf8");
    const diagnostics = await checkMigrationSql(sql, { config, cwd: process.cwd() });
    results.push({ diagnostics, file: migrationPath === "-" ? "<stdin>" : migrationPath });
  }
  return results;
}

function writeCheckResults(
  migrationPaths: string[],
  results: FileDiagnostics[],
  reporterName: string
): void {
  const reporter = parseCheckReporter(reporterName);
  if (reporter === undefined) {
    process.stderr.write(
      `supaschema: unknown --reporter "${reporterName}" (use ${CHECK_REPORTER_DISPLAY})\n`
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
}

type CheckSelectionMode =
  | { kind: "base"; ref: string }
  | { kind: "changed" }
  | { kind: "since"; ref: string }
  | { kind: "staged" };

function checkSelectionMode(options: CheckOptions): CheckSelectionMode | undefined {
  if (options.changed === true) {
    return { kind: "changed" };
  }
  if (options.staged === true) {
    return { kind: "staged" };
  }
  if (options.base !== undefined) {
    return { kind: "base", ref: options.base };
  }
  if (options.since !== undefined) {
    return { kind: "since", ref: options.since };
  }
  return;
}

function hasConflictingCheckSelection(options: CheckOptions): boolean {
  return (
    [
      options.changed === true,
      options.staged === true,
      options.base !== undefined,
      options.since !== undefined,
    ].filter(Boolean).length > 1
  );
}

async function selectedCheckMigrationPaths(
  config: SupaschemaConfig,
  mode: CheckSelectionMode
): Promise<string[]> {
  const gitRoot = await gitRootPath();
  const migrationsDir = migrationDirGitPath(gitRoot, config);
  let selected: string[];
  if (mode.kind === "changed") {
    selected = await changedGitCheckPaths(gitRoot, migrationsDir);
  } else if (mode.kind === "staged") {
    selected = await namedGitDiffCheckPaths(gitRoot, ["diff", "--cached"], migrationsDir);
  } else {
    selected = await namedGitDiffCheckPaths(gitRoot, ["diff", mode.ref], migrationsDir);
  }
  const unique = [
    ...new Set(selected.filter((item) => isSelectedMigrationPath(item, migrationsDir))),
  ];
  unique.sort((left, right) => left.localeCompare(right));
  return unique.map((item) => resolve(gitRoot, item));
}

async function gitRootPath(): Promise<string> {
  const root = (await gitOutput(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  if (root.length === 0) {
    throw new Error("supaschema check git selection requires a git worktree");
  }
  return resolve(root);
}

function migrationDirGitPath(gitRoot: string, config: SupaschemaConfig): string {
  const migrationsDir = resolve(process.cwd(), config.migrationsDir);
  const relativePath = relative(gitRoot, migrationsDir);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("supaschema check migrationsDir must be inside the git worktree");
  }
  return normalizeGitPath(relativePath);
}

async function namedGitDiffCheckPaths(
  gitRoot: string,
  args: string[],
  migrationsDir: string
): Promise<string[]> {
  const output = await gitOutput(
    [...args, "--name-only", "--diff-filter=ACMR", "--", migrationsDir || "."],
    gitRoot
  );
  return output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeGitPath);
}

async function changedGitCheckPaths(gitRoot: string, migrationsDir: string): Promise<string[]> {
  const output = await gitOutput(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", migrationsDir],
    gitRoot
  );
  return parsePorcelainStatusPaths(output).map(normalizeGitPath);
}

function parsePorcelainStatusPaths(output: string): string[] {
  const entries = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  let skipRenameSource = false;
  for (const entry of entries) {
    if (skipRenameSource) {
      skipRenameSource = false;
      continue;
    }
    const x = entry.at(0) ?? " ";
    const y = entry.at(1) ?? " ";
    const path = entry.slice(3);
    if (x !== "D" && y !== "D" && path.length > 0) {
      paths.push(path);
    }
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      skipRenameSource = true;
    }
  }
  return paths;
}

function isSelectedMigrationPath(path: string, migrationsDir: string): boolean {
  if (extname(path).toLowerCase() !== ".sql") {
    return false;
  }
  return migrationsDir.length === 0 || path.startsWith(`${migrationsDir}/`);
}

function normalizeGitPath(path: string): string {
  let normalized = path.split(sep).join("/");
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized === "." ? "" : normalized;
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return stdout;
  } catch (error) {
    const stderr =
      error !== null && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr || "supaschema check git selection failed");
  }
}

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
  const lane = databaseUrlLane();
  return { lane, url };
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
