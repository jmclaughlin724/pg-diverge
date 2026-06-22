import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { resolveConfig } from "./config.js";
import type { SupaschemaConfig } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { lineagePrefix } from "./lineage.js";
import { pathContainsOrEqual } from "./paths.js";
import { redactSecrets } from "./redaction.js";

const editTools = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "edit_file",
  "apply_patch",
  "functions.apply_patch",
]);
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";
const genericSchemaPath = "database/schemas";
const supabaseSchemaPath = "supabase/schemas";
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
  const matches = schemaRoots.filter((entry) => pathContainsOrEqual(entry.root, path));
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
    return readFileSync(path, "utf8").includes(lineagePrefix);
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
