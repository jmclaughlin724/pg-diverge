import { watch } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Command } from "commander";
import {
  defaultMigrationName,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "./cli-defaults.js";
import type { SummaryTone } from "./cli-tools.js";
import { colorizeSummaryLine } from "./cli-tools.js";
import type { SupaschemaConfig } from "./config.js";
import type { Diagnostic, MigrationPlan, SchemaModel } from "./core.js";
import { diagnostic, hasErrors, redactSecrets } from "./diagnostics.js";
import { latestLineage } from "./lineage.js";
import { planSchemaDiff } from "./planner.js";
import { renderMigrationSplit } from "./render.js";
import { extractSourceModel, filterModelBySchemas } from "./source.js";
import { generateDatabaseTypes } from "./typegen.js";
import { generateZodSchemas } from "./typegen-zod.js";

const sqlExtensionPattern = /\.sql$/u;

interface PlanCommandOptions {
  from?: string;
  schema?: string;
  timing?: boolean;
  to?: string;
}
type DiffOptions = PlanCommandOptions & {
  checkChain: boolean;
  dryRun?: boolean;
  failOnDiff?: boolean;
  json?: boolean;
  migrationsDir?: string;
  name?: string;
  out?: string;
  summary?: boolean;
  watch?: boolean;
  writeHints?: string;
};

export interface DiffCommandContext {
  cliVersion: string;
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
}

export function registerDiffCommands(program: Command, context: DiffCommandContext): void {
  program
    .command("plan")
    .option("--from <source>", "source model before the change (default: config.sources.from)")
    .option("--to <target>", "source model after the change (default: config.sources.to)")
    .option("--schema <names>", "comma-separated schema filter")
    .option("--timing", "print extract/plan phase timings to stderr")
    .description("Print the planned object-level schema diff as JSON (use `diff` to render SQL).")
    .action(async (options: PlanCommandOptions) => {
      const config = await context.loadCliConfig();
      const plan = await buildPlan(await withSourceDefaults(options, config, context), config);
      context.printDiagnostics(plan.diagnostics);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      if (hasErrors(plan.diagnostics)) {
        process.exitCode = 2;
      }
    });

  program
    .command("diff")
    .option("--from <source>", "source model before the change (default: config.sources.from)")
    .option("--to <target>", "source model after the change (default: config.sources.to)")
    .option(
      "--out <file>",
      "output file path or stdout (default: <migrations-dir>/<UTC timestamp>_<name>.sql)"
    )
    .option("--name <snake_case>", "migration name (default: derived from the planned operations)")
    .option("--migrations-dir <dir>", "migrations directory (default: config.migrationsDir)")
    .option("--schema <names>", "comma-separated schema filter")
    .option("--dry-run", "print the migration and target path without writing")
    .option("--json", "print a JSON payload (fingerprint, operations, sql) instead of raw SQL")
    .option("--fail-on-diff", "exit with code 3 when the plan contains operations (CI drift gate)")
    .option(
      "--no-check-chain",
      "skip the lineage chain gate against pending supaschema migrations in the output directory"
    )
    .option(
      "--summary",
      "print a drift report (operation and diagnostic counts grouped by kind and schema) before any error exit"
    )
    .option(
      "--write-hints <file>",
      "write the gated destructive object keys as a hints.destructive skeleton for review (never overwrites)"
    )
    .option("--timing", "print extract/plan/render phase timings to stderr")
    .option(
      "--watch",
      "re-print the drift summary whenever a dir: source changes (editor loop; implies --dry-run --summary)"
    )
    .description(
      "Render a replay-safe migration from the configured source diff (zero flags: config.sources -> migrations directory)."
    )
    .action(async (options: DiffOptions) => {
      const config = await context.loadCliConfig();
      const resolved = await withSourceDefaults(options, config, context);
      if (resolved.watch) {
        await watchDiff(resolved, config, context);
        return;
      }
      await runDiff(resolved, config, context);
    });
}

type WithSources<T> = T & { from: string; to: string };

async function withSourceDefaults<T extends PlanCommandOptions>(
  options: T,
  config: SupaschemaConfig,
  context: DiffCommandContext
): Promise<WithSources<T>> {
  const resolved = await resolveSourceDefaults(options, config, () =>
    context.resolveCliDatabaseUrl()
  );
  if (resolved.notice !== undefined) {
    process.stderr.write(resolved.notice);
  }
  return { ...options, from: resolved.from, to: resolved.to };
}

async function runDiff(
  options: WithSources<DiffOptions>,
  config: SupaschemaConfig,
  context: DiffCommandContext
): Promise<void> {
  const plan = await buildPlan(options, config);
  context.printDiagnostics(plan.diagnostics);
  printDiffSummary(options, plan);
  await writeDiffHints(options, plan);
  if (hasErrors(plan.diagnostics)) {
    process.exitCode = 2;
    return;
  }
  const output = renderDiffOutput(options, plan, config, context.cliVersion);
  if (output.shouldSkipEmptyWrite) {
    process.stderr.write("no schema changes\n");
    return;
  }
  if (!(await validateLineageChain(output.outPath, plan, context, options.checkChain))) {
    return;
  }
  await writeOrPrintDiffOutput(options, output, config, context);
  if (options.failOnDiff && plan.operations.length > 0) {
    process.exitCode = 3;
  }
}

function printDiffSummary(options: WithSources<DiffOptions>, plan: MigrationPlan): void {
  if (options.summary) {
    process.stdout.write(renderPlanSummary(plan));
  }
}

async function writeDiffHints(
  options: WithSources<DiffOptions>,
  plan: MigrationPlan
): Promise<void> {
  if (!options.writeHints) {
    return;
  }
  const keys = [
    ...new Set(
      plan.operations
        .filter((operation) => operation.blocked && operation.destructive)
        .map((operation) => operation.key)
    ),
  ].sort((left, right) => left.localeCompare(right));
  const hintsPath = resolve(process.cwd(), options.writeHints);
  await writeFile(hintsPath, `${JSON.stringify({ hints: { destructive: keys } }, null, 2)}\n`, {
    flag: "wx",
  });
  process.stderr.write(
    `wrote ${keys.length} gated object keys to ${hintsPath}; review each before merging into hints.destructive\n`
  );
}

interface DiffOutput {
  concurrentPath: string | undefined;
  outPath: string | undefined;
  payload: string;
  rendered: ReturnType<typeof renderMigrationSplit>;
  shouldSkipEmptyWrite: boolean;
}

function renderDiffOutput(
  options: WithSources<DiffOptions>,
  plan: MigrationPlan,
  config: SupaschemaConfig,
  cliVersion: string
): DiffOutput {
  const renderStart = performance.now();
  const rendered = renderMigrationSplit(plan, { config, version: cliVersion });
  if (options.timing) {
    process.stderr.write(`timing: render ${Math.round(performance.now() - renderStart)}ms\n`);
  }
  const migrationsDir = resolveMigrationsDir(options.migrationsDir, config);
  const defaultedOut = options.name === undefined && options.out === undefined;
  const outPath = resolveDiffOutPath(options, plan, migrationsDir);
  const concurrentPath =
    rendered.concurrentSql !== undefined && outPath !== undefined
      ? `${outPath.replace(sqlExtensionPattern, "")}.concurrent.sql`
      : undefined;
  return {
    concurrentPath,
    outPath,
    payload: renderDiffPayload(options, plan, rendered, outPath, concurrentPath),
    rendered,
    shouldSkipEmptyWrite: defaultedOut && plan.operations.length === 0 && !options.json,
  };
}

async function validateLineageChain(
  outPath: string | undefined,
  plan: MigrationPlan,
  context: DiffCommandContext,
  checkChain: boolean
): Promise<boolean> {
  if (outPath === undefined || !checkChain) {
    return true;
  }
  const chainDiagnostics = await checkLineageChain(plan, dirname(outPath));
  if (chainDiagnostics.length === 0) {
    return true;
  }
  context.printDiagnostics(chainDiagnostics);
  process.exitCode = 2;
  return false;
}

async function writeOrPrintDiffOutput(
  options: WithSources<DiffOptions>,
  output: DiffOutput,
  config: SupaschemaConfig,
  context: DiffCommandContext
): Promise<void> {
  if (options.dryRun || output.outPath === undefined) {
    printDryRunOutput(output);
    return;
  }
  if (!(await writeDiffFiles(output, context))) {
    return;
  }
  process.stdout.write(
    options.json
      ? output.payload
      : `${output.outPath}\n${output.concurrentPath === undefined ? "" : `${output.concurrentPath}\n`}`
  );
  await refreshTypesFile(options.to, config, options.schema);
}

function printDryRunOutput(output: DiffOutput): void {
  if (output.outPath !== undefined) {
    process.stderr.write(`dry-run: would write ${output.outPath}\n`);
  }
  process.stdout.write(output.payload);
}

async function writeDiffFiles(output: DiffOutput, context: DiffCommandContext): Promise<boolean> {
  if (output.outPath === undefined) {
    return true;
  }
  try {
    await mkdir(dirname(output.outPath), { recursive: true });
    await writeFile(output.outPath, output.rendered.sql, { flag: "wx" });
    if (output.rendered.concurrentSql !== undefined && output.concurrentPath !== undefined) {
      await writeFile(output.concurrentPath, output.rendered.concurrentSql, { flag: "wx" });
    }
    return true;
  } catch (error) {
    return handleDiffWriteError(error, output.outPath, context);
  }
}

function handleDiffWriteError(
  error: unknown,
  outPath: string,
  context: DiffCommandContext
): boolean {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") {
    context.printDiagnostics([
      diagnostic(
        "SUPA_DIFF_OUTPUT_EXISTS",
        "error",
        "the output migration file already exists; supaschema never overwrites migrations",
        {
          file: outPath,
          hint: "Choose a new --out path or --name, or remove the stale file.",
        }
      ),
    ]);
    process.exitCode = 2;
    return false;
  }
  throw error;
}

