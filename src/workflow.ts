import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { checkMigrationSql } from "./check.js";
import { defaultMigrationName } from "./cli-defaults.js";
import { resolveConfig } from "./config.js";
import type { Diagnostic, SupaschemaConfig } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { latestLineage } from "./lineage.js";
import {
  type MigrationRunnerKind,
  type MigrationRunnerResult,
  runDirectMigrationRunner,
  runSupabaseCliMigrationRunner,
  type SupabaseCliOperation,
} from "./migration-runners.js";
import { migrationsStatus, renderMigrationsStatus } from "./migrations-status.js";
import {
  buildSchemaDiffPlan,
  refreshGeneratedOutputs,
  runRlsSafetyGate,
  runTypeSafetyGate,
} from "./pipeline-services.js";
import { redactSecrets } from "./redaction.js";
import { renderMigrationSplit } from "./render.js";

export interface SyncOptions {
  cliVersion?: string;
  config?: Partial<SupaschemaConfig>;
  databaseUrl?: string;
  directory: string;
  envName?: string;
  from?: string;
  historyTable?: string;
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

const editTools = new Set(["Edit", "MultiEdit", "Write", "edit_file", "apply_patch"]);
const lineageMarker = "-- supaschema: lineage ";
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";
const genericSchemaPath = "database/schemas";
const supabaseSchemaPath = "supabase/schemas";
const providerSchemaMarkers = [
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
] as const;

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
            )} through \`supaschema sync\`. ${autoSync.line}. The sync pipeline generated the schema diff, refreshed generated outputs per config, ran type/RLS safety gates, applied configured targets, and reconciled target migration history.`
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
  const checkResult = runConfiguredHookCheck(bin, projectDir, pathState.workflow);
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
    .join(", ")}. ${generatedOutputLine(pathState.workflow)}. ${checkResult.line}${
    verifyLine === "" ? "" : `. ${verifyLine}`
  }. Automatic sync skipped: ${autoSync.reason}. Commit the tree change, the migration, and any refreshed generated outputs together before a later apply.`;
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
  const config = resolveConfig(options.config);
  const diagnostics: Diagnostic[] = [];
  const disabledResult = disabledSyncResult(options, config, diagnostics);
  if (disabledResult !== undefined) {
    return disabledResult;
  }
  const pipelineLines: string[] = [];
  if (options.pipeline === true) {
    const pipelineResult = await runPipelineStages(options, config, diagnostics, pipelineLines);
    if (pipelineResult !== undefined) {
      return pipelineResult;
    }
    const targetResult = await runConfiguredTargets(options, config, diagnostics, pipelineLines);
    if (targetResult !== undefined) {
      return targetResult;
    }
  }
  const selectedRunner = options.runner ?? "supabase-cli";
  const status = await loadSyncStatus(options, selectedRunner);
  diagnostics.push(...status.diagnostics);
  const lines: string[] = [...pipelineLines, renderMigrationsStatus(status.report).trimEnd()];
  if (hasErrors(status.diagnostics)) {
    lines.push("refusing to sync: resolve ghost or out-of-order history first");
    return {
      applied: false,
      diagnostics,
      pending: status.report.pending,
      report: render(lines),
    };
  }
  if (status.report.pending.length === 0) {
    lines.push("nothing to sync: disk and target history match");
    return { applied: false, diagnostics, pending: [], report: render(lines) };
  }
  const checkResult = await checkPendingMigrations(
    options.directory,
    status.report.pending,
    config,
    diagnostics,
    lines
  );
  if (checkResult !== undefined) {
    return checkResult;
  }
  if (options.target === undefined) {
    lines.push(
      `dry run: no sync target was selected by config; set sync.targets.<name>.mode to "auto", or pass --target <name> as an override to apply ${status.report.pending.length} pending migration(s) with the configured runner`
    );
    return {
      applied: false,
      diagnostics,
      pending: status.report.pending,
      report: render(lines),
    };
  }
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_TARGET_UNKNOWN",
      "error",
      `sync target "${options.target}" is not configured`,
      { hint: "Add sync.targets.<name> to supaschema.config.json." }
    )
  );
  lines.push("refusing to sync: target resolution failed");
  return {
    applied: false,
    diagnostics,
    pending: status.report.pending,
    report: render(lines),
  };
}

function disabledSyncResult(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[]
): SyncResult | undefined {
  if (options.target === undefined || config.workflow.migration_sync !== "disabled") {
    return;
  }
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_DISABLED",
      "error",
      'workflow.migration_sync is "disabled"; change it to an apply-enabled sync policy before sync can apply migrations.',
      {
        hint: 'Use workflow.migration_sync: "auto" and set sync.targets.<name>.mode to "auto" for the standard bare supaschema sync path.',
      }
    )
  );
  return {
    applied: false,
    diagnostics,
    pending: [],
    report:
      'refusing to sync: workflow.migration_sync is "disabled"; no apply handoff was attempted\n',
  };
}

async function runPipelineStages(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult | undefined> {
  if (options.skipDiff !== true) {
    const diffResult = await runSyncDiffStage(options, config, diagnostics, lines);
    if (diffResult !== undefined) {
      return diffResult;
    }
  }
  const gateResult = await runSyncSafetyGates(options, config, diagnostics, lines);
  if (gateResult !== undefined) {
    return gateResult;
  }
  return;
}

async function runSyncDiffStage(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult | undefined> {
  const from = options.from ?? config.sources.from;
  const to = options.to ?? config.sources.to;
  const plan = await buildSchemaDiffPlan({ config, from, to });
  diagnostics.push(...plan.diagnostics);
  if (hasErrors(plan.diagnostics)) {
    lines.push("refusing to sync: schema diff has blocking diagnostics");
    return { applied: false, diagnostics, pending: [], report: render(lines) };
  }
  await refreshGeneratedOutputs({ config, toSource: to });
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
    lines.push("refusing to sync: pending supaschema migration lineage is not contiguous");
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

async function runSyncSafetyGates(
  options: SyncOptions,
  config: SupaschemaConfig,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult | undefined> {
  const fromSource = options.from ?? config.sources.from;
  const toSource = options.to ?? config.sources.to;
  const typeGate = await runTypeSafetyGate({
    config,
    fromSource,
    toSource,
  });
  const rlsGate = await runRlsSafetyGate({
    config,
    source: toSource,
  });
  diagnostics.push(...typeGate.diagnostics, ...rlsGate.diagnostics);
  if (typeGate.blocked || rlsGate.blocked) {
    lines.push("refusing to sync: deploy safety gates failed");
    return { applied: false, diagnostics, pending: [], report: render(lines) };
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
  prefixLines: string[]
): Promise<SyncResult | undefined> {
  const resolved = resolveSyncTargets(options, config);
  diagnostics.push(...resolved.diagnostics);
  if (hasErrors(resolved.diagnostics)) {
    return {
      applied: false,
      diagnostics,
      pending: [],
      report: "refusing to sync: target resolution failed\n",
    };
  }
  if (resolved.targets.length === 0) {
    return;
  }
  const lines: string[] = [...prefixLines];
  const allPending = new Set<string>();
  let applied = false;
  for (const target of resolved.targets) {
    const targetResult = await runOneTarget(options, config, target, diagnostics, lines);
    for (const file of targetResult.pending) {
      allPending.add(file);
    }
    if (!targetResult.applied || hasErrors(diagnostics)) {
      return {
        applied,
        diagnostics,
        pending: [...allPending].sort(),
        report: render(lines),
      };
    }
    applied = true;
  }
  return {
    applied,
    diagnostics,
    pending: [...allPending].sort(),
    report: render(lines),
  };
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
        `sync target "${selection.name}" is not configured`,
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
      const env = config.environments[options.envName];
      if (env === undefined) {
        diagnostics.push(
          diagnostic("SUPA_SYNC_ENV_UNKNOWN", "error", `--env "${options.envName}" is not defined`)
        );
        return;
      }
      return resolveDatabaseUrl(env.databaseUrl);
    }
    const value = target.databaseUrl ?? config.environments[target.environment ?? ""]?.databaseUrl;
    return value === undefined ? undefined : resolveDatabaseUrl(value);
  } catch (error) {
    if (selection.automatic || runner === "direct") {
      diagnostics.push(
        diagnostic(
          "SUPA_SYNC_TARGET_URL_UNRESOLVED",
          "error",
          error instanceof Error ? error.message : String(error),
          { hint: `Resolve the database URL for sync target ${selection.name}.` }
        )
      );
    }
    return;
  }
}

async function runOneTarget(
  options: SyncOptions,
  config: SupaschemaConfig,
  target: ResolvedSyncTarget,
  diagnostics: Diagnostic[],
  lines: string[]
): Promise<SyncResult> {
  const status = await migrationsStatus({
    allowMissingHistoryTable: target.runner === "direct",
    directory: options.directory,
    ...(target.databaseUrl === undefined ? {} : { databaseUrl: target.databaseUrl }),
    historyTable: target.historyTable,
    runnerLabel: target.runner,
    targetLabel: target.name,
  });
  diagnostics.push(...status.diagnostics);
  lines.push(renderMigrationsStatus(status.report).trimEnd());
  if (hasErrors(status.diagnostics)) {
    lines.push(`refusing to sync ${target.name}: resolve ghost or out-of-order history first`);
    return { applied: false, diagnostics, pending: status.report.pending, report: render(lines) };
  }
  if (status.report.pending.length === 0) {
    lines.push(`nothing to sync on ${target.name}: disk and target history match`);
    return { applied: true, diagnostics, pending: [], report: render(lines) };
  }
  const checkResult = await checkPendingMigrations(
    options.directory,
    status.report.pending,
    config,
    diagnostics,
    lines
  );
  if (checkResult !== undefined) {
    return checkResult;
  }
  const outcome = await runTargetRunner(options, config, target, status.report.pending);
  lines.push(`running: ${outcome.displayCommand ?? target.runner}`);
  const failure = runnerFailureResult(
    outcome,
    target.runner,
    status.report.pending,
    diagnostics,
    lines
  );
  if (failure !== undefined) {
    return failure;
  }
  const finalStatus = await migrationsStatus({
    allowMissingHistoryTable: target.runner === "direct",
    directory: options.directory,
    ...(target.databaseUrl === undefined ? {} : { databaseUrl: target.databaseUrl }),
    expectedAppliedVersions: status.report.expectedAppliedVersions,
    historyTable: target.historyTable,
    runnerLabel: target.runner,
    targetLabel: target.name,
  });
  diagnostics.push(...finalStatus.diagnostics);
  if (
    hasErrors(finalStatus.diagnostics) ||
    finalStatus.report.pending.length > 0 ||
    finalStatus.report.missingExpectedVersions.length > 0
  ) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_FINAL_RECONCILE_FAILED",
        "error",
        `target ${target.name} did not reconcile after runner completed`,
        { hint: "Inspect pending and missing expected migration versions in the sync report." }
      )
    );
    lines.push(renderMigrationsStatus(finalStatus.report).trimEnd());
    return {
      applied: false,
      diagnostics,
      pending: finalStatus.report.pending,
      report: render(lines),
    };
  }
  lines.push(renderMigrationsStatus(finalStatus.report).trimEnd());
  return { applied: true, diagnostics, pending: [], report: render(lines) };
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
  lines: string[]
): Promise<SyncResult | undefined> {
  for (const file of pending) {
    const sql = await readFile(join(directory, file), "utf8");
    const checkDiagnostics = await checkMigrationSql(sql, { config });
    const errors = checkDiagnostics.filter((item) => item.severity === "error");
    diagnostics.push(...errors);
    if (errors.length > 0) {
      lines.push(`refusing to sync: ${file} fails the replay-safety check`);
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

function hookProjectDir(payload: unknown): string {
  const record = asRecord(payload);
  const cwd = typeof record.cwd === "string" && record.cwd.length > 0 ? record.cwd : undefined;
  return resolve(cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_PROJECT_DIR ?? ".");
}

function hookEditTargets(payload: unknown, projectDir: string): string[] {
  const record = asRecord(payload);
  const toolName = typeof record.tool_name === "string" ? record.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = asRecord(record.tool_input);
  if (toolName === "apply_patch") {
    return hookPatchTargets(patchTextFromInput(input), projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [resolveHookTarget(projectDir, input.file_path)];
  }
  return [];
}

function generatedMigrationEditTargets(payload: unknown, projectDir: string): string[] {
  const record = asRecord(payload);
  const toolName = typeof record.tool_name === "string" ? record.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = asRecord(record.tool_input);
  if (toolName === "apply_patch") {
    return generatedMigrationPatchTargets(patchTextFromInput(input), projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [resolveHookTarget(projectDir, input.file_path)];
  }
  return [];
}

function patchTextFromInput(input: Record<string, unknown>): string {
  if (typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.patch === "string") {
    return input.patch;
  }
  if (typeof input.input === "string") {
    return input.input;
  }
  return "";
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
    return resolve(projectDir, line.slice(addHeader.length).trim());
  }
  if (line.startsWith(deleteHeader)) {
    return resolve(projectDir, line.slice(deleteHeader.length).trim());
  }
  if (line.startsWith(updateHeader)) {
    return resolve(projectDir, line.slice(updateHeader.length).trim());
  }
  if (line.startsWith(moveHeader)) {
    return resolve(projectDir, line.slice(moveHeader.length).trim());
  }
  return;
}

function resolveHookTarget(projectDir: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
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
    .filter((line) => line.endsWith(".sql"));
}

function isGeneratedMigration(path: string): boolean {
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
  if (manifest?.pathConfirmationNeeded === true && !explicit) {
    const candidates = asRecord(manifest.candidates);
    const candidateSchemaPaths = strings(candidates.schemaPaths);
    const candidateMigrationsDirs = strings(candidates.migrationsDirs);
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
  const record = asRecord(config);
  const explicitSchemaPaths = schemaPathsFromConfig(record);
  const migrationsDir =
    typeof record.migrationsDir === "string" && record.migrationsDir.length > 0
      ? record.migrationsDir
      : undefined;
  const sources = asRecord(record.sources);
  const sourcesTo =
    typeof sources.to === "string" && sources.to.length > 0 ? sources.to : undefined;
  return {
    environments: environmentsFromConfig(record),
    explicit:
      explicitSchemaPaths !== undefined && migrationsDir !== undefined && sourcesTo !== undefined,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    schemaPaths: explicitSchemaPaths ?? [defaultSchemaPath(projectDir)],
    ...(sourcesTo === undefined ? {} : { sourcesTo }),
    sync: syncFromHookConfig(record),
    workflow: resolveConfig({
      workflow: asRecord(record.workflow) as Partial<SupaschemaConfig["workflow"]>,
    } as Partial<SupaschemaConfig>).workflow,
  };
}

function readInstallManifest(projectDir: string): Record<string, unknown> | undefined {
  const path = join(projectDir, ".supaschema", "install.json");
  if (!existsSync(path)) {
    return;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
}

function schemaPathsFromConfig(config: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(config.schemaPaths) && config.schemaPaths.length > 0) {
    return config.schemaPaths.map(String);
  }
  return;
}

function environmentsFromConfig(
  config: Record<string, unknown>
): Record<string, { databaseUrl: string }> {
  const configured = asRecord(config.environments);
  const environments: Record<string, { databaseUrl: string }> = {};
  for (const [name, value] of Object.entries(configured)) {
    const record = asRecord(value);
    if (typeof record.databaseUrl === "string" && record.databaseUrl !== "") {
      environments[name] = { databaseUrl: record.databaseUrl };
    }
  }
  return environments;
}

function syncFromHookConfig(config: Record<string, unknown>): {
  targets: Record<string, HookSyncTarget>;
} {
  const sync = asRecord(config.sync);
  const configured = asRecord(sync.targets);
  const targets: Record<string, HookSyncTarget> = {};
  for (const [name, value] of Object.entries(configured)) {
    const record = asRecord(value);
    if (Object.keys(record).length === 0) {
      continue;
    }
    const target: HookSyncTarget = {
      mode: enumValue(record.mode, ["manual", "auto"], "manual"),
      runner: enumValue(record.runner, ["direct", "supabase-cli"], "direct"),
    };
    if (typeof record.databaseUrl === "string" && record.databaseUrl !== "") {
      target.databaseUrl = record.databaseUrl;
    }
    if (typeof record.environment === "string" && record.environment !== "") {
      target.environment = record.environment;
    }
    if (typeof record.requireApprovalEnv === "string" && record.requireApprovalEnv !== "") {
      target.requireApprovalEnv = record.requireApprovalEnv;
    }
    if (record.remote === true) {
      target.remote = true;
    }
    targets[name] = target;
  }
  return { targets };
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
  const blockers: string[] = [];
  for (const [name, target] of selected) {
    const url = target.databaseUrl ?? pathState.environments[target.environment ?? ""]?.databaseUrl;
    const urlBlocker = unresolvedUrlReason(name, url);
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

function isRemoteSyncTarget(name: string, target: Pick<HookSyncTarget, "remote">): boolean {
  return name === "remote" || target.remote === true;
}

function runConfiguredHookCheck(
  bin: HookCommand,
  projectDir: string,
  workflow: SupaschemaConfig["workflow"]
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
  const check = runHookCommand(bin, ["check"], projectDir);
  const diagnostics = head(check.stderr || check.stdout);
  return check.code === 0
    ? { line: "supaschema check passed (replay-safe)", passed: true }
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

function generatedOutputLine(workflow: SupaschemaConfig["workflow"]): string {
  return `Generated output policy: workflow.type_generation=${workflow.type_generation}, workflow.zod_generation=${workflow.zod_generation}, workflow.type_usage=${workflow.type_usage}`;
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
  return `supaschema sync failed after editing ${changedList}. Continue the agent loop now: inspect the reported SUPA_* diagnostics, fix the canonical schema/config/migration source, rerun \`supaschema sync\`, and keep iterating until the diff, generated outputs, type/RLS safety gates, apply runner, and target reconciliation pass or report the exact blocker.${diagnosticText}`;
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
    return { args: [], cmd: process.env.SUPASCHEMA_HOOK_BIN };
  }
  return { args: ["--no-install", "supaschema"], cmd: "npx" };
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
    return {
      code:
        typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : 1,
      stderr:
        typeof (error as { stderr?: unknown }).stderr === "string"
          ? (error as { stderr: string }).stderr
          : "",
      stdout:
        typeof (error as { stdout?: unknown }).stdout === "string"
          ? (error as { stdout: string }).stdout
          : "",
    };
  }
}

function isInside(dir: string, file: string): boolean {
  const relPath = relative(dir, file);
  return relPath !== "" && !relPath.startsWith("..") && !isAbsolute(relPath);
}

function rel(projectDir: string, path: string): string {
  const relPath = relative(projectDir, path);
  return relPath.startsWith("..") ? path : relPath;
}

function head(text: string): string {
  return redactSecrets(text || "")
    .trim()
    .split("\n")
    .slice(0, 12)
    .join("\n");
}

function enumValue<const T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
