import { defaultMigrationHistoryTable } from "../config/contract.js";
import type { Diagnostic, SupaschemaConfig } from "../core.js";
import { resolveDatabaseUrl } from "../database/url.js";
import { diagnostic } from "../diagnostics.js";
import type { MigrationRunnerKind, SupabaseCliOperation } from "../migrations/runners.js";
import type { SyncOptions } from "./sync.js";

export function operationName(options: Pick<SyncOptions, "operation">): "apply" | "sync" {
  return options.operation ?? "sync";
}

export function operationTargetLabel(options: Pick<SyncOptions, "operation">): string {
  return operationName(options) === "apply" ? "apply target" : "sync target";
}

export interface ResolvedSyncTarget {
  automatic: boolean;
  databaseUrl?: string;
  databaseUrlAutoDiscovered?: true;
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

export function resolveSyncTargets(
  options: SyncOptions,
  config: SupaschemaConfig
): { diagnostics: Diagnostic[]; targets: ResolvedSyncTarget[] } {
  const diagnostics: Diagnostic[] = [];
  const selected = selectedTargetNames(options, config);
  if (selected.length === 0) {
    const adHoc = adHocDirectApplyTarget(options, diagnostics);
    return { diagnostics, targets: adHoc === undefined ? [] : [adHoc] };
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
    remote &&
    configured.requireApprovalEnv !== undefined &&
    process.env[configured.requireApprovalEnv] !== "1"
  ) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_REMOTE_APPROVAL_REQUIRED",
        "error",
        `remote ${operationName(options)} target ${selection.name} requires ${configured.requireApprovalEnv}=1 before deploy`,
        { hint: "Set the approval environment variable in an operator-controlled process." }
      )
    );
  }
  const target: ResolvedSyncTarget = {
    automatic: selection.automatic,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    historyTable: options.historyTable ?? configured.historyTable,
    name: selection.name,
    operation: remote ? "remote" : "local",
    remote,
    runner,
  };
  if (usesDefaultDatabaseUrl(configured, options, remote)) {
    target.databaseUrlAutoDiscovered = true;
  }
  return target;
}

function usesDefaultDatabaseUrl(
  target: SupaschemaConfig["sync"]["targets"][string],
  options: SyncOptions,
  remote: boolean
): boolean {
  return (
    !remote &&
    options.databaseUrl === undefined &&
    options.envName === undefined &&
    target.databaseUrl === undefined &&
    target.environment === undefined
  );
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
      return resolveMissingTargetUrl(selection, target, diagnostics);
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
  diagnostics: Diagnostic[]
): string | undefined {
  if (target.environment !== undefined) {
    pushTargetUrlDiagnostic(
      diagnostics,
      selection.name,
      `sync target ${selection.name} references unknown environment "${target.environment}"`
    );
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

function isRemoteTargetName(
  target: Pick<SupaschemaConfig["sync"]["targets"][string], "remote">,
  name: string
): boolean {
  return name === "remote" || target.remote === true;
}

function adHocDirectApplyTarget(
  options: SyncOptions,
  diagnostics: Diagnostic[]
): ResolvedSyncTarget | undefined {
  if (
    options.operation !== "apply" ||
    options.runner !== "direct" ||
    options.databaseUrl === undefined ||
    options.target !== undefined
  ) {
    return;
  }
  let databaseUrl: string | undefined;
  try {
    databaseUrl = resolveDatabaseUrl(options.databaseUrl);
  } catch (error) {
    databaseUrl = undefined;
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_TARGET_URL_UNRESOLVED",
        "error",
        error instanceof Error ? error.message : String(error),
        { hint: "Resolve the database URL passed to --database-url." }
      )
    );
  }
  if (databaseUrl === undefined) {
    return;
  }
  return {
    automatic: false,
    databaseUrl,
    historyTable: options.historyTable ?? defaultMigrationHistoryTable,
    name: "direct",
    operation: "local",
    remote: false,
    runner: "direct",
  };
}