async function refreshTypesFile(
  toSource: string,
  config: SupaschemaConfig,
  schemaFilter: string | undefined
): Promise<void> {
  const targets: {
    generate: (model: SchemaModel) => Promise<string>;
    policy: SupaschemaConfig["workflow"]["type_generation"];
    relative: string;
  }[] = [
    {
      generate: generateDatabaseTypes,
      policy: config.workflow.type_generation,
      relative: config.typesFile,
    },
    {
      generate: generateZodSchemas,
      policy: config.workflow.zod_generation,
      relative: config.zodFile,
    },
  ];
  let model: SchemaModel | undefined;
  for (const target of targets) {
    if (target.policy === "disabled") {
      continue;
    }
    try {
      if (target.policy === "refresh_existing") {
        await refreshExistingGeneratedOutput(target, getModel);
      } else {
        await createOrRefreshGeneratedOutput(target, getModel);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  async function getModel(): Promise<SchemaModel | undefined> {
    model = model ?? filterModel(await extractSourceModel(toSource, { config }), schemaFilter);
    return hasErrors(model.diagnostics) ? undefined : model;
  }
}

async function refreshExistingGeneratedOutput(
  target: {
    generate: (model: SchemaModel) => Promise<string>;
    relative: string;
  },
  getModel: () => Promise<SchemaModel | undefined>
): Promise<void> {
  let handle: FileHandle;
  handle = await open(resolve(process.cwd(), target.relative), "r+");
  try {
    const model = await getModel();
    if (model === undefined) {
      return;
    }
    const generated = await target.generate(model);
    await handle.truncate(0);
    await handle.write(generated, 0);
    process.stderr.write(`types: ${target.relative} refreshed from configured workflow\n`);
  } finally {
    await handle.close();
  }
}

async function createOrRefreshGeneratedOutput(
  target: {
    generate: (model: SchemaModel) => Promise<string>;
    relative: string;
  },
  getModel: () => Promise<SchemaModel | undefined>
): Promise<void> {
  const model = await getModel();
  if (model === undefined) {
    return;
  }
  const outPath = resolve(process.cwd(), target.relative);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, await target.generate(model));
  process.stderr.write(`types: ${target.relative} created or refreshed from configured workflow\n`);
}

/**
 * Editor loop: re-print the drift summary whenever a dir: source changes.
 * Watch never writes files — it forces dry-run summary mode.
 */
async function watchDiff(
  options: WithSources<DiffOptions>,
  config: SupaschemaConfig,
  context: DiffCommandContext
): Promise<void> {
  const watchedDirs = [options.from, options.to]
    .filter((source) => source.startsWith("dir:"))
    .map((source) => resolve(process.cwd(), source.slice("dir:".length)));
  if (watchedDirs.length === 0) {
    process.stderr.write("--watch requires at least one dir: source to watch\n");
    process.exitCode = 1;
    return;
  }
  const watchedOptions: WithSources<DiffOptions> = {
    ...options,
    dryRun: true,
    summary: true,
    watch: false,
  };
  let running = false;
  let queued = false;
  const run = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const startedAt = new Date().toISOString();
      process.stdout.write(`\nwatch: diff at ${startedAt}\n`);
      await runDiff(watchedOptions, config, context);
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(
        `${redactSecrets(error instanceof Error ? error.message : String(error))}\n`
      );
    } finally {
      running = false;
      if (queued) {
        queued = false;
        await run();
      }
    }
  };
  await run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const dir of watchedDirs) {
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        run().catch((error: unknown) => {
          process.stderr.write(
            `${redactSecrets(error instanceof Error ? error.message : String(error))}\n`
          );
          process.exitCode = 2;
        });
      }, 250);
    });
  }
  process.stdout.write(`watch: watching ${watchedDirs.join(", ")} (ctrl-c to exit)\n`);
  await new Promise(() => undefined);
}

