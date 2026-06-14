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

type PlanCommandOptions = { from?: string; to?: string; schema?: string; timing?: boolean };
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
    .option("--from <source>", "source model before the change (default: database, then git:HEAD)")
    .option("--to <target>", "source model after the change (default: the config schema tree)")
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
    .option("--from <source>", "source model before the change (default: database, then git:HEAD)")
    .option("--to <target>", "source model after the change (default: the config schema tree)")
    .option(
      "--out <file>",
      "output file path or stdout (default: <migrations-dir>/<UTC timestamp>_<name>.sql)",
    )
    .option("--name <snake_case>", "migration name (default: derived from the planned operations)")
    .option("--migrations-dir <dir>", "migrations directory (default: config.migrationsDir)")
    .option("--schema <names>", "comma-separated schema filter")
    .option("--dry-run", "print the migration and target path without writing")
    .option("--json", "print a JSON payload (fingerprint, operations, sql) instead of raw SQL")
    .option("--fail-on-diff", "exit with code 3 when the plan contains operations (CI drift gate)")
    .option(
      "--no-check-chain",
      "skip the lineage chain gate against pending supaschema migrations in the output directory",
    )
    .option(
      "--summary",
      "print a drift report (operation and diagnostic counts grouped by kind and schema) before any error exit",
    )
    .option(
      "--write-hints <file>",
      "write the gated destructive object keys as a hints.destructive skeleton for review (never overwrites)",
    )
    .option("--timing", "print extract/plan/render phase timings to stderr")
    .option(
      "--watch",
      "re-print the drift summary whenever a dir: source changes (editor loop; implies --dry-run --summary)",
    )
    .description(
      "Render a replay-safe migration from the planned schema diff (zero flags: database/git:HEAD → schema tree → migrations directory).",
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
  context: DiffCommandContext,
): Promise<WithSources<T>> {
  const resolved = await resolveSourceDefaults(options, config, () =>
    context.resolveCliDatabaseUrl(),
  );
  if (resolved.notice !== undefined) {
    process.stderr.write(resolved.notice);
  }
  return { ...options, from: resolved.from, to: resolved.to };
}

