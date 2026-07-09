import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "../config/schema.js";
import type { Diagnostic, ObjectRef, SupaschemaConfig } from "../core.js";
import { diagnostic, hasErrors } from "../diagnostics.js";
import { defaultMigrationName } from "../migrations/files.js";
import {
  isConcurrentMigrationFile,
  type MigrationRunnerKind,
  type MigrationRunnerResult,
  runDirectMigrationRunner,
  runSupabaseCliMigrationRunner,
} from "../migrations/runners.js";
import {
  type MigrationsStatusReport,
  migrationsStatus,
  renderMigrationsStatus,
} from "../migrations/status.js";
import { runRlsSafetyGate } from "../pipeline/deploy-safety.js";
import { buildSchemaDiffPlan } from "../pipeline/diff.js";
import { runTypeSafetyGate } from "../pipeline/type-safety.js";
import {
  type ResolvedGenerationSources,
  resolveGenerationSourceDefaults,
} from "../planning/context.js";
import { renderMigrationSplit } from "../render/migration.js";
import { generateTypeContracts } from "../typegen/contracts.js";
import { checkPendingMigrations, loadSyncStatus, runnerFailureResult } from "./history.js";
import { migrationTimestamp, render, stripSqlExtension } from "./report.js";
import {
  operationName,
  operationTargetLabel,
  type ResolvedSyncTarget,
  resolveSyncTargets,
} from "./targets.js";
import { checkSyncLineageChain, verifyPendingMigrationsForSync } from "./verify.js";

const execFileAsync = promisify(execFile);

export interface SyncOptions {
  cliVersion?: string;
  config?: Partial<SupaschemaConfig>;
  databaseUrl?: string;
  directory: string;
  envName?: string;
  from?: string;
  historyTable?: string;
  operation?: "apply" | "sync";
  pipeline?: boolean;
  runner?: MigrationRunnerKind;
  skipDiff?: boolean;
  target?: string;
  to?: string;
}

export interface SyncResult {
  applied: boolean;
  diagnostics: Diagnostic[];
  pending: string[];
  report: string;
}

export async function syncMigrations(options: SyncOptions): Promise<SyncResult> {
  const state: SyncPipelineState = {
    artifacts: {
      closureStaged: false,
      contractsRefreshed: false,
      generatedMigrationPaths: [],
      writtenContractPaths: [],
    },
    config: resolveConfig(options.config),
    diagnostics: [],
    lines: [],
    options,
  };
  for (const lane of syncPipelineLanes) {
    const result = await lane(state);
    if (result !== undefined) {
      return result;
    }
  }
  throw new Error("sync pipeline completed without a result");
}

export interface SyncSources {
  from: string;
  to: string;
}

interface SyncPipelineState {
  artifacts: SyncArtifactState;
  config: SupaschemaConfig;
  diagnostics: Diagnostic[];
  lines: string[];
  options: SyncOptions;
  sources?: SyncSources;
  status?: MigrationsStatusReport;
}

interface SyncArtifactState {
  closureStaged: boolean;
  contractsRefreshed: boolean;
  generatedMigrationPaths: string[];
  writtenContractPaths: string[];
}

type SyncPipelineLane = (
  state: SyncPipelineState
) => Promise<SyncResult | undefined> | SyncResult | undefined;

const syncPipelineLanes: SyncPipelineLane[] = [
  guardSyncPolicyLane,
  resolveSyncSourcesLane,
  runSyncDiffLane,
  runConfiguredTargetsLane,
  loadFallbackHistoryLane,
  guardFallbackHistoryLane,
  checkFallbackPendingMigrationsLane,
  refreshFallbackGeneratedContractsLane,
  stageFallbackSyncClosureLane,
  runFallbackSafetyGatesLane,
  stopFallbackWhenNothingPendingLane,
  reportFallbackDryRunOrUnknownTargetLane,
];

function guardSyncPolicyLane(state: SyncPipelineState): SyncResult | undefined {
  return disabledSyncResult(state.options, state.config, state.diagnostics);
}

