import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { parseRuntimeSource, RuntimeSourceKind, sourceAuto } from "../config/contract.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { fingerprintObjects, MODEL_FORMAT_VERSION } from "../hash.js";
import { readMigrationContext } from "../migrations/context.js";
import { redactSecrets } from "../redaction.js";
import {
  extractSourceModel,
  filterModelBySchemas,
  objectSchema,
  parseSchemaFilter,
} from "../source/extract.js";
import {
  defaultGitHeadExists,
  defaultTreeSource,
  type ResolvedSources,
} from "../source/resolve.js";
import type {
  Diagnostic,
  MigrationBaselineProof,
  MigrationContext,
  MigrationCorpus,
  SchemaModel,
  SupaschemaConfig,
} from "../types.js";

const execFileAsync = promisify(execFile);

export interface ResolvedGenerationSources extends ResolvedSources {
  diagnostics: Diagnostic[];
}

export type SchemaPlanningMode = "drift" | "generation";

export interface ResolveGenerationSourceOptions {
  cwd?: string;
  from?: string;
  migrationsDir?: string;
  mode?: SchemaPlanningMode;
  to?: string;
}

export interface SchemaPlanningContext {
  diagnostics: Diagnostic[];
  from?: SchemaModel;
  fromMs: number;
  migrationContext?: MigrationContext;
  migrationCorpus?: MigrationCorpus;
  planStart: number;
  to?: SchemaModel;
  toMs: number;
}

export interface SchemaPlanningContextOptions {
  checkMigrationBaseline?: boolean;
  config: SupaschemaConfig;
  cwd?: string;
  excludeMigrationFiles?: readonly string[];
  from: string;
  migrationsDir?: string;
  mode?: SchemaPlanningMode;
  schema?: string;
  to: string;
}

export async function resolveGenerationSourceDefaults(
  options: ResolveGenerationSourceOptions,
  config: SupaschemaConfig,
  gitHeadExists: (cwd?: string) => Promise<boolean> = defaultGitHeadExists
): Promise<ResolvedGenerationSources> {
  const defaulted: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const {
    cwd = process.cwd(),
    migrationsDir = config.migrationsDir,
    mode = "generation",
  } = options;
  const to = options.to ?? defaultTreeSource(config);
  if (options.to === undefined) {
    defaulted.push(`--to ${redactSecrets(to)}`);
  }

  let from = options.from;
  if (from === undefined) {
    if (config.sources.from === sourceAuto) {
      from = await automaticGenerationBaseline(cwd, config, migrationsDir, gitHeadExists);
    } else {
      from = config.sources.from;
    }
    defaulted.push(`--from ${redactSecrets(from)}`);
  }

  diagnostics.push(...(await planningSourceDiagnostics(from, to, mode, migrationsDir, cwd)));
  const notice =
    defaulted.length > 0 ? `defaults: ${defaulted.join(" · ")} (flags override)\n` : undefined;
  return { diagnostics, from, notice, to };
}

async function automaticGenerationBaseline(
  cwd: string,
  config: SupaschemaConfig,
  migrationsDir: string,
  gitHeadExists: (cwd?: string) => Promise<boolean>
): Promise<string> {
  const stagedBaseline = await stagedGenerationBaseline(cwd, config, migrationsDir);
  if (stagedBaseline) {
    return stagedBaseline;
  }
  const migrationContext = await readMigrationContext(migrationsDir, { cwd });
  const hasMigrations = migrationContext.files.length > 0;
  const requiresReplay =
    hasMigrations &&
    (migrationContext.latestGeneratedBaseline === undefined ||
      migrationContext.unprovenBaselineFiles.length > 0);
  if (requiresReplay) {
    return `migrations:${migrationsDir}`;
  }
  if (await gitHeadExists(cwd)) {
    return "git:HEAD";
  }
  return hasMigrations ? `migrations:${migrationsDir}` : "empty:";
}

async function stagedGenerationBaseline(
  cwd: string,
  config: SupaschemaConfig,
  migrationsDir: string
): Promise<string | undefined> {
  const migrationContext = await readMigrationContext(migrationsDir, { cwd });
  const baseline = migrationContext.latestGeneratedBaseline;
  if (baseline === undefined || !(await isStagedWithoutWorktreeChanges(baseline.file, cwd))) {
    return;
  }
  try {
    const index = await extractSourceModel("git:INDEX", { config, cwd });
    return index.fingerprint === baseline.fingerprint ? "git:INDEX" : undefined;
  } catch {
    // If the index cannot be inspected, fall back to the configured source.
  }
}

