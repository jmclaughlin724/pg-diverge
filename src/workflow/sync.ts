import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "../config/schema.js";
import type { Diagnostic, ObjectRef, SupaschemaConfig } from "../core.js";
import { diagnostic, hasErrors } from "../diagnostics.js";
import { defaultMigrationName, nextMigrationFile } from "../migrations/files.js";
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
import { render, stripSqlExtension } from "./report.js";
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
  configPath?: string;
  databaseUrl?: string;
  directory: string;
  ensureEnvironment?: boolean;
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
      if (isSyncResult(result)) {
        return result;
      }
      throw new Error("sync pipeline lane returned an invalid result");
    }
  }
  return {
    applied: state.target !== undefined,
    diagnostics: state.diagnostics,
    pending: [],
    report: render(state.lines),
  };
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
  outcome?: MigrationRunnerResult;
  sources?: SyncSources;
  status?: MigrationsStatusReport;
  target?: ResolvedSyncTarget;
}

interface SyncArtifactState {
  closureStaged: boolean;
  contractsRefreshed: boolean;
  generatedMigrationPaths: string[];
  writtenContractPaths: string[];
}

type SyncPipelineLane = (state: SyncPipelineState) => Promise<unknown> | unknown;

const syncPipelineLanes: SyncPipelineLane[] = [
  guardSyncPolicyLane,
  resolveSyncTargetLane,
  loadSyncHistoryLane,
  guardSyncHistoryLane,
  resolveSyncSourcesLane,
  runSyncDiffLane,
  reloadSyncHistoryLane,
  guardSyncHistoryLane,
  renderSyncHistoryLane,
  checkSyncPendingMigrationsLane,
  refreshSyncGeneratedContractsLane,
  stageSyncClosureLane,
  stopSyncWhenNothingPendingLane,
  guardSyncConcurrentCompanionsLane,
  runSyncSafetyLane,
  reportSyncDryRunLane,
  verifySyncPendingMigrationsLane,
  applySyncMigrationsLane,
  reconcileSyncHistoryLane,
];

function isSyncResult(value: unknown): value is SyncResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    typeof Reflect.get(value, "applied") === "boolean" &&
    Array.isArray(Reflect.get(value, "diagnostics")) &&
    Array.isArray(Reflect.get(value, "pending")) &&
    typeof Reflect.get(value, "report") === "string"
  );
}

function guardSyncPolicyLane(state: SyncPipelineState): SyncResult | undefined {
  return disabledSyncResult(state.options, state.config, state.diagnostics);
}

function resolveSyncTargetLane(state: SyncPipelineState): SyncResult | undefined {
  if (state.options.pipeline !== true) {
    return;
  }
  const resolved = resolveSyncTargets(state.options, state.config);
  state.diagnostics.push(...resolved.diagnostics);
  if (hasErrors(resolved.diagnostics)) {
    state.lines.push(`refusing to ${operationName(state.options)}: target resolution failed`);
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: [],
      report: render(state.lines),
    };
  }
  const target = resolved.targets[0];
  if (target !== undefined) {
    state.target = target;
  }
}

async function loadSyncHistoryLane(state: SyncPipelineState): Promise<void> {
  await loadSyncHistory(state);
}

async function reloadSyncHistoryLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  if (state.artifacts.generatedMigrationPaths.length === 0) {
    return;
  }
  await loadSyncHistory(state);
}

async function loadSyncHistory(state: SyncPipelineState): Promise<void> {
  const target = state.target;
  const status =
    target === undefined
      ? await loadSyncStatus(state.options, state.options.runner ?? "supabase-cli")
      : await migrationsStatus({
          allowMissingHistoryTable: target.runner === "direct",
          directory: state.options.directory,
          ...(target.databaseUrl === undefined ? {} : { databaseUrl: target.databaseUrl }),
          historyTable: target.historyTable,
          runnerLabel: target.runner,
          targetLabel: target.name,
        });
  state.status = status.report;
  for (const item of status.diagnostics) {
    if (
      !state.diagnostics.some(
        (existing) =>
          existing.code === item.code &&
          existing.file === item.file &&
          existing.message === item.message
      )
    ) {
      state.diagnostics.push(item);
    }
  }
}