async function resolveSyncSourcesLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true) {
    return;
  }
  const sources = await resolveSyncSources(state.options, state.config);
  state.diagnostics.push(...sources.diagnostics);
  if (hasErrors(sources.diagnostics)) {
    state.lines.push(
      `refusing to ${operationName(state.options)}: generation source resolution failed`
    );
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: [],
      report: render(state.lines),
    };
  }
  state.sources = { from: sources.from, to: sources.to };
  return;
}

function runSyncDiffLane(state: SyncPipelineState): Promise<SyncResult | undefined> | undefined {
  if (state.options.pipeline !== true || state.options.skipDiff === true) {
    return;
  }
  return runSyncDiffStage(
    state.options,
    state.config,
    requiredSyncSources(state),
    state.diagnostics,
    state.lines,
    state.artifacts
  );
}

function runConfiguredTargetsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> | undefined {
  if (state.options.pipeline !== true || state.sources === undefined) {
    return;
  }
  return runConfiguredTargets(
    state.options,
    state.config,
    state.diagnostics,
    state.lines,
    requiredSyncSources(state),
    state.artifacts
  );
}

async function loadFallbackHistoryLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  const selectedRunner = state.options.runner ?? "supabase-cli";
  const status = await loadSyncStatus(state.options, selectedRunner);
  state.status = status.report;
  state.diagnostics.push(...status.diagnostics);
  state.lines.push(renderMigrationsStatus(status.report).trimEnd());
  return;
}

function guardFallbackHistoryLane(state: SyncPipelineState): SyncResult | undefined {
  if (!hasErrors(state.diagnostics)) {
    return;
  }
  state.lines.push("refusing to sync: resolve ghost or out-of-order history first");
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: requiredSyncStatus(state).pending,
    report: render(state.lines),
  };
}

function checkFallbackPendingMigrationsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> | undefined {
  const pending = pendingMigrationsForFallbackCheck(state);
  if (pending.length === 0) {
    return;
  }
  return checkPendingMigrations(
    state.options.directory,
    pending,
    state.config,
    state.diagnostics,
    state.lines,
    operationName(state.options)
  );
}

function pendingMigrationsForFallbackCheck(state: SyncPipelineState): string[] {
  const status = requiredSyncStatus(state);
  if (status.target !== undefined) {
    return status.pending;
  }
  return status.pendingLineage.map((item) => item.file);
}

function refreshFallbackGeneratedContractsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> {
  return refreshGeneratedContractsForSync(state);
}

function stageFallbackSyncClosureLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  return stageSyncClosureForSync(state);
}

function runFallbackSafetyGatesLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> | undefined {
  if (state.sources === undefined) {
    return;
  }
  return runSyncSafetyGates(state.config, state.sources, state.diagnostics, state.lines, {
    pending: requiredSyncStatus(state).pending,
  });
}

function stopFallbackWhenNothingPendingLane(state: SyncPipelineState): SyncResult | undefined {
  if (requiredSyncStatus(state).pending.length > 0) {
    return;
  }
  state.lines.push(`nothing to ${operationName(state.options)}: disk and target history match`);
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: [],
    report: render(state.lines),
  };
}

function reportFallbackDryRunOrUnknownTargetLane(state: SyncPipelineState): SyncResult {
  const status = requiredSyncStatus(state);
  if (state.options.target === undefined) {
    state.lines.push(
      `dry run: no ${operationTargetLabel(state.options)} was selected by config; set sync.targets.<name>.mode to "auto", or pass --target <name> as an override to apply ${status.pending.length} pending migration(s) with the configured runner`
    );
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: status.pending,
      report: render(state.lines),
    };
  }
  state.diagnostics.push(
    diagnostic(
      "SUPA_SYNC_TARGET_UNKNOWN",
      "error",
      `${operationTargetLabel(state.options)} "${state.options.target}" is not configured`,
      { hint: "Add sync.targets.<name> to supaschema.config.json." }
    )
  );
  state.lines.push(`refusing to ${operationName(state.options)}: target resolution failed`);
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: status.pending,
    report: render(state.lines),
  };
}

function requiredSyncSources(state: SyncPipelineState): SyncSources {
  if (state.sources === undefined) {
    throw new Error("sync source lane has not run");
  }
  return state.sources;
}

