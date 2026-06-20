import { execFile, execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { checkMigrationSql } from "./check.js";
import { defaultMigrationName, defaultTreeSource, resolveSourceDefaults } from "./cli-defaults.js";
import { resolveConfig } from "./config.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { latestLineage } from "./lineage.js";
import {
  isConcurrentMigrationFile,
  type MigrationRunnerKind,
  type MigrationRunnerResult,
  runDirectMigrationRunner,
  runSupabaseCliMigrationRunner,
  type SupabaseCliOperation,
} from "./migration-runners.js";
import {
  type MigrationsStatusReport,
  migrationsStatus,
  renderMigrationsStatus,
} from "./migrations-status.js";
import { buildSchemaDiffPlan, runRlsSafetyGate, runTypeSafetyGate } from "./pipeline-services.js";
import { redactSecrets } from "./redaction.js";
import { renderMigrationSplit } from "./render.js";
import { extractSourceModel } from "./source.js";
import { generateDatabaseTypes } from "./typegen.js";
import { collectSchemaShapes } from "./typegen-model.js";
import { generateZodSchemas } from "./typegen-zod.js";
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

const editTools = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "edit_file",
  "apply_patch",
  "functions.apply_patch",
]);
const lineageMarker = "-- supaschema: lineage ";
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";
const genericSchemaPath = "database/schemas";
const supabaseSchemaPath = "supabase/schemas";
const execFileAsync = promisify(execFile);
const providerSchemaMarkers: {
  markers: { contentTerms?: string[]; fileNames?: string[]; path?: string }[];
  schemaPath: string;
}[] = [
  { schemaPath: supabaseSchemaPath, markers: [{ path: "supabase/config.toml" }] },
  {
    schemaPath: "neon/schemas",
    markers: [
      { path: "neon.toml" },
      { path: ".neon/project.json" },
      { path: ".neon/config.json" },
      {
        contentTerms: ["neon.tech", "neon.com"],
        fileNames: ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"],
      },
    ],
  },
  {
    schemaPath: "aws-postgresql/schemas",
    markers: [
      {
        contentTerms: ["aws_db_instance", "aws_rds_cluster", "aws_rds_global_cluster"],
        fileNames: ["*.tf"],
      },
      {
        contentTerms: ["AWS::RDS::DBInstance", "AWS::RDS::DBCluster"],
        fileNames: ["template.yaml", "template.yml"],
      },
      {
        contentTerms: ["Aurora", "DatabaseCluster", "DatabaseInstance", "RDS", "rds"],
        fileNames: [
          "cdk.json",
          "sst.config.ts",
          "sst.config.js",
          "sst.config.mjs",
          "serverless.yml",
          "serverless.yaml",
        ],
      },
    ],
  },
  {
    schemaPath: "alloydb/schemas",
    markers: [
      { contentTerms: ["google_alloydb_cluster", "google_alloydb_instance"], fileNames: ["*.tf"] },
      {
        contentTerms: ["alloydb", "alloydb.googleapis.com"],
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
      },
    ],
  },
  {
    schemaPath: "cloud-sql/schemas",
    markers: [
      {
        contentTerms: ["google_sql_database_instance", "google_sql_database"],
        fileNames: ["*.tf"],
      },
      {
        contentTerms: ["cloud_sql_instances", "CLOUD_SQL_CONNECTION_NAME", "cloudsql"],
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
      },
    ],
  },
  {
    schemaPath: "azure-postgresql/schemas",
    markers: [
      {
        contentTerms: ["azurerm_postgresql_flexible_server", "azurerm_postgresql_server"],
        fileNames: ["*.tf"],
      },
      {
        contentTerms: ["Microsoft.DBforPostgreSQL/flexibleServers", "Microsoft.DBforPostgreSQL"],
        fileNames: ["main.bicep", "azuredeploy.json"],
      },
      {
        contentTerms: ["postgres", "PostgreSQL", "DBforPostgreSQL"],
        fileNames: ["azure.yaml"],
      },
    ],
  },
];

export interface AgentHookOutput {
  decision?: "block";
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: string;
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
  };
  reason?: string;
  systemMessage?: string;
}

interface HookCommand {
  args: string[];
  cmd: string;
}

interface HookCommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

interface SchemaPathState {
  candidateMigrationsDirs: string[];
  candidateSchemaPaths: string[];
  confirmationSchemaPaths: string[];
  environments: Record<string, { databaseUrl: string }>;
  migrationsDir?: string;
  pathConfirmationNeeded: boolean;
  schemaPaths: string[];
  sourcesTo?: string;
  sync: { targets: Record<string, HookSyncTarget> };
  workflow: SupaschemaConfig["workflow"];
}

interface HookSyncTarget {
  databaseUrl?: string;
  environment?: string;
  mode: "manual" | "auto";
  remote?: boolean;
  requireApprovalEnv?: string;
  runner: "direct" | "supabase-cli";
}

interface ChangedSchemaGroup {
  changed: string[];
  display: string;
}

interface AutomaticSyncPlan {
  enabled: boolean;
  line?: string;
  reason?: string;
}

interface HookCheckResult {
  diagnostics?: string;
  line: string;
  passed: boolean;
}