async function buildPlan(
  options: WithSources<PlanCommandOptions>,
  config: SupaschemaConfig
): Promise<MigrationPlan> {
  const extractStart = performance.now();
  const from = filterModel(await extractSourceModel(options.from, { config }), options.schema);
  const fromMs = performance.now() - extractStart;
  const toStart = performance.now();
  const to = filterModel(await extractSourceModel(options.to, { config }), options.schema);
  const toMs = performance.now() - toStart;
  const planStart = performance.now();
  const plan = planSchemaDiff(from, to, { config });
  if (options.timing) {
    process.stderr.write(
      `timing: extract-from ${Math.round(fromMs)}ms · extract-to ${Math.round(toMs)}ms · plan ${Math.round(performance.now() - planStart)}ms\n`
    );
  }
  return plan;
}

export function filterModel(model: SchemaModel, schemaFilter: string | undefined): SchemaModel {
  if (!schemaFilter) {
    return model;
  }
  const schemas = new Set(
    schemaFilter
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
  return filterModelBySchemas(model, schemas);
}

function migrationTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

function resolveDiffOutPath(
  options: WithSources<DiffOptions>,
  plan: MigrationPlan,
  migrationsDir: string
): string | undefined {
  if (options.out === "stdout") {
    return;
  }
  if (options.out !== undefined) {
    return resolve(process.cwd(), options.out);
  }
  return resolve(
    process.cwd(),
    migrationsDir,
    `${migrationTimestamp()}_${options.name ?? defaultMigrationName(plan)}.sql`
  );
}

function renderDiffPayload(
  options: WithSources<DiffOptions>,
  plan: MigrationPlan,
  rendered: ReturnType<typeof renderMigrationSplit>,
  outPath: string | undefined,
  concurrentPath: string | undefined
): string {
  if (options.json) {
    return `${JSON.stringify(
      {
        concurrentOut: concurrentPath,
        concurrentSql: rendered.concurrentSql,
        fingerprint: plan.fingerprint,
        operations: plan.operations.map((operation) => ({
          blocked: operation.blocked,
          destructive: operation.destructive,
          key: operation.key,
          kind: operation.kind,
        })),
        out: outPath ?? "stdout",
        sql: rendered.sql,
      },
      null,
      2
    )}\n`;
  }
  if (rendered.concurrentSql !== undefined && outPath === undefined) {
    return renderCombinedSql(rendered.sql, rendered.concurrentSql);
  }
  return rendered.sql;
}

async function checkLineageChain(plan: MigrationPlan, directory: string): Promise<Diagnostic[]> {
  const latest = await latestLineage(directory);
  if (!latest) {
    return [];
  }
  if (latest.from === plan.fromFingerprint && latest.to === plan.toFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_DUPLICATE",
        "error",
        "a pending supaschema migration already covers this exact from/to transition",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration, or pass --no-check-chain to bypass.",
        }
      ),
    ];
  }
  if (latest.to !== plan.fromFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_BROKEN",
        "error",
        "the plan's from-state does not continue the newest pending supaschema migration",
        {
          file: latest.file,
          hint: `Pending migration ends at model ${latest.to.slice(0, 12)}… but this plan starts from ${plan.fromFingerprint.slice(0, 12)}…; diff from the post-migration state (e.g. --from database:<applied-db>) or pass --no-check-chain.`,
        }
      ),
    ];
  }
  return [];
}