function requiredSyncStatus(state: SyncPipelineState): MigrationsStatusReport {
  if (state.status === undefined) {
    throw new Error("sync history lane has not run");
  }
  return state.status;
}

function disabledSyncResult(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[]
): SyncResult | undefined {
  if (config.workflow.migration_sync !== "disabled") {
    return;
  }
  if (operationName(options) === "sync" && options.target === undefined) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_DISABLED",
      "error",
      `workflow.migration_sync is "disabled"; change it to an apply-enabled policy before ${operationName(options)} can apply migrations.`,
      {
        hint: 'Use workflow.migration_sync: "auto" and set sync.targets.<name>.mode to "auto" for the standard configured apply path.',
      }
    )
  );
  return {
    applied: false,
    diagnostics,
    pending: [],
    report: `refusing to ${operationName(options)}: workflow.migration_sync is "disabled"; no apply handoff was attempted\n`,
  };
}

function resolveSyncSources(
  options: SyncOptions,
  config: SupaschemaConfig
): Promise<ResolvedGenerationSources> {
  return resolveGenerationSourceDefaults({ ...options, migrationsDir: options.directory }, config);
}

async function runSyncDiffStage(
  options: SyncOptions,
  config: SupaschemaConfig,
  sources: SyncSources,
  diagnostics: Diagnostic[],
  lines: string[],
  artifacts: SyncArtifactState
): Promise<SyncResult | undefined> {
  const plan = await buildSchemaDiffPlan({
    config,
    from: sources.from,
    migrationsDir: options.directory,
    to: sources.to,
  });
  diagnostics.push(...plan.diagnostics);
  if (hasErrors(plan.diagnostics)) {
    lines.push(`refusing to ${operationName(options)}: schema diff has blocking diagnostics`);
    return { applied: false, diagnostics, pending: [], report: render(lines) };
  }
  if (plan.operations.length === 0) {
    lines.push("diff: no schema changes");
    return;
  }
  const chainDiagnostics = await checkSyncLineageChain(
    plan.fromFingerprint,
    plan.toFingerprint,
    options.directory
  );
  diagnostics.push(...chainDiagnostics);
  if (hasErrors(chainDiagnostics)) {
    lines.push(
      `refusing to ${operationName(options)}: pending supaschema migration lineage is not contiguous`
    );
    return { applied: false, diagnostics, pending: [], report: render(lines) };
  }
  const outPath = resolve(
    process.cwd(),
    options.directory,
    `${migrationTimestamp()}_${defaultMigrationName(plan)}.sql`
  );
  const rendered = renderMigrationSplit(plan, {
    config,
    version: options.cliVersion ?? "library",
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, rendered.sql, { flag: "wx" });
  artifacts.generatedMigrationPaths.push(outPath);
  lines.push(`diff: wrote ${outPath}`);
  if (rendered.concurrentSql !== undefined) {
    const concurrentPath = `${stripSqlExtension(outPath)}.concurrent.sql`;
    await writeFile(concurrentPath, rendered.concurrentSql, { flag: "wx" });
    artifacts.generatedMigrationPaths.push(concurrentPath);
    lines.push(`diff: wrote ${concurrentPath}`);
  }
  return;
}

async function refreshGeneratedContractsForSync(
  state: Pick<
    SyncPipelineState,
    "artifacts" | "config" | "diagnostics" | "lines" | "options" | "sources"
  >
): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true || operationName(state.options) !== "sync") {
    return;
  }
  if (state.artifacts.contractsRefreshed) {
    return;
  }
  const result = await generateTypeContracts({
    config: state.config,
    honorWorkflowPolicy: true,
    ...(state.sources === undefined ? {} : { source: state.sources.to }),
  });
  state.diagnostics.push(...result.diagnostics);
  if (hasErrors(result.diagnostics)) {
    state.lines.push("refusing to sync: generated contract refresh failed");
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: [],
      report: render(state.lines),
    };
  }
  for (const path of result.written) {
    state.lines.push(`types: wrote ${path}`);
  }
  state.artifacts.writtenContractPaths.push(...result.written);
  for (const line of result.skipped) {
    state.lines.push(line);
  }
  state.artifacts.contractsRefreshed = true;
  return;
}

