import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { parseRuntimeSource, RuntimeSourceKind, sourceAuto } from "../config/contract.js";
import type {
  Diagnostic,
  MigrationBaselineProof,
  MigrationContext,
  MigrationCorpus,
  SchemaModel,
  SupaschemaConfig,
} from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { fingerprintObjects, MODEL_FORMAT_VERSION } from "../hash.js";
import { readMigrationContext } from "../migrations/context.js";
import { migrationFiles } from "../migrations/files.js";
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

const execFileAsync = promisify(execFile);

export interface ResolvedGenerationSources extends ResolvedSources {
  diagnostics: Diagnostic[];
}

export interface ResolveGenerationSourceOptions {
  cwd?: string;
  from?: string;
  migrationsDir?: string;
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
  from: string;
  migrationContextExcludeFiles?: readonly string[];
  migrationsDir?: string;
  schema?: string;
  to: string;
}

export async function resolveGenerationSourceDefaults(
  options: ResolveGenerationSourceOptions,
  config: SupaschemaConfig,
  gitHeadExists: () => Promise<boolean> = defaultGitHeadExists
): Promise<ResolvedGenerationSources> {
  const defaulted: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = options.migrationsDir ?? config.migrationsDir;
  const to = options.to ?? config.sources.to ?? defaultTreeSource(config);
  if (options.to === undefined) {
    defaulted.push(`--to ${redactSecrets(to)}`);
  }

  let from = options.from;
  let fromDefaultBlocked = false;
  if (from === undefined) {
    if (config.sources.from === sourceAuto) {
      if (await gitHeadExists()) {
        from = "git:HEAD";
      } else if (await hasMigrationCorpus(cwd, migrationsDir)) {
        from = "empty:";
        fromDefaultBlocked = true;
        diagnostics.push(baselineRequiredDiagnostic(migrationsDir));
      } else {
        from = "empty:";
      }
    } else {
      from = config.sources.from;
    }
    if (!fromDefaultBlocked) {
      defaulted.push(`--from ${redactSecrets(from)}`);
    }
  }

  diagnostics.push(...generationSourceDiagnostics(from, to));
  const notice =
    defaulted.length > 0 ? `defaults: ${defaulted.join(" · ")} (flags override)\n` : undefined;
  return { diagnostics, from, notice, to };
}

export async function buildSchemaPlanningContext(
  options: SchemaPlanningContextOptions
): Promise<SchemaPlanningContext> {
  const diagnostics = generationSourceDiagnostics(options.from, options.to);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { diagnostics, fromMs: 0, planStart: performance.now(), toMs: 0 };
  }

  const extractOptions = {
    config: options.config,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
  const corpusOptions = options.cwd === undefined ? {} : { cwd: options.cwd };
  const extractStart = performance.now();
  const fullFrom = await extractSourceModel(options.from, extractOptions);
  const fromMs = performance.now() - extractStart;
  const migrationContext = await readMigrationContext(
    options.migrationsDir ?? options.config.migrationsDir,
    {
      ...corpusOptions,
      ...(options.migrationContextExcludeFiles === undefined
        ? {}
        : { excludeFiles: options.migrationContextExcludeFiles }),
    }
  );
  const toStart = performance.now();
  const fullTo = await extractSourceModel(options.to, extractOptions);
  if (options.checkMigrationBaseline !== false) {
    diagnostics.push(...migrationBaselineDiagnostics(options.from, fullFrom, migrationContext));
  }
  diagnostics.push(
    ...(await uncommittedTreeDiagnostics(options.from, options.to, options.cwd ?? process.cwd()))
  );
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

export function generationSourceDiagnostics(from: string, to: string): Diagnostic[] {
  return [
    ...generationSourceSideDiagnostics("from", from),
    ...generationSourceSideDiagnostics("to", to),
  ];
}

function generationSourceSideDiagnostics(side: "from" | "to", source: string): Diagnostic[] {
  if (source === sourceAuto) {
    return [
      diagnostic(
        "SUPA_SOURCE_BASELINE_REQUIRED",
        "error",
        `generation ${side}-source still resolves to auto`,
        {
          hint: "Resolve the source to git:<ref>, dir:<path>, dump:<file>, catalog:<file>, or empty: before planning.",
        }
      ),
    ];
  }
  const parsed = parseRuntimeSource(source);
  if (parsed?.kind !== RuntimeSourceKind.Database) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_SOURCE_LIVE_DATABASE_FOR_GENERATION",
      "error",
      `generation ${side}-source uses a live database catalog`,
      {
        hint: "Use git:<ref>, dir:<path>, dump:<file>, catalog:<file>, or empty: for migration generation. Use inspect, verify, selfcheck, audit, or target safety for explicit database-backed workflows.",
      }
    ),
  ];
}

async function hasMigrationCorpus(cwd: string, migrationsDir: string): Promise<boolean> {
  return (await migrationFiles(resolve(cwd, migrationsDir))).length > 0;
}

function baselineRequiredDiagnostic(migrationsDir: string): Diagnostic {
  return diagnostic(
    "SUPA_SOURCE_BASELINE_REQUIRED",
    "error",
    "sources.from: auto could not resolve a repository baseline for existing migrations",
    {
      hint: `Set sources.from to git:<ref>, dir:<path>, dump:<file>, catalog:<file>, or empty: after reviewing ${migrationsDir}.`,
    }
  );
}

function migrationBaselineDiagnostics(
  fromSource: string,
  from: SchemaModel,
  migrationContext: MigrationContext
): Diagnostic[] {
  if (!fromSource.startsWith("git:")) {
    return [];
  }
  if (migrationContext.files.length === 0) {
    return [];
  }
  const baseline = migrationContext.latestGeneratedBaseline;
  if (baseline === undefined || migrationContext.unprovenBaselineFiles.length > 0) {
    return [
      diagnostic(
        "SUPA_MIGRATION_BASELINE_UNSUPPORTED",
        "error",
        "existing migrations do not expose a generated lineage baseline for git source generation",
        {
          file: migrationContext.unprovenBaselineFiles.at(-1) ?? migrationContext.files.at(-1),
          hint: "Use a source-backed baseline that matches the current migration tree, or regenerate through diff --replace for a generated migration.",
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
        hint: "Commit the schema-tree change together with this generated migration and its generated outputs before further schema edits; otherwise the next git-baseline generation blocks with SUPA_MIGRATION_BASELINE_MISMATCH.",
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