export function schemaWriteHookOutput(payload: unknown): AgentHookOutput | undefined {
  const projectDir = hookProjectDir(payload);
  const targets = hookEditTargets(payload, projectDir);
  const pathState = readSchemaPathState(projectDir);
  if (pathState.pathConfirmationNeeded) {
    const pendingRoots = pathState.confirmationSchemaPaths.map((path) => ({
      display: rel(projectDir, resolve(projectDir, path)),
      root: resolve(projectDir, path),
    }));
    const pending = changedSchemaTargets(targets, pendingRoots);
    if (pending.changed.length > 0) {
      return postToolUseHookOutput(pathConfirmationMessage(projectDir, pending.changed, pathState));
    }
  }
  const schemaRoots = pathState.schemaPaths.map((path) => ({
    display: rel(projectDir, resolve(projectDir, path)),
    root: resolve(projectDir, path),
  }));
  const { changed, groups } = changedSchemaTargets(targets, schemaRoots);
  if (changed.length === 0) {
    return;
  }
  if (pathState.workflow.schema_diff !== "on_schema_write") {
    return postToolUseHookOutput(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(
          ", "
        )} because workflow.schema_diff is "${pathState.workflow.schema_diff}". Run \`supaschema diff\` manually when this schema change should produce a migration.`
    );
  }
  if (pathState.schemaPaths.length > 1) {
    return postToolUseHookOutput(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(", ")} because the project has multi-root schemaPaths (${pathState.schemaPaths.join(
        ", "
      )}) and automatic diff would only target the touched root (${groups
        .map((group) => group.display)
        .join(
          ", "
        )}). Run one reviewed \`supaschema diff\` from the intended current state, then run \`supaschema check\`; the hook avoids chaining partial migrations for multi-root configs.`
    );
  }
  const bin = resolveHookBinary(projectDir);
  const autoSync = automaticSyncPlan(pathState);
  if (autoSync.enabled) {
    const sync = runHookCommand(bin, ["sync"], projectDir);
    const diagnostics = head(sync.stderr || sync.stdout);
    const context =
      sync.code === 0
        ? `supaschema auto-sync completed for ${changed
            .map((path) => rel(projectDir, path))
            .join(
              ", "
            )} through \`supaschema sync\`. ${autoSync.line}. The sync pipeline generated the schema diff, selected one target, reconciled migration history, checked pending migrations, refreshed generated contracts, staged generated migrations when Git was available, ran type/RLS safety gates, verified pending migrations, applied the selected target, and reconciled final history.`
        : `supaschema auto-sync for ${changed
            .map((path) => rel(projectDir, path))
            .join(", ")} did not complete (exit ${sync.code}):\n${diagnostics}`;
    if (sync.code !== 0) {
      return postToolUseHookOutput(context, {
        decision: "block",
        reason: syncFailureLoopReason(projectDir, changed, diagnostics),
      });
    }
    return postToolUseHookOutput(context);
  }
  const written: string[] = [];
  for (const group of groups) {
    const diff = runHookCommand(bin, ["diff", "--to", `dir:${group.display}`], projectDir);
    if (diff.code !== 0) {
      return postToolUseHookOutput(
        `supaschema auto-diff for ${group.changed
          .map((path) => rel(projectDir, path))
          .join(", ")} did not complete (exit ${diff.code}):\n${head(
          diff.stderr || diff.stdout
        )}\nResolve per the supaschema skill, for example add the exact object key to hints.destructive for a destructive change, or diff from the post-migration state when the lineage chain is broken, then re-run \`supaschema diff --to dir:${group.display}\`.`
      );
    }
    written.push(...migrationOutputs(diff.stdout));
  }
  if (written.length === 0) {
    return postToolUseHookOutput(
      `supaschema: ${changed
        .map((path) => rel(projectDir, path))
        .join(
          ", "
        )} changed but produces no net schema change versus the current state; no migration written.`
    );
  }
  const checkResult = runConfiguredHookCheck(bin, projectDir, pathState.workflow, written);
  const verifyLine = runConfiguredHookVerify(
    bin,
    projectDir,
    pathState.workflow,
    checkResult.passed
  );
  const additionalContext = `supaschema auto-diff completed for ${changed
    .map((path) => rel(projectDir, path))
    .join(", ")}: generated ${written
    .map((path) => rel(projectDir, path))
    .join(
      ", "
    )}. Run \`supaschema sync\` for the full diff/check/types/stage/verify/apply workflow. ${checkResult.line}${
    verifyLine === "" ? "" : `. ${verifyLine}`
  }. Automatic sync skipped: ${autoSync.reason}. Commit the tree change, generated migration, and generated outputs together before a later apply.`;
  if (!checkResult.passed) {
    return postToolUseHookOutput(additionalContext, {
      decision: "block",
      reason: checkFailureLoopReason(projectDir, changed, checkResult),
    });
  }
  return postToolUseHookOutput(additionalContext);
}