async function runDiff(
  options: WithSources<DiffOptions>,
  config: SupaschemaConfig,
  context: DiffCommandContext,
): Promise<void> {
  const plan = await buildPlan(options, config);
  context.printDiagnostics(plan.diagnostics);
  if (options.summary) {
    process.stdout.write(renderPlanSummary(plan));
  }
  if (options.writeHints) {
    const keys = [
      ...new Set(
        plan.operations
          .filter((operation) => operation.blocked && operation.destructive)
          .map((operation) => operation.key),
      ),
    ].sort((left, right) => left.localeCompare(right));
    const hintsPath = resolve(process.cwd(), options.writeHints);
    await writeFile(hintsPath, `${JSON.stringify({ hints: { destructive: keys } }, null, 2)}\n`, {
      flag: "wx",
    });
    process.stderr.write(
      `wrote ${keys.length} gated object keys to ${hintsPath}; review each before merging into hints.destructive\n`,
    );
  }
  if (hasErrors(plan.diagnostics)) {
    process.exitCode = 2;
    return;
  }
  const renderStart = performance.now();
  const rendered = renderMigrationSplit(plan, { config, version: context.cliVersion });
  if (options.timing) {
    process.stderr.write(`timing: render ${Math.round(performance.now() - renderStart)}ms\n`);
  }
  const migrationsDir = resolveMigrationsDir(options.migrationsDir, config);
  const defaultedOut = options.name === undefined && options.out === undefined;
  if (defaultedOut && plan.operations.length === 0 && !options.json) {
    process.stderr.write("no schema changes\n");
    return;
  }
  const outPath =
    options.name !== undefined || defaultedOut
      ? resolve(
          process.cwd(),
          migrationsDir,
          `${migrationTimestamp()}_${options.name ?? defaultMigrationName(plan)}.sql`,
        )
      : options.out === "stdout" || options.out === undefined
        ? undefined
        : resolve(process.cwd(), options.out);
  if (outPath !== undefined && options.checkChain) {
    const chainDiagnostics = await checkLineageChain(plan, dirname(outPath));
    if (chainDiagnostics.length > 0) {
      context.printDiagnostics(chainDiagnostics);
      process.exitCode = 2;
      return;
    }
  }
  const concurrentPath =
    rendered.concurrentSql !== undefined && outPath !== undefined
      ? `${outPath.replace(/\.sql$/u, "")}.concurrent.sql`
      : undefined;
  const payload = options.json
    ? `${JSON.stringify(
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
        2,
      )}\n`
    : rendered.concurrentSql !== undefined && outPath === undefined
      ? `${rendered.sql}\n${rendered.concurrentSql}`
      : rendered.sql;
  if (options.dryRun || outPath === undefined) {
    if (outPath !== undefined) {
      process.stderr.write(`dry-run: would write ${outPath}\n`);
    }
    process.stdout.write(payload);
  } else {
    try {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, rendered.sql, { flag: "wx" });
      if (rendered.concurrentSql !== undefined && concurrentPath !== undefined) {
        await writeFile(concurrentPath, rendered.concurrentSql, { flag: "wx" });
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        context.printDiagnostics([
          diagnostic(
            "SUPA_DIFF_OUTPUT_EXISTS",
            "error",
            "the output migration file already exists; supaschema never overwrites migrations",
            {
              file: outPath,
              hint: "Choose a new --out path or --name, or remove the stale file.",
            },
          ),
        ]);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
    process.stdout.write(
      options.json
        ? payload
        : `${outPath}\n${concurrentPath === undefined ? "" : `${concurrentPath}\n`}`,
    );
    await refreshTypesFile(options.to, config, options.schema);
  }
  if (options.failOnDiff && plan.operations.length > 0) {
    process.exitCode = 3;
  }
}

async function refreshTypesFile(
  toSource: string,
  config: SupaschemaConfig,
  schemaFilter: string | undefined,
): Promise<void> {
  const targets: { generate: (model: SchemaModel) => Promise<string>; relative: string }[] = [
    { generate: generateDatabaseTypes, relative: config.typesFile },
    { generate: generateZodSchemas, relative: config.zodFile },
  ];
  let model: SchemaModel | undefined;
  for (const target of targets) {
    let handle: FileHandle;
    try {
      handle = await open(resolve(process.cwd(), target.relative), "r+");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    try {
      model = model ?? filterModel(await extractSourceModel(toSource, { config }), schemaFilter);
      if (hasErrors(model.diagnostics)) {
        return;
      }
      const generated = await target.generate(model);
      await handle.truncate(0);
      await handle.write(generated, 0);
      process.stderr.write(`types: ${target.relative} refreshed from ${toSource}\n`);
    } finally {
      await handle.close();
    }
  }
}

/**
 * Editor loop: re-print the drift summary whenever a dir: source changes.
 * Watch never writes files — it forces dry-run summary mode.
 */
async function watchDiff(
  options: WithSources<DiffOptions>,
  config: SupaschemaConfig,
  context: DiffCommandContext,
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
        `${redactSecrets(error instanceof Error ? error.message : String(error))}\n`,
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
        void run();
      }, 250);
    });
  }
  process.stdout.write(`watch: watching ${watchedDirs.join(", ")} (ctrl-c to exit)\n`);
  await new Promise(() => undefined);
}

async function buildPlan(
  options: WithSources<PlanCommandOptions>,
  config: SupaschemaConfig,
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
      `timing: extract-from ${Math.round(fromMs)}ms · extract-to ${Math.round(toMs)}ms · plan ${Math.round(performance.now() - planStart)}ms\n`,
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
      .filter(Boolean),
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
        },
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
        },
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
    const tone: SummaryTone = operation.blocked
      ? "blocked"
      : operation.kind === "drop"
        ? "drop"
        : operation.kind === "create"
          ? "create"
          : "plain";
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
