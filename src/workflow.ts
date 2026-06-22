import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkMigrationSql } from "./check.js";
import { resolveConfig } from "./config.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { latestLineage } from "./lineage.js";
import { defaultMigrationName } from "./migration-files.js";
import {
  isConcurrentMigrationFile,
  type MigrationRunnerKind,
  type MigrationRunnerResult,
  runDirectMigrationRunner,
  runSupabaseCliMigrationRunner,
} from "./migration-runners.js";
import {
  type MigrationsStatusReport,
  migrationsStatus,
  renderMigrationsStatus,
} from "./migrations-status.js";
import { buildSchemaDiffPlan, runRlsSafetyGate, runTypeSafetyGate } from "./pipeline-services.js";
import { renderMigrationSplit } from "./render.js";
import { resolveSourceDefaults } from "./source-resolve.js";
import { stageGeneratedMigrations } from "./stage.js";
import {
  operationName,
  operationTargetLabel,
  type ResolvedSyncTarget,
  resolveSyncTargets,
} from "./sync-targets.js";
import { generateTypeContracts } from "./typegen-contracts.js";
import { verifyMigrationChain } from "./verify.js";

export interface SyncOptions {
  cliVersion?: string;
  config?: Partial<SupaschemaConfig>;
  databaseUrl?: string;
  directory: string;
  ensureEnvironment?: boolean;
  ensureRoles?: boolean;
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
    artifacts: { contractsRefreshed: false, migrationsStaged: false },
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

interface SyncSources {
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
  contractsRefreshed: boolean;
  migrationsStaged: boolean;
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
  stageFallbackGeneratedMigrationsLane,
  runFallbackSafetyGatesLane,
  stopFallbackWhenNothingPendingLane,
  verifyFallbackPendingMigrationsLane,
  reportFallbackDryRunOrUnknownTargetLane,
];

function guardSyncPolicyLane(state: SyncPipelineState): SyncResult | undefined {
  return disabledSyncResult(state.options, state.config, state.diagnostics);
}

async function resolveSyncSourcesLane(state: SyncPipelineState): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true) {
    return;
  }
  state.sources = await resolveSyncSources(state.options, state.config);
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
    state.lines
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
  const pending = requiredSyncStatus(state).pending;
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

function refreshFallbackGeneratedContractsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> {
  return refreshGeneratedContractsForSync(state);
}

function stageFallbackGeneratedMigrationsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> {
  return stageGeneratedMigrationsForSync(state);
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

function verifyFallbackPendingMigrationsLane(
  state: SyncPipelineState
): Promise<SyncResult | undefined> {
  if (state.sources === undefined) {
    return Promise.resolve(undefined);
  }
  return verifyPendingMigrationsForSync({
    config: state.config,
    diagnostics: state.diagnostics,
    directory: state.options.directory,
    lines: state.lines,
    options: state.options,
    pending: requiredSyncStatus(state).pending,
    sources: requiredSyncSources(state),
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

function resolveSyncSources(options: SyncOptions, config: SupaschemaConfig): Promise<SyncSources> {
  return resolveSourceDefaults(options, config, () =>
    Promise.resolve(resolveDatabaseUrl(options.databaseUrl))
  );
}

async function runSyncDiffStage(
  options: SyncOptions,
  config: SupaschemaConfig,
  sources: SyncSources,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult | undefined> {
  const plan = await buildSchemaDiffPlan({ config, from: sources.from, to: sources.to });
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
  lines.push(`diff: wrote ${outPath}`);
  if (rendered.concurrentSql !== undefined) {
    const concurrentPath = `${stripSqlExtension(outPath)}.concurrent.sql`;
    await writeFile(concurrentPath, rendered.concurrentSql, { flag: "wx" });
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
  for (const line of result.skipped) {
    state.lines.push(line);
  }
  state.artifacts.contractsRefreshed = true;
  return;
}

async function stageGeneratedMigrationsForSync(
  state: Pick<SyncPipelineState, "artifacts" | "diagnostics" | "lines" | "options">
): Promise<SyncResult | undefined> {
  if (state.options.pipeline !== true || operationName(state.options) !== "sync") {
    return;
  }
  if (state.artifacts.migrationsStaged) {
    return;
  }
  const result = await stageGeneratedMigrations({ directory: state.options.directory });
  if (result.skippedReason !== undefined) {
    state.lines.push(`stage: skipped (${result.skippedReason})`);
  } else if (result.staged.length === 0) {
    state.lines.push("stage: no generated migration files to stage");
  } else {
    for (const file of result.staged) {
      state.lines.push(`stage: staged ${file}`);
    }
  }
  state.artifacts.migrationsStaged = true;
  return;
}

async function runSyncSafetyGates(
  config: SupaschemaConfig,
  sources: SyncSources,
  diagnostics: Diagnostic[],
  lines: string[],
  options: { pending: string[]; targetName?: string }
): Promise<SyncResult | undefined> {
  const typeGate = await runTypeSafetyGate({
    config,
    fromSource: sources.from,
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
  stageTargetGeneratedMigrationsLane,
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
  return checkPendingMigrations(
    state.options.directory,
    requiredTargetStatus(state).pending,
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

function stageTargetGeneratedMigrationsLane(
  state: TargetSyncState
): Promise<SyncResult | undefined> {
  return stageGeneratedMigrationsForSync(state);
}

function guardTargetConcurrentCompanionsLane(state: TargetSyncState): SyncResult | undefined {
  return supabaseCliConcurrentCompanionResult(
    state.target,
    requiredTargetStatus(state).pending,
    state.diagnostics,
    state.lines,
    operationName(state.options)
  );
}

function runTargetSafetyLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  return runSyncSafetyGates(
    state.config,
    targetSafetySources(state.sources, state.target),
    state.diagnostics,
    state.lines,
    { pending: requiredTargetStatus(state).pending, targetName: state.target.name }
  );
}

function verifyTargetPendingMigrationsLane(
  state: TargetSyncState
): Promise<SyncResult | undefined> {
  return verifyPendingMigrationsForSync({
    config: state.config,
    diagnostics: state.diagnostics,
    directory: state.options.directory,
    lines: state.lines,
    options: state.options,
    pending: requiredTargetStatus(state).pending,
    sources: targetSafetySources(state.sources, state.target),
    target: state.target,
  });
}

async function applyTargetMigrationsLane(state: TargetSyncState): Promise<SyncResult | undefined> {
  const status = requiredTargetStatus(state);
  state.outcome = await runTargetRunner(state.options, state.config, state.target, status.pending);
  state.lines.push(`running: ${state.outcome.displayCommand ?? state.target.runner}`);
  return runnerFailureResult(
    state.outcome,
    state.target.runner,
    status.pending,
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

function targetSafetySources(sources: SyncSources, target: ResolvedSyncTarget): SyncSources {
  if (target.databaseUrl === undefined) {
    return sources;
  }
  return { from: `database:${target.databaseUrl}`, to: sources.to };
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

interface VerifyPendingMigrationsForSyncOptions {
  config: SupaschemaConfig;
  diagnostics: Diagnostic[];
  directory: string;
  lines: string[];
  options: SyncOptions;
  pending: string[];
  sources: SyncSources;
  target?: ResolvedSyncTarget;
}

async function verifyPendingMigrationsForSync(
  options: VerifyPendingMigrationsForSyncOptions
): Promise<SyncResult | undefined> {
  if (operationName(options.options) !== "sync" || options.pending.length === 0) {
    return;
  }
  const databaseUrl = resolveSyncVerifyDatabaseUrl(options);
  if (databaseUrl === undefined) {
    if (shouldSkipSupabaseCliVerify(options)) {
      options.lines.push(
        `verify: skipped for ${options.target?.name} because the Supabase CLI target resolves credentials at runtime`
      );
      return;
    }
    options.diagnostics.push(
      diagnostic(
        "SUPA_SYNC_VERIFY_URL_UNRESOLVED",
        "error",
        syncVerifyUrlUnresolvedMessage(options),
        {
          hint: syncVerifyUrlUnresolvedHint(options),
        }
      )
    );
    options.lines.push("refusing to sync: verify has no database URL");
    return {
      applied: false,
      diagnostics: options.diagnostics,
      pending: options.pending,
      report: render(options.lines),
    };
  }
  const verifyDiagnostics = await verifyMigrationChain({
    config: options.config,
    databaseUrl,
    ...(options.options.ensureEnvironment === undefined
      ? {}
      : { ensureEnvironment: options.options.ensureEnvironment }),
    ensureRoles: options.options.ensureRoles === true,
    from: options.sources.from,
    migrationPaths: options.pending.map((file) => join(options.directory, file)),
    to: options.sources.to,
  });
  options.diagnostics.push(...verifyDiagnostics);
  if (hasErrors(options.diagnostics)) {
    options.lines.push("refusing to sync: verify failed for pending migrations");
    return {
      applied: false,
      diagnostics: options.diagnostics,
      pending: options.pending,
      report: render(options.lines),
    };
  }
  options.lines.push(`verify: ${options.pending.length} pending migration file(s) passed`);
  return;
}

function shouldSkipSupabaseCliVerify(options: VerifyPendingMigrationsForSyncOptions): boolean {
  return (
    options.target?.runner === "supabase-cli" &&
    options.target.databaseUrl === undefined &&
    options.options.databaseUrl === undefined &&
    options.options.envName === undefined
  );
}

function resolveSyncVerifyDatabaseUrl(
  options: VerifyPendingMigrationsForSyncOptions
): string | undefined {
  try {
    if (options.target?.remote === true) {
      const databaseUrl = resolveDatabaseUrl();
      return databaseUrl === options.target.databaseUrl ? undefined : databaseUrl;
    }
    return options.target?.databaseUrl ?? resolveDatabaseUrl(options.options.databaseUrl);
  } catch {
    return;
  }
}

function syncVerifyUrlUnresolvedMessage(options: VerifyPendingMigrationsForSyncOptions): string {
  if (options.target?.remote === true) {
    return `sync requires a separate disposable database URL for verify before applying remote target ${options.target.name}`;
  }
  return "sync requires a database URL for verify before apply or dry-run completion";
}

function syncVerifyUrlUnresolvedHint(options: VerifyPendingMigrationsForSyncOptions): string {
  if (options.target?.remote === true) {
    return "Set SUPASCHEMA_DATABASE_URL to a disposable verification database URL or run inside a local Supabase project; remote target databaseUrl and --database-url apply to the target and are not used for verify.";
  }
  return "Pass --database-url, select a target with databaseUrl/environment, set SUPASCHEMA_DATABASE_URL, or run inside a Supabase project with supabase/config.toml.";
}

async function checkSyncLineageChain(
  fromFingerprint: string,
  toFingerprint: string,
  directory: string
): Promise<Diagnostic[]> {
  const latest = await latestLineage(directory);
  if (!latest) {
    return [];
  }
  if (latest.from === fromFingerprint && latest.to === toFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_DUPLICATE",
        "error",
        "a pending supaschema migration already covers this exact from/to transition",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before running sync again.",
        }
      ),
    ];
  }
  if (latest.to !== fromFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_GAP",
        "error",
        "the newest pending supaschema migration does not chain into the next schema diff",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before generating another one.",
        }
      ),
    ];
  }
  return [];
}

function loadSyncStatus(options: SyncOptions, selectedRunner: MigrationRunnerKind) {
  return migrationsStatus({
    allowMissingHistoryTable: selectedRunner === "direct",
    directory: options.directory,
    ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
    ...(options.historyTable === undefined ? {} : { historyTable: options.historyTable }),
  });
}

async function checkPendingMigrations(
  directory: string,
  pending: string[],
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  lines: string[],
  operation: "apply" | "sync" = "sync"
): Promise<SyncResult | undefined> {
  for (const file of pending) {
    const sql = await readFile(join(directory, file), "utf8");
    const checkDiagnostics = await checkMigrationSql(sql, { config });
    const errors = checkDiagnostics.filter((item) => item.severity === "error");
    diagnostics.push(...errors);
    if (errors.length > 0) {
      lines.push(`refusing to ${operation}: ${file} fails the replay-safety check`);
      return {
        applied: false,
        diagnostics,
        pending,
        report: render(lines),
      };
    }
    lines.push(`checked: ${file} (replay-safe)`);
  }
  return;
}

function runnerFailureResult(
  outcome: MigrationRunnerResult,
  selectedRunner: MigrationRunnerKind,
  pending: string[],
  diagnostics: Diagnostic[],
  lines: string[]
): SyncResult | undefined {
  if (outcome.ok) {
    return;
  }
  diagnostics.push(
    outcome.kind === "unavailable"
      ? diagnostic("SUPA_SYNC_RUNNER_UNAVAILABLE", "error", outcome.message, {
          hint: runnerUnavailableHint(selectedRunner),
        })
      : diagnostic("SUPA_SYNC_RUNNER_FAILED", "error", outcome.message, {
          hint: "The migration runner owns apply/deploy; inspect its output above.",
        })
  );
  return {
    applied: false,
    diagnostics,
    pending,
    report: render(lines),
  };
}

function runnerUnavailableHint(selectedRunner: MigrationRunnerKind): string {
  if (selectedRunner === "supabase-cli") {
    return "Install the Supabase CLI (https://supabase.com/docs/guides/local-development) and ensure `supabase` is on PATH, or set the target runner to direct with a resolved database URL.";
  }
  return "Pass --database-url or select a configured sync target with a resolved database URL.";
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

function render(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function stripSqlExtension(value: string): string {
  return value.endsWith(".sql") ? value.slice(0, -4) : value;
}