export function generatedMigrationEditHookOutput(
  payload: unknown,
  runtime: "claude" | "codex"
): AgentHookOutput | undefined {
  const projectDir = hookProjectDir(payload);
  const blocked = generatedMigrationEditTargets(payload, projectDir).find((path) =>
    isGeneratedMigration(path)
  );
  if (blocked === undefined) {
    return runtime === "codex" ? {} : undefined;
  }
  const reason =
    `${blocked} is a supaschema-generated migration (lineage marker present). ` +
    "Do not hand-edit it: change the declarative schema tree, delete this file if it is stale, " +
    "and regenerate with `supaschema diff`.";
  if (runtime === "codex") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${reason} See .codex/rules/supaschema.rules.`,
      },
    };
  }
  return {
    hookSpecificOutput: {
      additionalContext: `${reason} See .claude/rules/supaschema.md.`,
      hookEventName: "PreToolUse",
    },
    reason: `${reason} See .claude/rules/supaschema.md.`,
  };
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
  stopFallbackWhenNothingPendingLane,
  runFallbackSafetyGatesLane,
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

function operationName(options: Pick<SyncOptions, "operation">): "apply" | "sync" {
  return options.operation ?? "sync";
}

function operationTargetLabel(options: Pick<SyncOptions, "operation">): string {
  return operationName(options) === "apply" ? "apply target" : "sync target";
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

interface GeneratedContractsOptions {
  config: SupaschemaConfig;
  honorWorkflowPolicy?: boolean;
  out?: string;
  source?: string;
}

interface GeneratedContractsResult {
  diagnostics: Diagnostic[];
  skipped: string[];
  stdout?: string;
  written: string[];
}

export async function generateTypeContracts(
  options: GeneratedContractsOptions
): Promise<GeneratedContractsResult> {
  const source = options.source ?? defaultTreeSource(options.config);
  const target = options.out ?? options.config.typesFile;
  const typesPath = target === "stdout" ? "stdout" : resolve(process.cwd(), target);
  const zodPath = resolve(process.cwd(), options.config.zodFile);
  const typesPolicy = options.config.workflow.type_generation;
  const zodPolicy = options.config.workflow.zod_generation;
  const writeTypes =
    target !== "stdout" &&
    (await shouldWriteGeneratedOutput(typesPath, typesPolicy, options.honorWorkflowPolicy));
  const writeZod =
    target !== "stdout" &&
    (await shouldWriteGeneratedOutput(zodPath, zodPolicy, options.honorWorkflowPolicy));
  if (target !== "stdout" && !writeTypes && !writeZod) {
    return {
      diagnostics: [],
      skipped: skippedGeneratedOutputs(typesPath, typesPolicy, zodPath, zodPolicy),
      written: [],
    };
  }
  const model = await extractSourceModel(source, { config: options.config });
  if (hasErrors(model.diagnostics)) {
    return { diagnostics: model.diagnostics, skipped: [], written: [] };
  }
  const shapes = await collectSchemaShapes(model);
  const types = generateDatabaseTypes(shapes);
  if (target === "stdout") {
    return { diagnostics: model.diagnostics, skipped: [], stdout: types, written: [] };
  }
  const written: string[] = [];
  if (writeTypes) {
    await mkdir(dirname(typesPath), { recursive: true });
    await writeFile(typesPath, types);
    written.push(typesPath);
  }
  if (writeZod) {
    await mkdir(dirname(zodPath), { recursive: true });
    await writeFile(zodPath, generateZodSchemas(shapes));
    written.push(zodPath);
  }
  return { diagnostics: model.diagnostics, skipped: [], written };
}

async function shouldWriteGeneratedOutput(
  path: string,
  policy: SupaschemaConfig["workflow"]["type_generation"],
  honorWorkflowPolicy: boolean | undefined
): Promise<boolean> {
  if (honorWorkflowPolicy !== true) {
    return true;
  }
  if (policy === "disabled") {
    return false;
  }
  if (policy === "create_or_refresh") {
    return true;
  }
  return await pathExists(path);
}

function skippedGeneratedOutputs(
  typesPath: string,
  typesPolicy: SupaschemaConfig["workflow"]["type_generation"],
  zodPath: string,
  zodPolicy: SupaschemaConfig["workflow"]["zod_generation"]
): string[] {
  const skipped: string[] = [];
  if (typesPolicy === "disabled") {
    skipped.push(`types: skipped ${typesPath} because workflow.type_generation is "disabled"`);
  } else if (typesPolicy === "refresh_existing") {
    skipped.push(`types: skipped ${typesPath} because it does not exist`);
  }
  if (zodPolicy === "disabled") {
    skipped.push(`zod: skipped ${zodPath} because workflow.zod_generation is "disabled"`);
  } else if (zodPolicy === "refresh_existing") {
    skipped.push(`zod: skipped ${zodPath} because it does not exist`);
  }
  return skipped;
}

interface StageGeneratedMigrationsOptions {
  directory: string;
  dryRun?: boolean;
  requireGit?: boolean;
}

interface StageGeneratedMigrationsResult {
  skippedReason?: string;
  staged: string[];
  wouldStage: string[];
}

export async function stageGeneratedMigrations(
  options: StageGeneratedMigrationsOptions
): Promise<StageGeneratedMigrationsResult> {
  let changed: GitChangedPaths;
  try {
    changed = await changedGitPaths(options.directory);
  } catch (error) {
    if (options.requireGit === true) {
      throw error;
    }
    return { skippedReason: "not a git worktree", staged: [], wouldStage: [] };
  }
  const generated: string[] = [];
  for (const file of changed.paths) {
    if (await isGeneratedMigrationFile(file, changed.root)) {
      generated.push(file);
      const companion = concurrentCompanionPath(file);
      if (
        companion !== undefined &&
        changed.paths.includes(companion) &&
        !generated.includes(companion)
      ) {
        generated.push(companion);
      }
    }
  }
  if (options.dryRun === true) {
    return { staged: [], wouldStage: generated };
  }
  if (generated.length === 0) {
    return { staged: [], wouldStage: [] };
  }
  await execFileAsync("git", ["add", "--", ...generated], { cwd: changed.root });
  return { staged: generated, wouldStage: [] };
}

interface GitChangedPaths {
  paths: string[];
  root: string;
}

async function changedGitPaths(directory: string): Promise<GitChangedPaths> {
  try {
    const root = await realpath(
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).then((result) => result.stdout.trim())
    );
    const directoryPath = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
    const resolvedDirectoryPath = await realpath(directoryPath).catch(() => directoryPath);
    const gitPath = relative(root, resolvedDirectoryPath) || ".";
    if (gitPath.startsWith("..") || isAbsolute(gitPath)) {
      throw new Error("supaschema stage directory must be inside the git worktree");
    }
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", gitPath],
      { cwd: root, encoding: "utf8" }
    );
    return { paths: parsePorcelainStatusPaths(stdout), root };
  } catch {
    throw new Error("supaschema stage requires a git worktree");
  }
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
    const file = entry.slice(3);
    if (status.includes("D")) {
      continue;
    }
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    if (file.length > 0 && !paths.includes(file)) {
      paths.push(file);
    }
  }
  return paths;
}

async function isGeneratedMigrationFile(file: string, root = process.cwd()): Promise<boolean> {
  if (!file.endsWith(".sql")) {
    return false;
  }
  const filePath = isAbsolute(file) ? file : resolve(root, file);
  const contents = await readFile(filePath, "utf8").catch(() => undefined);
  return contents?.slice(0, 4096).includes(lineageMarker) === true;
}

function concurrentCompanionPath(file: string): string | undefined {
  if (!file.endsWith(".sql") || file.endsWith(".concurrent.sql")) {
    return;
  }
  return `${file.slice(0, -".sql".length)}.concurrent.sql`;
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

interface ResolvedSyncTarget {
  automatic: boolean;
  databaseUrl?: string;
  historyTable: string;
  name: string;
  operation: SupabaseCliOperation;
  remote: boolean;
  runner: MigrationRunnerKind;
}

interface SyncTargetSelection {
  automatic: boolean;
  name: string;
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

function resolveSyncTargets(
  options: SyncOptions,
  config: SupaschemaConfig
): { diagnostics: Diagnostic[]; targets: ResolvedSyncTarget[] } {
  const diagnostics: Diagnostic[] = [];
  const selected = selectedTargetNames(options, config);
  if (selected.length === 0) {
    return { diagnostics, targets: [] };
  }
  if ((options.envName !== undefined || options.databaseUrl !== undefined) && selected.length > 1) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_TARGET_OVERRIDE_MULTI",
        "error",
        "--env and --database-url can only override sync when exactly one target is selected",
        { hint: "Use --target <name> to select one configured target." }
      )
    );
    return { diagnostics, targets: [] };
  }
  if (selected.length > 1) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_MULTI_TARGET_APPLY_UNSUPPORTED",
        "error",
        `${operationName(options)} selected ${selected.length} targets; cross-target apply is not atomic`,
        {
          hint: `Run supaschema ${operationName(options)} --target <name> for one target at a time, or keep only one sync.targets entry in mode "auto".`,
        }
      )
    );
    return { diagnostics, targets: [] };
  }
  const targets = selected
    .map((selection) => resolveSyncTarget(selection, options, config, diagnostics))
    .filter((target): target is ResolvedSyncTarget => target !== undefined);
  return { diagnostics, targets };
}

function selectedTargetNames(
  options: SyncOptions,
  config: SupaschemaConfig
): SyncTargetSelection[] {
  const explicit: SyncTargetSelection[] = [];
  if (options.target !== undefined) {
    explicit.push({
      automatic: false,
      name: options.target,
    });
  }
  if (explicit.length > 0) {
    return explicit;
  }
  if (config.workflow.migration_sync === "auto") {
    return Object.entries(config.sync.targets)
      .filter(([, target]) => target.mode === "auto")
      .map(([name]) => ({ automatic: true, name }));
  }
  return [];
}

function resolveSyncTarget(
  selection: SyncTargetSelection,
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[]
): ResolvedSyncTarget | undefined {
  const configured = config.sync.targets[selection.name];
  if (configured === undefined) {
    if (selection.automatic) {
      return;
    }
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_TARGET_UNKNOWN",
        "error",
        `${operationTargetLabel(options)} "${selection.name}" is not configured`,
        { hint: "Add sync.targets.<name> to supaschema.config.json." }
      )
    );
    return;
  }
  const remote = isRemoteTargetName(configured, selection.name);
  const runner = options.runner ?? configured.runner;
  const databaseUrl = resolveTargetUrl(selection, configured, options, config, diagnostics, runner);
  if (
    selection.automatic &&
    remote &&
    configured.requireApprovalEnv !== undefined &&
    process.env[configured.requireApprovalEnv] !== "1"
  ) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_REMOTE_APPROVAL_REQUIRED",
        "error",
        `remote sync target ${selection.name} requires ${configured.requireApprovalEnv}=1 before automatic deploy`,
        { hint: "Set the approval environment variable in an operator-controlled process." }
      )
    );
  }
  return {
    automatic: selection.automatic,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    historyTable: options.historyTable ?? configured.historyTable,
    name: selection.name,
    operation: remote ? "remote" : "local",
    remote,
    runner,
  };
}

function resolveTargetUrl(
  selection: SyncTargetSelection,
  target: SupaschemaConfig["sync"]["targets"][string],
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  runner: MigrationRunnerKind
): string | undefined {
  try {
    if (options.databaseUrl !== undefined) {
      return resolveDatabaseUrl(options.databaseUrl);
    }
    if (options.envName !== undefined) {
      return resolveTargetEnvOverride(options.envName, config, diagnostics);
    }
    const value = target.databaseUrl ?? config.environments[target.environment ?? ""]?.databaseUrl;
    if (value === undefined) {
      return resolveMissingTargetUrl(selection, target, diagnostics, runner);
    }
    return resolveDatabaseUrl(value);
  } catch (error) {
    if (selection.automatic || runner === "direct" || runner === "supabase-cli") {
      pushTargetUrlDiagnostic(
        diagnostics,
        selection.name,
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }
}

function resolveTargetEnvOverride(
  envName: string,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[]
): string | undefined {
  const env = config.environments[envName];
  if (env === undefined) {
    diagnostics.push(
      diagnostic("SUPA_SYNC_ENV_UNKNOWN", "error", `--env "${envName}" is not defined`)
    );
    return;
  }
  return resolveDatabaseUrl(env.databaseUrl);
}

function resolveMissingTargetUrl(
  selection: SyncTargetSelection,
  target: SupaschemaConfig["sync"]["targets"][string],
  diagnostics: Diagnostic[],
  runner: MigrationRunnerKind
): string | undefined {
  if (target.environment !== undefined) {
    pushTargetUrlDiagnostic(
      diagnostics,
      selection.name,
      `sync target ${selection.name} references unknown environment "${target.environment}"`
    );
    return;
  }
  if (runner === "supabase-cli") {
    return;
  }
  if (isRemoteTargetName(target, selection.name)) {
    pushTargetUrlDiagnostic(
      diagnostics,
      selection.name,
      `sync target ${selection.name} does not define a database URL`
    );
    return;
  }
  return resolveLocalTargetUrlFallback(selection, diagnostics);
}

function resolveLocalTargetUrlFallback(
  selection: SyncTargetSelection,
  diagnostics: Diagnostic[]
): string | undefined {
  const fallback = resolveDatabaseUrl();
  if (fallback === undefined && selection.automatic) {
    pushTargetUrlDiagnostic(
      diagnostics,
      selection.name,
      `sync target ${selection.name} has no resolved database URL fallback`
    );
  }
  return fallback;
}

function pushTargetUrlDiagnostic(
  diagnostics: Diagnostic[],
  targetName: string,
  message: string
): void {
  diagnostics.push(
    diagnostic("SUPA_SYNC_TARGET_URL_UNRESOLVED", "error", message, {
      hint: `Resolve the database URL for sync target ${targetName}.`,
    })
  );
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

function isRemoteTargetName(
  target: Pick<SupaschemaConfig["sync"]["targets"][string], "remote">,
  name: string
): boolean {
  return name === "remote" || target.remote === true;
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
        "sync requires a database URL for verify before apply or dry-run completion",
        {
          hint: "Pass --database-url, select a target with databaseUrl/environment, set SUPASCHEMA_DATABASE_URL, or run inside a Supabase project with supabase/config.toml.",
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
    return options.target?.databaseUrl ?? resolveDatabaseUrl(options.options.databaseUrl);
  } catch (error) {
    options.diagnostics.push(
      diagnostic(
        "SUPA_SYNC_VERIFY_URL_UNRESOLVED",
        "error",
        error instanceof Error ? error.message : String(error),
        {
          hint: "Resolve the database URL used by sync verify before applying migrations.",
        }
      )
    );
    return;
  }
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hookProjectDir(payload: unknown): string {
  const record = asObject(payload);
  const cwdValue = property(record, "cwd");
  const cwd = typeof cwdValue === "string" && cwdValue.length > 0 ? cwdValue : undefined;
  return resolve(cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_PROJECT_DIR ?? ".");
}

function hookEditTargets(payload: unknown, projectDir: string): string[] {
  const record = asObject(payload);
  const toolNameValue = property(record, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = asObject(property(record, "tool_input"));
  if (isPatchTool(toolName)) {
    return hookPatchTargets(patchTextFromInput(input), projectDir);
  }
  const filePath = property(input, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [resolveHookTarget(projectDir, filePath)];
  }
  return [];
}

function generatedMigrationEditTargets(payload: unknown, projectDir: string): string[] {
  const record = asObject(payload);
  const toolNameValue = property(record, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = asObject(property(record, "tool_input"));
  if (isPatchTool(toolName)) {
    return generatedMigrationPatchTargets(patchTextFromInput(input), projectDir);
  }
  const filePath = property(input, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [resolveHookTarget(projectDir, filePath)];
  }
  return [];
}

function patchTextFromInput(input: object): string {
  const command = property(input, "command");
  if (typeof command === "string") {
    return command;
  }
  const patch = property(input, "patch");
  if (typeof patch === "string") {
    return patch;
  }
  const inputValue = property(input, "input");
  if (typeof inputValue === "string") {
    return inputValue;
  }
  return "";
}

function isPatchTool(toolName: string): boolean {
  return toolName === "apply_patch" || toolName === "functions.apply_patch";
}

function hookPatchTargets(patch: string, projectDir: string): string[] {
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    const target = hookPatchLineTarget(line, projectDir);
    if (target !== undefined) {
      out.push(target);
    }
  }
  return out;
}

function generatedMigrationPatchTargets(patchText: string, projectDir: string): string[] {
  const updates: string[] = [];
  const deletes: string[] = [];
  const adds = new Set<string>();
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      updates.push(resolveHookTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      deletes.push(resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      adds.add(resolveHookTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      updates.push(resolveHookTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  const rewrites = deletes.filter((path) => adds.has(path));
  return [...updates, ...adds, ...rewrites];
}

function hookPatchLineTarget(line: string, projectDir: string): string | undefined {
  if (line.startsWith(addHeader)) {
    return resolveHookTarget(projectDir, line.slice(addHeader.length).trim());
  }
  if (line.startsWith(deleteHeader)) {
    return resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim());
  }
  if (line.startsWith(updateHeader)) {
    return resolveHookTarget(projectDir, line.slice(updateHeader.length).trim());
  }
  if (line.startsWith(moveHeader)) {
    return resolveHookTarget(projectDir, line.slice(moveHeader.length).trim());
  }
  return;
}

function resolveHookTarget(projectDir: string, path: string): string {
  const normalized = slashPath(path);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(projectDir, normalized);
}

function changedSchemaTargets(
  paths: string[],
  schemaRoots: { display: string; root: string }[]
): { changed: string[]; groups: ChangedSchemaGroup[] } {
  const groups = new Map<string, ChangedSchemaGroup>();
  const changed: string[] = [];
  for (const path of paths) {
    if (!path.endsWith(".sql") || isGeneratedMigration(path)) {
      continue;
    }
    const matched = matchedSchemaRoot(path, schemaRoots);
    if (matched === undefined) {
      continue;
    }
    changed.push(path);
    const group = groups.get(matched.root) ?? { changed: [], display: matched.display };
    group.changed.push(path);
    groups.set(matched.root, group);
  }
  return { changed, groups: Array.from(groups.values()) };
}

function matchedSchemaRoot(
  path: string,
  schemaRoots: { display: string; root: string }[]
): { display: string; root: string } | undefined {
  const matches = schemaRoots.filter((entry) => isInside(entry.root, path));
  return matches.sort((left, right) => right.root.length - left.root.length)[0];
}

function migrationOutputs(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"))
    .map(slashPath);
}

function isGeneratedMigration(path: string): boolean {
  if (!path.endsWith(".sql")) {
    return false;
  }
  try {
    return readFileSync(path, "utf8").includes(lineageMarker);
  } catch {
    return false;
  }
}

function postToolUseHookOutput(
  additionalContext: string,
  control: { decision?: "block"; reason?: string } = {}
): AgentHookOutput {
  const output: AgentHookOutput = {
    hookSpecificOutput: { additionalContext, hookEventName: "PostToolUse" },
  };
  if (control.decision === "block" && typeof control.reason === "string") {
    output.decision = "block";
    output.reason = control.reason;
  }
  return output;
}

function readSchemaPathState(projectDir: string): SchemaPathState {
  const { environments, explicit, migrationsDir, schemaPaths, sourcesTo, sync, workflow } =
    readConfigPathFields(projectDir);
  const manifest = readInstallManifest(projectDir);
  if (
    manifest !== undefined &&
    property(manifest, "pathConfirmationNeeded") === true &&
    !explicit
  ) {
    const candidates = asObject(property(manifest, "candidates"));
    const candidateSchemaPaths = strings(property(candidates, "schemaPaths"));
    const candidateMigrationsDirs = strings(property(candidates, "migrationsDirs"));
    return {
      candidateMigrationsDirs,
      candidateSchemaPaths,
      confirmationSchemaPaths: uniqueStrings([...candidateSchemaPaths, ...schemaPaths]),
      environments,
      ...(migrationsDir === undefined ? {} : { migrationsDir }),
      pathConfirmationNeeded: true,
      schemaPaths,
      ...(sourcesTo === undefined ? {} : { sourcesTo }),
      sync,
      workflow,
    };
  }
  return {
    candidateMigrationsDirs: [],
    candidateSchemaPaths: [],
    confirmationSchemaPaths: schemaPaths,
    environments,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    pathConfirmationNeeded: false,
    schemaPaths,
    ...(sourcesTo === undefined ? {} : { sourcesTo }),
    sync,
    workflow,
  };
}

function readConfigPathFields(projectDir: string): {
  environments: Record<string, { databaseUrl: string }>;
  explicit: boolean;
  migrationsDir?: string;
  schemaPaths: string[];
  sourcesTo?: string;
  sync: { targets: Record<string, HookSyncTarget> };
  workflow: SupaschemaConfig["workflow"];
} {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    return resolveConfigPathFields(JSON.parse(readFileSync(jsonPath, "utf8")), projectDir);
  }
  return {
    environments: {},
    explicit: false,
    schemaPaths: [defaultSchemaPath(projectDir)],
    sync: { targets: {} },
    workflow: resolveConfig().workflow,
  };
}

function resolveConfigPathFields(
  config: unknown,
  projectDir: string
): {
  environments: Record<string, { databaseUrl: string }>;
  explicit: boolean;
  migrationsDir?: string;
  schemaPaths: string[];
  sourcesTo?: string;
  sync: { targets: Record<string, HookSyncTarget> };
  workflow: SupaschemaConfig["workflow"];
} {
  const record = asObject(config);
  const explicitSchemaPaths = schemaPathsFromConfig(record);
  const migrationsDirValue = property(record, "migrationsDir");
  const migrationsDir =
    typeof migrationsDirValue === "string" && migrationsDirValue.length > 0
      ? migrationsDirValue
      : undefined;
  const sources = asObject(property(record, "sources"));
  const sourcesToValue = property(sources, "to");
  const sourcesTo =
    typeof sourcesToValue === "string" && sourcesToValue.length > 0 ? sourcesToValue : undefined;
  return {
    environments: environmentsFromConfig(record),
    explicit:
      explicitSchemaPaths !== undefined && migrationsDir !== undefined && sourcesTo !== undefined,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    schemaPaths: explicitSchemaPaths ?? [defaultSchemaPath(projectDir)],
    ...(sourcesTo === undefined ? {} : { sourcesTo }),
    sync: syncFromHookConfig(record),
    workflow: resolveConfig({
      workflow: asObject(property(record, "workflow")),
    }).workflow,
  };
}

function readInstallManifest(projectDir: string): object | undefined {
  const path = join(projectDir, ".supaschema", "install.json");
  if (!existsSync(path)) {
    return;
  }
  try {
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return;
  }
}

function schemaPathsFromConfig(config: object): string[] | undefined {
  const schemaPaths = property(config, "schemaPaths");
  if (Array.isArray(schemaPaths) && schemaPaths.length > 0) {
    return schemaPaths.map(String);
  }
  return;
}

function environmentsFromConfig(config: object): Record<string, { databaseUrl: string }> {
  const configured = asObject(property(config, "environments"));
  const environments: Record<string, { databaseUrl: string }> = {};
  for (const [name, value] of Object.entries(configured)) {
    const record = asObject(value);
    const databaseUrl = property(record, "databaseUrl");
    if (typeof databaseUrl === "string" && databaseUrl !== "") {
      environments[name] = { databaseUrl };
    }
  }
  return environments;
}

function syncFromHookConfig(config: object): {
  targets: Record<string, HookSyncTarget>;
} {
  const sync = asObject(property(config, "sync"));
  const configured = asObject(property(sync, "targets"));
  const targets: Record<string, HookSyncTarget> = {};
  for (const [name, value] of Object.entries(configured)) {
    const record = asObject(value);
    if (Object.keys(record).length === 0) {
      continue;
    }
    const target: HookSyncTarget = {
      mode: hookTargetMode(property(record, "mode")),
      runner: hookTargetRunner(property(record, "runner")),
    };
    const databaseUrl = property(record, "databaseUrl");
    if (typeof databaseUrl === "string" && databaseUrl !== "") {
      target.databaseUrl = databaseUrl;
    }
    const environment = property(record, "environment");
    if (typeof environment === "string" && environment !== "") {
      target.environment = environment;
    }
    const requireApprovalEnv = property(record, "requireApprovalEnv");
    if (typeof requireApprovalEnv === "string" && requireApprovalEnv !== "") {
      target.requireApprovalEnv = requireApprovalEnv;
    }
    if (property(record, "remote") === true) {
      target.remote = true;
    }
    targets[name] = target;
  }
  return { targets };
}

function hookTargetMode(value: unknown): HookSyncTarget["mode"] {
  return value === "auto" ? "auto" : "manual";
}

function hookTargetRunner(value: unknown): HookSyncTarget["runner"] {
  return value === "supabase-cli" ? "supabase-cli" : "direct";
}

function automaticSyncPlan(pathState: SchemaPathState): AutomaticSyncPlan {
  const policy = pathState.workflow.migration_sync;
  if (policy !== "auto") {
    return {
      enabled: false,
      reason: `workflow.migration_sync is "${policy}"`,
    };
  }
  const selected = automaticSyncTargets(pathState.sync.targets);
  if (selected.length === 0) {
    return {
      enabled: false,
      reason: 'no configured sync target is mode "auto"',
    };
  }
  if (selected.length > 1) {
    return {
      enabled: false,
      reason: `multiple auto sync targets selected (${selected.map(([name]) => name).join(", ")}); run supaschema sync --target <name> for one target at a time`,
    };
  }
  const blockers: string[] = [];
  for (const [name, target] of selected) {
    const url = target.databaseUrl ?? pathState.environments[target.environment ?? ""]?.databaseUrl;
    const urlBlocker = unresolvedSyncUrlReason(name, target, url);
    if (urlBlocker !== undefined) {
      blockers.push(urlBlocker);
    }
    if (isRemoteSyncTarget(name, target)) {
      const approval = target.requireApprovalEnv;
      if (typeof approval !== "string" || approval.length === 0) {
        blockers.push(`remote sync target ${name} does not declare requireApprovalEnv`);
      } else if (process.env[approval] !== "1") {
        blockers.push(`remote sync target ${name} requires ${approval}=1`);
      }
    }
  }
  if (blockers.length > 0) {
    return {
      enabled: false,
      reason: blockers.join("; "),
    };
  }
  return {
    enabled: true,
    line: `Automatic sync target preflight passed for ${selected.map(([name]) => name).join(", ")}`,
  };
}

function automaticSyncTargets(targets: Record<string, HookSyncTarget>): [string, HookSyncTarget][] {
  return Object.entries(targets).filter(([, target]) => target.mode === "auto");
}

function unresolvedUrlReason(name: string, value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return `sync target ${name} has no resolvable database URL`;
  }
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    if (envName === "" || typeof process.env[envName] !== "string" || process.env[envName] === "") {
      return `sync target ${name} requires ${value}`;
    }
  }
  return;
}

function unresolvedSyncUrlReason(
  name: string,
  target: HookSyncTarget,
  value: string | undefined
): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return unresolvedUrlReason(name, value);
  }
  if (target.runner === "supabase-cli") {
    return;
  }
  if (isRemoteSyncTarget(name, target)) {
    return `sync target ${name} has no resolvable database URL`;
  }
  return resolveDatabaseUrl() === undefined
    ? `sync target ${name} has no resolvable database URL`
    : undefined;
}

function isRemoteSyncTarget(name: string, target: Pick<HookSyncTarget, "remote">): boolean {
  return name === "remote" || target.remote === true;
}

function runConfiguredHookCheck(
  bin: HookCommand,
  projectDir: string,
  workflow: SupaschemaConfig["workflow"],
  migrationPaths: string[]
): HookCheckResult {
  if (
    workflow.migration_check !== "after_schema_diff" &&
    workflow.migration_check !== "required_before_complete"
  ) {
    return {
      line: `supaschema check skipped because workflow.migration_check is "${workflow.migration_check}"`,
      passed: true,
    };
  }
  const check = runHookCommand(bin, ["check", ...migrationPaths], projectDir);
  const diagnostics = head(check.stderr || check.stdout);
  const checked = migrationPaths.join(", ");
  return check.code === 0
    ? {
        line:
          migrationPaths.length > 1
            ? `supaschema check passed for generated migrations: ${checked}`
            : `supaschema check passed for generated migration: ${checked}`,
        passed: true,
      }
    : {
        diagnostics,
        line: `supaschema check reported diagnostics:\n${diagnostics}`,
        passed: false,
      };
}

function runConfiguredHookVerify(
  bin: HookCommand,
  projectDir: string,
  workflow: SupaschemaConfig["workflow"],
  checkPassed: boolean
): string {
  if (workflow.migration_verify !== "after_schema_diff") {
    return "";
  }
  if (!checkPassed) {
    return "supaschema verify skipped because check did not pass";
  }
  const verify = runHookCommand(bin, ["verify"], projectDir);
  return verify.code === 0
    ? "supaschema verify passed"
    : `supaschema verify reported diagnostics:\n${head(verify.stderr || verify.stdout)}`;
}

function defaultSchemaPath(projectDir: string): string {
  const files = walkFiles(projectDir, 5);
  const matched = providerSchemaMarkers.find((provider) =>
    provider.markers.some((marker) => providerMarkerMatches(projectDir, files, marker))
  );
  return matched?.schemaPath ?? genericSchemaPath;
}

function providerMarkerMatches(
  projectDir: string,
  files: string[],
  marker: {
    readonly contentTerms?: readonly string[];
    readonly fileNames?: readonly string[];
    readonly path?: string;
  }
): boolean {
  if (typeof marker.path === "string") {
    const absolute = join(projectDir, marker.path);
    return (
      existsSync(absolute) &&
      (!marker.contentTerms || fileContainsAny(absolute, marker.contentTerms))
    );
  }
  return files.some((file) => {
    const name = basenameForAnyPlatform(file);
    return (
      (marker.fileNames ?? []).some((pattern) => fileNameMatches(pattern, name)) &&
      (!marker.contentTerms || fileContainsAny(file, marker.contentTerms))
    );
  });
}

function stripSqlExtension(value: string): string {
  return value.endsWith(".sql") ? value.slice(0, -4) : value;
}

function basenameForAnyPlatform(value: string): string {
  const forward = value.lastIndexOf("/");
  const backward = value.lastIndexOf("\\");
  const index = Math.max(forward, backward);
  return index === -1 ? value : value.slice(index + 1);
}

function walkFiles(projectDir: string, maxDepth: number): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) {
      return;
    }
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          visit(join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        out.push(join(dir, entry.name));
      }
    }
  };
  visit(projectDir, 1);
  return out;
}

function shouldSkipDir(name: string): boolean {
  return new Set([
    ".git",
    ".next",
    ".nuxt",
    ".supaschema",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]).has(name);
}

function fileNameMatches(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === name;
  }
  const [prefix = "", suffix = ""] = pattern.split("*");
  return name.startsWith(prefix) && name.endsWith(suffix);
}

function fileContainsAny(path: string, terms: readonly string[]): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return terms.some((term) => content.includes(term));
  } catch {
    return false;
  }
}

function pathConfirmationMessage(
  projectDir: string,
  changed: string[],
  state: SchemaPathState
): string {
  const schemaCandidates =
    state.candidateSchemaPaths.length > 0 ? state.candidateSchemaPaths.join(", ") : "(none)";
  const migrationCandidates =
    state.candidateMigrationsDirs.length > 0 ? state.candidateMigrationsDirs.join(", ") : "(none)";
  return `supaschema auto-diff skipped for ${changed
    .map((path) => rel(projectDir, path))
    .join(
      ", "
    )} because path confirmation is pending from install. Inspect .supaschema/install.json, ask the user which schemaPaths, sources.to, and migrationsDir to use, update supaschema.config.json, then run \`supaschema diff\` and \`supaschema check\`. Candidate schema paths: ${schemaCandidates}. Candidate migrations dirs: ${migrationCandidates}.`;
}