async function stageSyncClosureForSync(
  state: Pick<SyncPipelineState, "artifacts" | "config" | "lines" | "options" | "sources">
): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true || operationName(state.options) !== "sync") {
    return;
  }
  if (state.artifacts.closureStaged) {
    return;
  }
  const result = await stageSyncClosure({
    artifacts: state.artifacts,
    config: state.config,
    ...(state.sources === undefined ? {} : { sources: state.sources }),
  });
  if (result.skippedReason !== undefined) {
    state.lines.push(`stage: skipped (${result.skippedReason})`);
  } else if (result.staged.length === 0) {
    state.lines.push("stage: no schema closure files to stage");
  } else {
    for (const file of result.staged) {
      state.lines.push(`stage: staged ${file}`);
    }
  }
  state.artifacts.closureStaged = true;
  return;
}

interface StageSyncClosureOptions {
  artifacts: SyncArtifactState;
  config: SupaschemaConfig;
  sources?: SyncSources;
}

interface StageSyncClosureResult {
  skippedReason?: string;
  staged: string[];
}

async function stageSyncClosure(options: StageSyncClosureOptions): Promise<StageSyncClosureResult> {
  let root: string;
  let schemaRoots: string[];
  let artifactPaths: string[];
  let changed: string[];
  try {
    root = await gitRoot();
    schemaRoots = await syncSchemaRootGitPaths(root, options.config, options.sources);
    artifactPaths = await syncArtifactGitPaths(root, options.artifacts);
    const pathSpecs = uniqueStrings([...schemaRoots, ...artifactPaths]);
    if (pathSpecs.length === 0) {
      throw new Error("no sync closure paths are inside the git worktree");
    }
    changed = await changedGitPaths(root, pathSpecs);
  } catch {
    return { skippedReason: "not a git worktree", staged: [] };
  }
  const artifacts = new Set(artifactPaths);
  const roots = new Set(schemaRoots);
  const staged = changed.filter((path) => isSyncClosurePath(path, artifacts, roots));
  if (staged.length === 0) {
    return { staged: [] };
  }
  await execFileAsync("git", ["add", "--", ...staged], { cwd: root });
  return { staged };
}

async function gitRoot(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return await realpath(stdout.trim());
}

async function changedGitPaths(root: string, pathSpecs: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", ...pathSpecs],
    { cwd: root, encoding: "utf8" }
  );
  return parsePorcelainStatusPaths(stdout);
}

function parsePorcelainStatusPaths(output: string): string[] {
  const entries = output.split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    index += 1;
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const file = normalizeGitPath(entry.slice(3));
    if (file.length > 0 && !paths.includes(file)) {
      paths.push(file);
    }
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
  }
  return paths;
}

async function syncSchemaRootGitPaths(
  root: string,
  config: SupaschemaConfig,
  sources: SyncSources | undefined
): Promise<string[]> {
  const roots = [...config.schemaPaths];
  const toDir = dirSourcePath(sources?.to);
  if (toDir !== undefined) {
    roots.push(toDir);
  }
  return await gitPathsForExistingPaths(root, roots);
}

function dirSourcePath(source: string | undefined): string | undefined {
  if (source === undefined || !source.startsWith("dir:")) {
    return;
  }
  const path = source.slice("dir:".length);
  return path.length === 0 ? undefined : path;
}

async function syncArtifactGitPaths(root: string, artifacts: SyncArtifactState): Promise<string[]> {
  return await gitPathsForExistingPaths(root, [
    ...artifacts.generatedMigrationPaths,
    ...artifacts.writtenContractPaths,
  ]);
}

async function gitPathsForExistingPaths(root: string, paths: string[]): Promise<string[]> {
  const gitPaths = await Promise.all(paths.map((path) => gitPathForExistingPath(root, path)));
  return uniqueStrings(gitPaths.filter((path): path is string => path !== undefined));
}

async function gitPathForExistingPath(root: string, path: string): Promise<string | undefined> {
  const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const resolvedPath = await realpath(absolutePath).catch(() => undefined);
  if (resolvedPath === undefined) {
    return;
  }
  const gitPath = normalizeGitPath(relative(root, resolvedPath) || ".");
  if (gitPath === ".." || gitPath.startsWith("../") || isAbsolute(gitPath)) {
    return;
  }
  return gitPath;
}