function guardSyncHistoryLane(state: SyncPipelineState): SyncResult | undefined {
  if (!hasErrors(state.diagnostics)) {
    return;
  }
  const target = state.target;
  state.lines.push(
    target === undefined
      ? `refusing to ${operationName(state.options)}: resolve ghost or out-of-order history first`
      : `refusing to ${operationName(state.options)} ${target.name}: resolve ghost or out-of-order history first`
  );
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: requiredSyncStatus(state).pending,
    report: render(state.lines),
  };
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

function renderSyncHistoryLane(state: SyncPipelineState): void {
  const status = requiredSyncStatus(state);
  state.lines.push(renderMigrationsStatus(status).trimEnd());
}

function checkSyncPendingMigrationsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> | undefined {
  const pending = pendingMigrationsForSupaschemaGate(state);
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

function pendingMigrationsForSupaschemaGate(state: SyncPipelineState): string[] {
  const status = requiredSyncStatus(state);
  if (state.target !== undefined && isRuntimeResolvedSupabaseCliTarget(state.target)) {
    return status.pendingLineage.map((item) => item.file);
  }
  return status.target === undefined
    ? status.pendingLineage.map((item) => item.file)
    : status.pending;
}

function pendingMigrationsForRunner(state: SyncPipelineState): string[] {
  return state.target !== undefined && isRuntimeResolvedSupabaseCliTarget(state.target)
    ? pendingMigrationsForSupaschemaGate(state)
    : requiredSyncStatus(state).pending;
}

function refreshSyncGeneratedContractsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> {
  return refreshGeneratedContractsForSync(state);
}

function stageSyncClosureLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  return stageSyncClosureForSync(state);
}

function stopSyncWhenNothingPendingLane(state: SyncPipelineState): SyncResult | undefined {
  if (requiredSyncStatus(state).pending.length > 0) {
    return;
  }
  const target = state.target;
  state.lines.push(
    target === undefined
      ? `nothing to ${operationName(state.options)}: disk and target history match`
      : `nothing to ${operationName(state.options)} on ${target.name}: disk and target history match`
  );
  return {
    applied: false,
    diagnostics: state.diagnostics,
    pending: [],
    report: render(state.lines),
  };
}

function guardSyncConcurrentCompanionsLane(state: SyncPipelineState): SyncResult | undefined {
  return state.target === undefined
    ? undefined
    : supabaseCliConcurrentCompanionResult(
        state.target,
        pendingMigrationsForSupaschemaGate(state),
        state.diagnostics,
        state.lines,
        operationName(state.options)
      );
}

function runSyncSafetyLane(state: SyncPipelineState): Promise<SyncResult | undefined> | undefined {
  if (state.sources === undefined) {
    return;
  }
  const target = state.target;
  return runSyncSafetyGates(state.config, state.sources, state.diagnostics, state.lines, {
    pending: requiredSyncStatus(state).pending,
    ...(target === undefined
      ? {}
      : {
          sourceOverride: targetSafetySource(target, state.sources.from),
          targetName: target.name,
        }),
  });
}

function reportSyncDryRunLane(state: SyncPipelineState): SyncResult | undefined {
  if (state.target !== undefined) {
    return;
  }
  const status = requiredSyncStatus(state);
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

function verifySyncPendingMigrationsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> | undefined {
  const target = state.target;
  if (target === undefined) {
    return;
  }
  const historyTable = targetHistoryTableRef(target);
  return verifyPendingMigrationsForSync({
    config: state.config,
    diagnostics: state.diagnostics,
    directory: state.options.directory,
    ...(historyTable === undefined ? {} : { ignoredObjects: [historyTable] }),
    lines: state.lines,
    options: state.options,
    pending: pendingMigrationsForRunner(state),
    sources: {
      from: targetSafetySource(target, requiredSyncSources(state).from),
      to: requiredSyncSources(state).to,
    },
    target,
  });
}

async function applySyncMigrationsLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  const target = state.target;
  if (target === undefined) {
    return;
  }
  const pending = pendingMigrationsForRunner(state);
  state.outcome = await runTargetRunner(state.options, state.config, target, pending);
  state.lines.push(`running: ${state.outcome.displayCommand ?? target.runner}`);
  return runnerFailureResult(state.outcome, target.runner, pending, state.diagnostics, state.lines);
}