async function isStagedWithoutWorktreeChanges(file: string, cwd: string): Promise<boolean> {
  try {
    const { stdout: rootOutput } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { maxBuffer: 1024 * 1024 }
    );
    const root = await realpath(rootOutput.trim());
    const path = relative(root, await realpath(resolve(cwd, file))).replaceAll("\\", "/");
    if (path === ".." || path.startsWith("../")) {
      return false;
    }
    const [staged, unstaged] = await Promise.all([
      execFileAsync("git", ["-C", root, "diff", "--cached", "--name-only", "--", path], {
        maxBuffer: 1024 * 1024,
      }),
      execFileAsync("git", ["-C", root, "diff", "--name-only", "--", path], {
        maxBuffer: 1024 * 1024,
      }),
    ]);
    return staged.stdout.trim() === path && unstaged.stdout.trim().length === 0;
  } catch {
    return false;
  }
}

export async function buildSchemaPlanningContext(
  options: SchemaPlanningContextOptions
): Promise<SchemaPlanningContext> {
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = options.migrationsDir ?? options.config.migrationsDir;
  const diagnostics = await planningSourceDiagnostics(
    options.from,
    options.to,
    options.mode ?? "generation",
    migrationsDir,
    cwd
  );
  if (diagnostics.some((item) => item.severity === "error")) {
    return { diagnostics, fromMs: 0, planStart: performance.now(), toMs: 0 };
  }

  const extractOptions = {
    config: options.config,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.excludeMigrationFiles === undefined
      ? {}
      : { excludeMigrationFiles: options.excludeMigrationFiles }),
  };
  const corpusOptions = options.cwd === undefined ? {} : { cwd: options.cwd };
  const extractStart = performance.now();
  const fullFrom = await extractSourceModel(options.from, extractOptions);
  const fromMs = performance.now() - extractStart;
  const fromErrors = fullFrom.diagnostics.filter((item) => item.severity === "error");
  if (
    fromErrors.length > 0 &&
    parseRuntimeSource(options.from)?.kind === RuntimeSourceKind.Migrations
  ) {
    diagnostics.push(
      ...fromErrors,
      diagnostic(
        "SUPA_MIGRATION_BASELINE_REPLAY_REQUIRED",
        "error",
        "the configured migration corpus could not be replayed into a proven baseline",
        {
          hint: "Resolve the first replay diagnostic in the named migration file, then rerun the same command. Do not patch generated types or select an unrelated fallback baseline.",
        }
      )
    );
    return { diagnostics, fromMs, planStart: performance.now(), toMs: 0 };
  }
  const migrationContext = await readMigrationContext(migrationsDir, {
    ...corpusOptions,
    ...(options.excludeMigrationFiles === undefined
      ? {}
      : { excludeFiles: options.excludeMigrationFiles }),
  });
  const toStart = performance.now();
  const fullTo = await extractSourceModel(options.to, extractOptions);
  if (options.checkMigrationBaseline !== false) {
    diagnostics.push(
      ...(await migrationBaselineDiagnostics(options.from, fullFrom, migrationContext, cwd))
    );
  }
  diagnostics.push(...(await uncommittedTreeDiagnostics(options.from, options.to, cwd)));
  const toMs = performance.now() - toStart;
  const { from, to } = scopePlanningModels(fullFrom, fullTo, options.schema);
  return {
    diagnostics,
    from,
    fromMs,
    migrationContext,
    migrationCorpus: migrationContext.corpus,
    planStart: performance.now(),
    to,
    toMs,
  };
}

async function planningSourceDiagnostics(
  from: string,
  to: string,
  mode: SchemaPlanningMode,
  migrationsDir: string,
  cwd: string
): Promise<Diagnostic[]> {
  const diagnostics = generationSourceDiagnostics(from, to, mode);
  if (mode === "generation") {
    diagnostics.push(...(await migrationGenerationSourceDiagnostics(from, migrationsDir, cwd)));
  }
  return diagnostics;
}