function checkFailureLoopReason(
  projectDir: string,
  changed: string[],
  checkResult: HookCheckResult
): string {
  const changedList = changed.map((path) => rel(projectDir, path)).join(", ");
  const diagnostics =
    typeof checkResult.diagnostics === "string" && checkResult.diagnostics.length > 0
      ? `\n\nDiagnostics:\n${checkResult.diagnostics}`
      : "";
  return `supaschema check failed after editing ${changedList}. Continue the agent loop now: inspect the reported SUPA_* diagnostics, identify the canonical root source in the declarative schema tree or generated migration chain, search the migrations directory for similar or correlated failures, fix the canonical source instead of hand-editing generated lineage migrations, regenerate with \`supaschema diff\` when the tree changes, rerun \`supaschema check\`, and keep iterating until check passes or report the exact blocker. Do not apply migrations outside a config-gated \`supaschema sync\` workflow or explicit user request.${diagnostics}`;
}

function syncFailureLoopReason(projectDir: string, changed: string[], diagnostics: string): string {
  const changedList = changed.map((path) => rel(projectDir, path)).join(", ");
  const diagnosticText =
    typeof diagnostics === "string" && diagnostics.length > 0
      ? `\n\nDiagnostics:\n${diagnostics}`
      : "";
  return `supaschema sync failed after editing ${changedList}. Continue the agent loop now: inspect the reported SUPA_* diagnostics, fix the canonical schema/config/migration source, rerun \`supaschema sync\`, and keep iterating until the ordered source, diff, target-selection, history, check, generated-contract, stage, safety, verify, runner, and reconciliation lanes pass or report the exact blocker.${diagnosticText}`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveHookBinary(projectDir: string): HookCommand {
  const local = join(projectDir, "node_modules", ".bin", "supaschema");
  if (existsSync(local)) {
    return { args: [], cmd: local };
  }
  if (process.env.SUPASCHEMA_HOOK_BIN) {
    return hookScriptCommand(process.env.SUPASCHEMA_HOOK_BIN);
  }
  return { args: ["--no-install", "supaschema"], cmd: "npx" };
}

function hookScriptCommand(path: string): HookCommand {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".js") || lowered.endsWith(".mjs") || lowered.endsWith(".cjs")) {
    return { args: [path], cmd: process.execPath };
  }
  return { args: [], cmd: path };
}

function runHookCommand(bin: HookCommand, args: string[], cwd: string): HookCommandResult {
  try {
    const stdout = execFileSync(bin.cmd, [...bin.args, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { code: 0, stderr: "", stdout };
  } catch (error) {
    const record = asObject(error);
    const status = property(record, "status");
    const stderr = property(record, "stderr");
    const stdout = property(record, "stdout");
    return {
      code: typeof status === "number" ? status : 1,
      stderr: typeof stderr === "string" ? stderr : "",
      stdout: typeof stdout === "string" ? stdout : "",
    };
  }
}

function isInside(dir: string, file: string): boolean {
  const relPath = relative(dir, file);
  return relPath !== "" && !relPath.startsWith("..") && !isAbsolute(relPath);
}

function rel(projectDir: string, path: string): string {
  const relPath = relative(projectDir, path);
  return slashPath(relPath.startsWith("..") ? path : relPath);
}

function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function head(text: string): string {
  return redactSecrets(text || "")
    .trim()
    .split("\n")
    .slice(0, 12)
    .join("\n");
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function asObject(value: unknown): object {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