async function reconcileSyncHistoryLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  const target = state.target;
  if (target === undefined) {
    return;
  }
  const status = requiredSyncStatus(state);
  if (target.runner === "supabase-cli" && target.databaseUrl === undefined) {
    state.lines.push(
      `final reconcile: skipped for ${target.name} because the Supabase CLI target resolves credentials at runtime`
    );
    return;
  }
  const finalStatus = await migrationsStatus({
    allowMissingHistoryTable: target.runner === "direct",
    directory: state.options.directory,
    ...(target.databaseUrl === undefined ? {} : { databaseUrl: target.databaseUrl }),
    expectedAppliedVersions: status.expectedAppliedVersions,
    historyTable: target.historyTable,
    runnerLabel: target.runner,
    targetLabel: target.name,
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
        `target ${target.name} did not reconcile after runner completed`,
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
    await nextMigrationFile(options.directory, defaultMigrationName(plan))
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
}

async function stageSyncClosureForSync(state: SyncPipelineState): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true || operationName(state.options) !== "sync") {
    return;
  }
  if (state.artifacts.closureStaged) {
    return;
  }
  let result: StageSyncClosureResult;
  try {
    result = await stageSyncClosure({
      artifacts: state.artifacts,
      config: state.config,
      ...(state.options.configPath === undefined ? {} : { configPath: state.options.configPath }),
      ...(state.sources === undefined ? {} : { sources: state.sources }),
    });
  } catch (error) {
    state.diagnostics.push(
      diagnostic(
        "SUPA_SYNC_STAGE_FAILED",
        "error",
        error instanceof Error ? error.message : String(error),
        { hint: "Resolve the Git path or staging failure, then rerun supaschema sync." }
      )
    );
    state.lines.push("refusing to sync: schema closure staging failed");
    return {
      applied: false,
      diagnostics: state.diagnostics,
      pending: requiredSyncStatus(state).pending,
      report: render(state.lines),
    };
  }
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
}

interface StageSyncClosureOptions {
  artifacts: SyncArtifactState;
  config: SupaschemaConfig;
  configPath?: string;
  sources?: SyncSources;
}

interface StageSyncClosureResult {
  skippedReason?: string;
  staged: string[];
}

async function stageSyncClosure(options: StageSyncClosureOptions): Promise<StageSyncClosureResult> {
  const root = await gitRoot();
  if (root === undefined) {
    return { skippedReason: "not a git worktree", staged: [] };
  }
  const schemaRoots = await syncSchemaRootGitPaths(root, options.config, options.sources);
  const artifactPaths = await syncArtifactGitPaths(root, options.artifacts, options.configPath);
  const pathSpecs = uniqueStrings([...schemaRoots, ...artifactPaths]);
  if (pathSpecs.length === 0) {
    return { skippedReason: "no schema closure paths are inside the git worktree", staged: [] };
  }
  const changed = await changedGitPaths(root, pathSpecs);
  const artifacts = new Set(artifactPaths);
  const roots = new Set(schemaRoots);
  const staged = changed.filter((path) => isSyncClosurePath(path, artifacts, roots));
  if (staged.length === 0) {
    return { staged: [] };
  }
  await execFileAsync("git", ["add", "--", ...staged], { cwd: root });
  return { staged };
}

async function gitRoot(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return await realpath(stdout.trim());
  } catch (error) {
    const stderr = error instanceof Error ? Reflect.get(error, "stderr") : undefined;
    if (String(stderr ?? "").includes("not a git repository")) {
      return;
    }
    throw error;
  }
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

async function syncArtifactGitPaths(
  root: string,
  artifacts: SyncArtifactState,
  configPath: string | undefined
): Promise<string[]> {
  return await gitPathsForExistingPaths(root, [
    ...artifacts.generatedMigrationPaths,
    ...artifacts.writtenContractPaths,
    ...(configPath === undefined ? [] : [configPath]),
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
}

function targetSafetySource(target: ResolvedSyncTarget, fallbackSource: string): string {
  return target.databaseUrl === undefined ? fallbackSource : `database:${target.databaseUrl}`;
}

function targetHistoryTableRef(target: ResolvedSyncTarget): ObjectRef | undefined {
  const [schema, name, extra] = target.historyTable.split(".");
  if (!(schema && name) || extra !== undefined) {
    return;
  }
  return { kind: "table", name, schema };
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