function isSyncClosurePath(
  path: string,
  artifacts: ReadonlySet<string>,
  schemaRoots: ReadonlySet<string>
): boolean {
  if (artifacts.has(path)) {
    return true;
  }
  if (!path.endsWith(".sql")) {
    return false;
  }
  return [...schemaRoots].some((root) => pathIsWithin(path, root));
}

function pathIsWithin(path: string, root: string): boolean {
  return root === "." || path === root || path.startsWith(`${root}/`);
}

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function runSyncSafetyGates(
  config: SupaschemaConfig,
  sources: SyncSources,
  diagnostics: Diagnostic[],
  lines: string[],
  options: { pending: string[]; sourceOverride?: string; targetName?: string }
): Promise<SyncResult | undefined> {
  const typeGate = await runTypeSafetyGate({
    config,
    fromSource: options.sourceOverride ?? sources.from,
    toSource: sources.to,
  });
  const rlsGate = await runRlsSafetyGate({
    config,
    source: sources.to,
  });
  diagnostics.push(...typeGate.diagnostics, ...rlsGate.diagnostics);
  if (typeGate.blocked || rlsGate.blocked) {
    lines.push(
      options.targetName === undefined
        ? "refusing to sync: deploy safety gates failed"
        : `refusing to sync ${options.targetName}: deploy safety gates failed`
    );
    return { applied: false, diagnostics, pending: options.pending, report: render(lines) };
  }
  if (typeGate.diagnostics.length > 0 || rlsGate.diagnostics.length > 0) {
    lines.push("safety: diagnostics reported without blocking");
  }
  return;
}

function targetSafetySource(target: ResolvedSyncTarget, fallbackSource: string): string {
  return target.databaseUrl === undefined ? fallbackSource : `database:${target.databaseUrl}`;
}

async function runConfiguredTargets(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  prefixLines: string[],
  sources: SyncSources,
  artifacts: SyncArtifactState
): Promise<SyncResult | undefined> {
  const resolved = resolveSyncTargets(options, config);
  diagnostics.push(...resolved.diagnostics);
  if (hasErrors(resolved.diagnostics)) {
    const lines = [
      ...prefixLines,
      `refusing to ${operationName(options)}: target resolution failed`,
    ];
    return {
      applied: false,
      diagnostics,
      pending: [],
      report: render(lines),
    };
  }
  if (resolved.targets.length === 0) {
    return;
  }
  const lines: string[] = [...prefixLines];
  const target = resolved.targets[0];
  if (target === undefined) {
    return;
  }
  return await runOneTarget(options, config, target, sources, artifacts, diagnostics, lines);
}

async function runOneTarget(
  options: SyncOptions,
  config: SupaschemaConfig,
  target: ResolvedSyncTarget,
  sources: SyncSources,
  artifacts: SyncArtifactState,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult> {
  const state: TargetSyncState = {
    artifacts,
    config,
    diagnostics,
    lines,
    options,
    sources,
    target,
  };
  for (const lane of targetSyncLanes) {
    const result = await lane(state);
    if (result !== undefined) {
      return result;
    }
  }
  return { applied: true, diagnostics, pending: [], report: render(lines) };
}

interface TargetSyncState {
  artifacts: SyncArtifactState;
  config: SupaschemaConfig;
  diagnostics: Diagnostic[];
  lines: string[];
  options: SyncOptions;
  outcome?: MigrationRunnerResult;
  sources: SyncSources;
  status?: MigrationsStatusReport;
  target: ResolvedSyncTarget;
}

type TargetSyncLane = (
  state: TargetSyncState
) => Promise<SyncResult | undefined> | SyncResult | undefined;

const targetSyncLanes: TargetSyncLane[] = [
  loadTargetHistoryLane,
  guardTargetHistoryLane,
  checkTargetPendingMigrationsLane,
  refreshTargetGeneratedContractsLane,
  stageTargetSyncClosureLane,
  stopTargetWhenNothingPendingLane,
  guardTargetConcurrentCompanionsLane,
  runTargetSafetyLane,
  verifyTargetPendingMigrationsLane,
  applyTargetMigrationsLane,
  reconcileTargetHistoryLane,
];

async function loadTargetHistoryLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  const status = await migrationsStatus({
    allowMissingHistoryTable: state.target.runner === "direct",
    directory: state.options.directory,
    ...(state.target.databaseUrl === undefined ? {} : { databaseUrl: state.target.databaseUrl }),
    historyTable: state.target.historyTable,
    runnerLabel: state.target.runner,
    targetLabel: state.target.name,
  });
  state.status = status.report;
  state.diagnostics.push(...status.diagnostics);
  state.lines.push(renderMigrationsStatus(status.report).trimEnd());
  return;
}