export function renderPlanSummary(plan: MigrationPlan): string {
  const lines: string[] = ["plan summary:"];
  const operationCounts = new Map<string, { count: number; tone: SummaryTone }>();
  for (const operation of plan.operations) {
    const label = `${operation.kind} ${operation.ref.kind}${operation.blocked ? " (blocked)" : ""}`;
    const tone = summaryTone(operation);
    const entry = operationCounts.get(label) ?? { count: 0, tone };
    entry.count += 1;
    operationCounts.set(label, entry);
  }
  lines.push(`  operations: ${plan.operations.length}`);
  for (const [label, entry] of [...operationCounts.entries()].sort()) {
    lines.push(colorizeSummaryLine(`    ${entry.count} ${label}`, entry.tone));
  }
  const diagnosticCounts = new Map<string, number>();
  for (const item of plan.diagnostics) {
    const scope = item.ref
      ? ` ${item.ref.kind}${item.ref.schema ? ` ${item.ref.schema}` : ""}`
      : "";
    const label = `${item.severity.toUpperCase()} ${item.code}${scope}`;
    diagnosticCounts.set(label, (diagnosticCounts.get(label) ?? 0) + 1);
  }
  lines.push(`  diagnostics: ${plan.diagnostics.length}`);
  for (const [label, count] of [...diagnosticCounts.entries()].sort()) {
    lines.push(`    ${count} ${label}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderCombinedSql(sql: string, concurrentSql: string): string {
  return `${sql}\n${concurrentSql}`;
}

function summaryTone(operation: MigrationPlan["operations"][number]): SummaryTone {
  if (operation.blocked) {
    return "blocked";
  }
  if (operation.kind === "drop") {
    return "drop";
  }
  if (operation.kind === "create") {
    return "create";
  }
  return "plain";
}