export function generationSourceDiagnostics(
  from: string,
  to: string,
  mode: SchemaPlanningMode = "generation"
): Diagnostic[] {
  return [
    ...generationSourceSideDiagnostics("from", from, mode),
    ...generationSourceSideDiagnostics("to", to, mode),
  ];
}

function generationSourceSideDiagnostics(
  side: "from" | "to",
  source: string,
  mode: SchemaPlanningMode
): Diagnostic[] {
  if (source === sourceAuto) {
    return [
      diagnostic(
        "SUPA_SOURCE_BASELINE_REQUIRED",
        "error",
        `generation ${side}-source still resolves to auto`,
        {
          hint: "Resolve the source explicitly to database:, git:, dir:, dump:, catalog:, or empty: before planning.",
        }
      ),
    ];
  }
  if (side === "to" && parseRuntimeSource(source)?.kind === RuntimeSourceKind.Migrations) {
    return [
      diagnostic(
        "SUPA_SOURCE_MIGRATIONS_TARGET_UNSUPPORTED",
        "error",
        "generation to-source uses migration replay",
        {
          hint: "Use the matching migrations: corpus only as the generation before-state; keep the target on database:, git:, dir:, dump:, catalog:, or empty:.",
        }
      ),
    ];
  }
  if (
    mode === "drift" &&
    side === "from" &&
    parseRuntimeSource(source)?.kind === RuntimeSourceKind.Migrations
  ) {
    return [
      diagnostic(
        "SUPA_SOURCE_MIGRATIONS_DRIFT_UNSUPPORTED",
        "error",
        "drift detection from-source uses migration replay",
        {
          hint: "Use migrations: only as a generation before-state. Compare drift from database:, catalog:, git:, dir:, dump:, or empty:.",
        }
      ),
    ];
  }
  return [];
}

async function migrationGenerationSourceDiagnostics(
  from: string,
  migrationsDir: string,
  cwd: string
): Promise<Diagnostic[]> {
  if (parseRuntimeSource(from)?.kind !== RuntimeSourceKind.Migrations) {
    return [];
  }
  if (await isMigrationDirectorySource(from, migrationsDir, cwd)) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_MIGRATION_BASELINE_UNSUPPORTED",
      "error",
      "generation from-source migration replay does not match the configured migrations directory",
      {
        hint: `Use migrations:${migrationsDir} for migration-corpus adoption, or select another source-backed baseline.`,
      }
    ),
  ];
}

async function migrationBaselineDiagnostics(
  fromSource: string,
  from: SchemaModel,
  migrationContext: MigrationContext,
  cwd: string
): Promise<Diagnostic[]> {
  if (migrationContext.files.length === 0) {
    return [];
  }
  if (await isMigrationDirectorySource(fromSource, migrationContext.directory, cwd)) {
    return [];
  }
  const baseline = migrationContext.latestGeneratedBaseline;
  const replayPath = relative(cwd, migrationContext.directory) || ".";
  const replaySource = `migrations:${replayPath}`;
  if (baseline === undefined) {
    return [
      diagnostic(
        "SUPA_MIGRATION_BASELINE_REPLAY_REQUIRED",
        "error",
        "the migration corpus has no generated lineage baseline, so the selected source cannot prove its current state",
        {
          file: migrationContext.unprovenBaselineFiles.at(-1) ?? migrationContext.files.at(-1),
          hint: `Replay the configured corpus with ${replaySource}; sources.from:auto selects this recovery lane automatically.`,
        }
      ),
    ];
  }
  if (migrationContext.unprovenBaselineFiles.length > 0) {
    return [
      diagnostic(
        "SUPA_MIGRATION_BASELINE_REPLAY_REQUIRED",
        "error",
        "hand-authored migrations appear after the newest generated lineage baseline, so lineage alone cannot prove the current state",
        {
          file: migrationContext.unprovenBaselineFiles.at(-1),
          hint: `Replay the configured corpus with ${replaySource}; sources.from:auto selects this recovery lane automatically. After the next generated migration, keep the lineage chain contiguous by making future schema changes in the declarative tree.`,
        }
      ),
    ];
  }
  if (baseline.fingerprint === from.fingerprint) {
    return [];
  }
  const formatDriftDiagnostic = migrationBaselineFormatDriftDiagnostic(
    baseline,
    from.formatVersion ?? MODEL_FORMAT_VERSION
  );
  if (formatDriftDiagnostic !== undefined) {
    return [formatDriftDiagnostic];
  }
  return [
    diagnostic(
      "SUPA_MIGRATION_BASELINE_MISMATCH",
      "error",
      "sources.from does not match the current generated migration-tree baseline",
      {
        file: baseline.file,
        hint: `${fromSource} is ${from.fingerprint.slice(0, 12)}..., but ${baseline.source} ends at ${baseline.fingerprint.slice(0, 12)}.... Use the source state that produced the migration baseline, or use diff --replace for generated migration replacement. If the pending generated migration's end-state was never committed and no target records it as applied, review and delete that pending migration, then regenerate from the current tree.`,
      }
    ),
  ];
}