function guardTargetHistoryLane(state: TargetSyncState): SyncResult | undefined {
  if (!hasErrors(state.diagnostics)) {
    return;
  }
  state.lines.push(
    `refusing to ${operationName(state.options)} ${state.target.name}: resolve ghost or out-of-order history first`
  );
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: requiredTargetStatus(state).pending,
    report: render(state.lines),
  };
}

function stopTargetWhenNothingPendingLane(state: TargetSyncState): SyncResult | undefined {
  if (requiredTargetStatus(state).pending.length > 0) {
    return;
  }
  state.lines.push(
    `nothing to ${operationName(state.options)} on ${state.target.name}: disk and target history match`
  );
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: [],
    report: render(state.lines),
  };
}

function checkTargetPendingMigrationsLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  const pending = pendingMigrationsForTargetSupaschemaGate(state);
  if (pending.length === 0) {
    return Promise.resolve(undefined);
  }
  return checkPendingMigrations(
    state.options.directory,
    pending,
    state.config,
    state.diagnostics,
    state.lines,
    operationName(state.options)
  );
}

function refreshTargetGeneratedContractsLane(
  state: TargetSyncState
): Promise<SyncResult | undefined> {
  return refreshGeneratedContractsForSync(state);
}

function stageTargetSyncClosureLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  return stageSyncClosureForSync(state);
}

function guardTargetConcurrentCompanionsLane(state: TargetSyncState): SyncResult | undefined {
  return supabaseCliConcurrentCompanionResult(
    state.target,
    pendingMigrationsForTargetSupaschemaGate(state),
    state.diagnostics,
    state.lines,
    operationName(state.options)
  );
}

function runTargetSafetyLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  return runSyncSafetyGates(state.config, state.sources, state.diagnostics, state.lines, {
    pending: pendingMigrationsForTargetSupaschemaGate(state),
    sourceOverride: targetSafetySource(state.target, state.sources.from),
    targetName: state.target.name,
  });
}

function verifyTargetPendingMigrationsLane(
  state: TargetSyncState
): Promise<SyncResult | undefined> {
  const historyTable = targetHistoryTableRef(state.target);
  return verifyPendingMigrationsForSync({
    config: state.config,
    diagnostics: state.diagnostics,
    directory: state.options.directory,
    ...(historyTable === undefined ? {} : { ignoredObjects: [historyTable] }),
    lines: state.lines,
    options: state.options,
    pending: pendingMigrationsForTargetRunner(state),
    sources: {
      from: targetSafetySource(state.target, state.sources.from),
      to: state.sources.to,
    },
    target: state.target,
  });
}

function targetHistoryTableRef(target: ResolvedSyncTarget): ObjectRef | undefined {
  const [schema, name, extra] = target.historyTable.split(".");
  if (!(schema && name) || extra !== undefined) {
    return;
  }
  return { kind: "table", name, schema };
}

async function applyTargetMigrationsLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  const pending = pendingMigrationsForTargetRunner(state);
  state.outcome = await runTargetRunner(state.options, state.config, state.target, pending);
  state.lines.push(`running: ${state.outcome.displayCommand ?? state.target.runner}`);
  return runnerFailureResult(
    state.outcome,
    state.target.runner,
    pending,
    state.diagnostics,
    state.lines
  );
}

async function reconcileTargetHistoryLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  const status = requiredTargetStatus(state);
  if (state.target.runner === "supabase-cli" && state.target.databaseUrl === undefined) {
    state.lines.push(
      `final reconcile: skipped for ${state.target.name} because the Supabase CLI target resolves credentials at runtime`
    );
    return;
  }
  const finalStatus = await migrationsStatus({
    allowMissingHistoryTable: state.target.runner === "direct",
    directory: state.options.directory,
    ...(state.target.databaseUrl === undefined ? {} : { databaseUrl: state.target.databaseUrl }),
    expectedAppliedVersions: status.expectedAppliedVersions,
    historyTable: state.target.historyTable,
    runnerLabel: state.target.runner,
    targetLabel: state.target.name,
  });
  state.diagnostics.push(...finalStatus.diagnostics);
  if (
    hasErrors(finalStatus.diagnostics) ||
    finalStatus.report.pending.length > 0 ||
    finalStatus.report.missingExpectedVersions.length > 0
  ) {
    state.diagnostics.push(
      diagnostic(
        "SUPA_SYNC_FINAL_RECONCILE_FAILED",
        "error",
        `target ${state.target.name} did not reconcile after runner completed`,
        { hint: "Inspect pending and missing expected migration versions in the sync report." }
      )
    );
    state.lines.push(renderMigrationsStatus(finalStatus.report).trimEnd());
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: finalStatus.report.pending,
      report: render(state.lines),
    };
  }
  state.lines.push(renderMigrationsStatus(finalStatus.report).trimEnd());
  return;
}

function requiredTargetStatus(state: TargetSyncState): MigrationsStatusReport {
  if (state.status === undefined) {
    throw new Error("target history lane has not run");
  }
  return state.status;
}

function pendingMigrationsForTargetSupaschemaGate(state: TargetSyncState): string[] {
  const status = requiredTargetStatus(state);
  if (isRuntimeResolvedSupabaseCliTarget(state.target)) {
    return status.pendingLineage.map((item) => item.file);
  }
  return status.pending;
}

function pendingMigrationsForTargetRunner(state: TargetSyncState): string[] {
  if (isRuntimeResolvedSupabaseCliTarget(state.target)) {
    return pendingMigrationsForTargetSupaschemaGate(state);
  }
  return requiredTargetStatus(state).pending;
}

function isRuntimeResolvedSupabaseCliTarget(target: ResolvedSyncTarget): boolean {
  return target.runner === "supabase-cli" && target.databaseUrl === undefined;
}

function supabaseCliConcurrentCompanionResult(
  target: ResolvedSyncTarget,
  pending: string[],
  diagnostics: Diagnostic[],
  lines: string[],
  operation: "apply" | "sync"
): SyncResult | undefined {
  const companion = pending.find(isConcurrentMigrationFile);
  if (target.runner !== "supabase-cli" || companion === undefined) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_SUPABASE_CLI_CONCURRENT_COMPANION",
      "error",
      `sync target ${target.name} uses the Supabase CLI runner, which cannot safely apply concurrent companion migration ${companion} because Supabase migration history keys versions by timestamp`,
      {
        file: companion,
        hint: "Use the direct runner for this target, or apply the concurrent companion through an explicit out-of-transaction operational lane.",
      }
    )
  );
  lines.push(
    `refusing to ${operation} ${target.name}: Supabase CLI cannot safely apply ${companion}`
  );
  return { applied: false, diagnostics, pending, report: render(lines) };
}

function runTargetRunner(
  options: SyncOptions,
  config: SupaschemaConfig,
  target: ResolvedSyncTarget,
  pending: string[]
): Promise<MigrationRunnerResult> {
  if (target.runner === "supabase-cli") {
    return runSupabaseCliMigrationRunner({
      ...(target.databaseUrl === undefined ? {} : { databaseUrl: target.databaseUrl }),
      operation: target.operation,
    });
  }
  if (target.databaseUrl === undefined) {
    return Promise.resolve({
      kind: "unavailable",
      message: "direct PostgreSQL runner requires a database URL",
      ok: false,
      runner: "direct",
    });
  }
  return runDirectMigrationRunner({
    databaseUrl: target.databaseUrl,
    directory: options.directory,
    historyTable: target.historyTable,
    pending,
    transactionMode: config.transactionMode,
  });
}