async function isMigrationDirectorySource(
  source: string,
  migrationsDir: string,
  cwd: string
): Promise<boolean> {
  const parsed = parseRuntimeSource(source);
  if (parsed?.kind !== RuntimeSourceKind.Migrations) {
    return false;
  }
  const directory = resolve(cwd, parsed.payload);
  const configuredDirectory = resolve(cwd, migrationsDir);
  try {
    const [resolvedDirectory, resolvedConfiguredDirectory] = await Promise.all([
      realpath(directory),
      realpath(configuredDirectory),
    ]);
    return resolvedDirectory === resolvedConfiguredDirectory;
  } catch {
    return directory === configuredDirectory;
  }
}

function migrationBaselineFormatDriftDiagnostic(
  baseline: MigrationBaselineProof,
  currentModelFormatVersion: number
): Diagnostic | undefined {
  if (
    baseline.modelFormatVersion !== undefined &&
    baseline.modelFormatVersion === currentModelFormatVersion
  ) {
    return;
  }
  const baselineFormat = baseline.modelFormatVersion ?? "legacy";
  return diagnostic(
    "SUPA_MIGRATION_BASELINE_FORMAT_DRIFT",
    "warning",
    "generated migration-tree lineage was produced by a different model format; continuing so the next generated migration can re-establish comparable lineage",
    {
      file: baseline.file,
      hint: `${baseline.source} records model format ${baselineFormat}, while the current extractor uses model format ${currentModelFormatVersion}. Review the generated migration normally; same-format baseline mismatches still block.`,
    }
  );
}

async function uncommittedTreeDiagnostics(
  fromSource: string,
  toSource: string,
  cwd: string
): Promise<Diagnostic[]> {
  if (!(fromSource.startsWith("git:") && toSource.startsWith("dir:"))) {
    return [];
  }
  const treePath = toSource.slice("dir:".length);
  let status: string;
  try {
    const result = await execFileAsync(
      "git",
      ["-C", cwd, "status", "--porcelain", "--", treePath],
      { maxBuffer: 1024 * 1024 }
    );
    status = result.stdout;
  } catch {
    return [];
  }
  if (status.trim().length === 0) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_DIFF_TREE_UNCOMMITTED",
      "warning",
      `the to-source tree ${treePath} has uncommitted changes; this migration's lineage end-state fingerprints uncommitted schema-tree state`,
      {
        hint:
          fromSource === "git:INDEX"
            ? "The indexed schema closure is the proven before-state; run supaschema sync to generate, stage, and apply the next forward migration."
            : "Run supaschema sync to generate, stage, and apply one complete schema closure before the next schema edit.",
      }
    ),
  ];
}

function scopePlanningModels(
  fullFrom: SchemaModel,
  fullTo: SchemaModel,
  schemaFilter: string | undefined
): { from: SchemaModel; to: SchemaModel } {
  const schemas = parseSchemaFilter(schemaFilter);
  if (schemas.size === 0) {
    return { from: fullFrom, to: fullTo };
  }
  const scopedFrom = filterModelBySchemas(fullFrom, schemas);
  const scopedTo = filterModelBySchemas(fullTo, schemas);
  const intermediateObjects = [
    ...fullFrom.objects.filter((object) => !schemas.has(objectSchema(object))),
    ...fullTo.objects.filter((object) => schemas.has(objectSchema(object))),
  ];
  return {
    from: { ...scopedFrom, fingerprint: fullFrom.fingerprint },
    to: { ...scopedTo, fingerprint: fingerprintObjects(intermediateObjects) },
  };
}
