import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  AdapterInput,
  adapterInputValues,
  canonicalSchemaId,
  canonicalSourceTo,
  configFieldMetadata,
  createInstalledConfig,
  DestructiveChangesPolicy,
  defaultEnvironments,
  defaultMigrationHistoryTable,
  defaultSync,
  defaultTypesFile,
  defaultWorkflow,
  defaultZodFile,
  deploySafetyPolicies,
  destructiveChangesPolicies,
  generatedOutputPolicies,
  genericMigrationsDir,
  genericSchemaPath,
  isConfigSource,
  migrationCheckPolicies,
  migrationSyncPolicies,
  migrationVerifyPolicies,
  NormalizePolicy,
  normalizePolicies,
  RenameDetectionPolicy,
  renameDetectionPolicies,
  schemaDiffPolicies,
  sourceAuto,
  sourceHint,
  syncTargetModes,
  syncTargetRunners,
  TransactionMode,
  transactionModes,
  typeUsagePolicies,
} from "./config-contract.js";
import { diagnostic, diagnosticCatalog, formatDiagnostic } from "./diagnostics.js";
import { redactSecrets } from "./redaction.js";

export type {
  DeploySafetyPolicy,
  GeneratedOutputPolicy,
  MigrationCheckPolicy,
  MigrationSyncPolicy,
  MigrationVerifyPolicy,
  SchemaDiffPolicy,
  SupaschemaEnvironment,
  SupaschemaSync,
  SupaschemaSyncTarget,
  SupaschemaWorkflow,
  SyncTargetMode,
  SyncTargetRunner,
  TypeUsagePolicy,
} from "./config-contract.js";

const hintsSchema = z
  .object({
    allowedGrantees: z.array(z.string()).default([]),
    destructive: z.array(z.string()).default([]),
    requiredPolicyColumns: z.record(z.string(), z.array(z.string())).default({}),
    renames: z
      .array(
        z.strictObject({
          from: z.string(),
          to: z.string(),
        })
      )
      .default([]),
  })
  .default({ allowedGrantees: [], destructive: [], requiredPolicyColumns: {}, renames: [] });

const schemaFilterSchema = z
  .strictObject({
    exclude: z.array(z.string()).default([]),
    include: z.array(z.string()).default([]),
  })
  .default({ exclude: [], include: [] });

const environmentSchema = z.strictObject({
  databaseUrl: z.string(),
});
const syncTargetBaseSchema = {
  historyTable: z.string(),
  mode: z.enum(syncTargetModes),
  remote: z.boolean().optional(),
  requireApprovalEnv: z.string().optional(),
  runner: z.enum(syncTargetRunners),
};
const syncTargetSchema = z.strictObject({
  ...syncTargetBaseSchema,
  databaseUrl: z.string().optional(),
  environment: z.string().optional(),
});
const syncSchema = z
  .strictObject({
    targets: z.record(z.string(), syncTargetSchema).default(defaultSync.targets),
  })
  .default(defaultSync);

const sourcesSchema = z
  .strictObject({
    from: z.string().default(sourceAuto),
    to: z.string().default(canonicalSourceTo([genericSchemaPath])),
  })
  .default({ from: sourceAuto, to: canonicalSourceTo([genericSchemaPath]) });

const adapterSchema = z.enum(adapterInputValues).default(AdapterInput.Auto);
const workflowSchema = z
  .strictObject({
    schema_diff: z.enum(schemaDiffPolicies).default(defaultWorkflow.schema_diff),
    migration_check: z.enum(migrationCheckPolicies).default(defaultWorkflow.migration_check),
    migration_verify: z.enum(migrationVerifyPolicies).default(defaultWorkflow.migration_verify),
    migration_sync: z.enum(migrationSyncPolicies).default(defaultWorkflow.migration_sync),
    type_safety: z.enum(deploySafetyPolicies).default(defaultWorkflow.type_safety),
    rls_safety: z.enum(deploySafetyPolicies).default(defaultWorkflow.rls_safety),
    type_generation: z.enum(generatedOutputPolicies).default(defaultWorkflow.type_generation),
    zod_generation: z.enum(generatedOutputPolicies).default(defaultWorkflow.zod_generation),
    type_usage: z.enum(typeUsagePolicies).default(defaultWorkflow.type_usage),
  })
  .default(defaultWorkflow);
export const supaschemaConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  adapter: adapterSchema,
  cascade: z.literal("never").default("never"),
  destructiveChanges: z
    .enum(destructiveChangesPolicies)
    .default(DestructiveChangesPolicy.HintRequired),
  environments: z.record(z.string(), environmentSchema).default(defaultEnvironments),
  excludedGrantRoles: z.array(z.string()).default([]),
  hints: hintsSchema,
  idempotency: z.literal("required").default("required"),
  lockTimeout: z.string().default("5s"),
  workflow: workflowSchema,
  sync: syncSchema,
  migrationsDir: z.string().default(genericMigrationsDir),
  typesFile: z.string().default(defaultTypesFile),
  zodFile: z.string().default(defaultZodFile),
  normalize: z.enum(normalizePolicies).default(NormalizePolicy.Deparse),
  managedSchemas: z.array(z.string()).default([]),
  postgresVersion: z.string().default("15+"),
  renameDetection: z.enum(renameDetectionPolicies).default(RenameDetectionPolicy.HintsOnly),
  schemaPaths: z.array(z.string()).default([genericSchemaPath]),
  schemas: schemaFilterSchema,
  sources: sourcesSchema,
  statementTimeout: z.string().default("60s"),
  transactionMode: z.enum(transactionModes).default(TransactionMode.PerMigration),
  validators: z.array(z.string()).default(["internal-parser"]),
});

export type SupaschemaConfig = z.infer<typeof supaschemaConfigSchema>;
export type SupaschemaAdapter = z.infer<typeof adapterSchema>;

export const defaultConfig: SupaschemaConfig = finalizeConfigDefaults(
  supaschemaConfigSchema.parse({}),
  {}
);

export function resolveConfig(config?: unknown): SupaschemaConfig {
  const input = config ?? {};
  return finalizeConfigDefaults(supaschemaConfigSchema.parse(input), input);
}

function parseUserConfigFile(input: unknown, path: string): SupaschemaConfig {
  const result = supaschemaConfigSchema.safeParse(input ?? {});
  if (result.success) {
    return finalizeConfigDefaults(result.data, input);
  }
  const detail = redactSecrets(z.prettifyError(result.error));
  const message =
    diagnosticCatalog.SUPA_CONFIG_INVALID ?? "supaschema.config.json failed schema validation.";
  const item = diagnostic("SUPA_CONFIG_INVALID", "error", message, {
    file: path,
    hint: detail,
  });
  throw new Error(formatDiagnostic(item));
}

export async function loadConfig(
  cwd: string = process.cwd(),
  explicitPath?: string
): Promise<SupaschemaConfig> {
  if (explicitPath) {
    const path = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    return loadConfigFile(path);
  }
  const fromJson = await tryLoadJsonConfig(resolve(cwd, "supaschema.config.json"));
  if (fromJson) {
    return fromJson;
  }
  return defaultConfig;
}

async function loadConfigFile(path: string): Promise<SupaschemaConfig> {
  if (path.endsWith(".mjs") || path.endsWith(".js")) {
    throw new Error(
      "JavaScript config files are not supported. Move persistent settings into supaschema.config.json."
    );
  }
  const raw = await readFile(path, "utf8");
  return parseUserConfigFile(JSON.parse(raw), path);
}

async function tryLoadJsonConfig(path: string): Promise<SupaschemaConfig | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return parseUserConfigFile(JSON.parse(raw), path);
  } catch (error) {
    if (isFileMissing(error)) {
      return;
    }
    throw error;
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function finalizeConfigDefaults(config: SupaschemaConfig, input: unknown): SupaschemaConfig {
  let next = config;
  if (!hasExplicitSourcesTo(input)) {
    next = {
      ...next,
      sources: {
        ...next.sources,
        to: canonicalSourceTo(next.schemaPaths),
      },
    };
  }
  if (hasExplicitEnvironments(input) && !hasExplicitSync(input)) {
    next = {
      ...next,
      sync: { targets: {} },
    };
  }
  return next;
}

function hasExplicitSourcesTo(input: unknown): boolean {
  return isRecord(input) && isRecord(input.sources) && typeof input.sources.to === "string";
}

function hasExplicitEnvironments(input: unknown): boolean {
  return isRecord(input) && "environments" in input;
}

function hasExplicitSync(input: unknown): boolean {
  return isRecord(input) && "sync" in input;
}

export const defaultConfigFile = `${JSON.stringify(createInstalledConfig(), null, 2)}\n`;

export function configJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(supaschemaConfigSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  if (!isRecord(schema)) {
    return {};
  }
  return enrichConfigJsonSchema(schema);
}

export interface ConfigValidationDiagnostic {
  field: string;
  hint?: string;
  message: string;
  severity: "error" | "warning";
}

export async function validateConfig(
  config: SupaschemaConfig,
  cwd: string = process.cwd(),
  options: { configPath?: string; includeInstallState?: boolean } = {}
): Promise<ConfigValidationDiagnostic[]> {
  const diagnostics: ConfigValidationDiagnostic[] = [];
  if (config.schemaPaths.length === 0) {
    diagnostics.push({
      field: "schemaPaths",
      message: "schemaPaths must include at least one declarative SQL tree.",
      severity: "error",
    });
  }
  for (const [index, path] of config.schemaPaths.entries()) {
    validatePortablePath(diagnostics, `schemaPaths[${index}]`, path, "directory");
    await validateExistingDirectory(diagnostics, cwd, `schemaPaths[${index}]`, path);
  }

  validatePortablePath(diagnostics, "migrationsDir", config.migrationsDir, "directory");
  await validateExistingDirectory(diagnostics, cwd, "migrationsDir", config.migrationsDir);
  for (const schemaPath of config.schemaPaths) {
    if (
      isInsidePath(schemaPath, config.migrationsDir) ||
      isInsidePath(config.migrationsDir, schemaPath)
    ) {
      diagnostics.push({
        field: "migrationsDir",
        hint: "Keep generated migrations outside every declarative schema tree.",
        message: `migrationsDir (${config.migrationsDir}) overlaps schemaPaths entry ${schemaPath}.`,
        severity: "error",
      });
    }
  }

  validatePortablePath(diagnostics, "typesFile", config.typesFile, "file");
  validatePortablePath(diagnostics, "zodFile", config.zodFile, "file");
  await validateParentDirectory(diagnostics, cwd, "typesFile", config.typesFile);
  await validateParentDirectory(diagnostics, cwd, "zodFile", config.zodFile);

  validateSource(diagnostics, "sources.from", config.sources.from, true);
  validateSource(diagnostics, "sources.to", config.sources.to, false);
  const expectedTo = canonicalSourceTo(config.schemaPaths);
  if (config.sources.to !== expectedTo) {
    diagnostics.push({
      field: "sources.to",
      hint: `Use "${expectedTo}" unless the default target should differ from schemaPaths[0].`,
      message: `sources.to is ${config.sources.to}; schemaPaths[0] resolves to ${expectedTo}.`,
      severity: "warning",
    });
  }

  warnIfRawDatabaseUrl(diagnostics, "sources.from", config.sources.from);
  warnIfRawDatabaseUrl(diagnostics, "sources.to", config.sources.to);
  for (const [name, environment] of Object.entries(config.environments)) {
    warnIfRawDatabaseUrl(diagnostics, `environments.${name}.databaseUrl`, environment.databaseUrl);
  }
  validateSyncTargets(diagnostics, config);

  const include = new Set(config.schemas.include);
  const overlap = config.schemas.exclude.filter((schema) => include.has(schema));
  if (overlap.length > 0) {
    diagnostics.push({
      field: "schemas",
      hint: "Remove each schema from either include or exclude.",
      message: `schemas.include and schemas.exclude both contain ${overlap.join(", ")}.`,
      severity: "error",
    });
  }
  if (options.includeInstallState === true) {
    const pendingInstall = await pendingInstallPathConfirmationDiagnostic(cwd, options.configPath);
    if (pendingInstall) {
      diagnostics.push(pendingInstall);
    }
  }

  return diagnostics;
}

export function formatConfigValidationDiagnostics(
  diagnostics: ConfigValidationDiagnostic[]
): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return `${diagnostics
    .map(
      (item) =>
        `${item.severity}: ${item.field}: ${item.message}${item.hint ? ` (${item.hint})` : ""}`
    )
    .join("\n")}\n`;
}

export async function pendingInstallPathConfirmationDiagnostic(
  cwd: string = process.cwd(),
  configPath?: string
): Promise<ConfigValidationDiagnostic | undefined> {
  const manifest = await readJsonIfExists(resolve(cwd, ".supaschema", "install.json"));
  if (!isRecord(manifest) || manifest.pathConfirmationNeeded !== true) {
    return;
  }
  if (await hasConfirmedInstallPaths(cwd, configPath)) {
    return;
  }
  return {
    field: ".supaschema/install.json",
    hint: "Inspect .supaschema/install.json candidates, ask which paths to use, then set schemaPaths, sources.to, and migrationsDir in supaschema.config.json.",
    message:
      "Install path confirmation is pending; zero-source migration commands must not use guessed schema or migration paths.",
    severity: "error",
  };
}

async function hasConfirmedInstallPaths(
  cwd: string,
  configPath: string | undefined
): Promise<boolean> {
  const parsed = await readJsonIfExists(configFilePath(cwd, configPath));
  if (!isRecord(parsed)) {
    return false;
  }
  return (
    Array.isArray(parsed.schemaPaths) &&
    parsed.schemaPaths.some((item) => typeof item === "string" && item.trim().length > 0) &&
    typeof parsed.migrationsDir === "string" &&
    parsed.migrationsDir.trim().length > 0 &&
    isRecord(parsed.sources) &&
    typeof parsed.sources.to === "string" &&
    parsed.sources.to.trim().length > 0
  );
}

function configFilePath(cwd: string, configPath: string | undefined): string {
  if (configPath) {
    return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
  }
  return join(cwd, "supaschema.config.json");
}

async function readJsonIfExists(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isFileMissing(error)) {
      return;
    }
    throw error;
  }
}

function enrichConfigJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const meta of configFieldMetadata) {
    const property = properties[String(meta.key)];
    if (!isRecord(property)) {
      continue;
    }
    property.description = meta.description;
    if ("examples" in meta) {
      property.examples = meta.examples;
    }
    if ("pathKind" in meta) {
      property["x-supaschema-path-kind"] = meta.pathKind;
    }
    if ("allowed" in meta && !("enum" in property) && !("const" in property)) {
      property.enum = meta.allowed;
    }
  }
  enrichNestedSchema(properties);
  schema.$id = canonicalSchemaId;
  schema.description =
    "Machine-readable supaschema.config.json contract. The public field reference is docs/configuration/config-file.mdx.";
  return schema;
}

function enrichNestedSchema(properties: Record<string, unknown>): void {
  const sources = properties.sources;
  const sourceProperties =
    isRecord(sources) && isRecord(sources.properties) ? sources.properties : undefined;
  if (sourceProperties) {
    const from = sourceProperties.from;
    const to = sourceProperties.to;
    if (isRecord(from)) {
      from.description =
        'Default before-state source. Use "auto" to resolve a database URL first, then git:HEAD, then empty:.';
      from.examples = [
        "auto",
        "git:HEAD",
        "empty:",
        "dir:baseline/schemas",
        "database:$DATABASE_URL",
      ];
      from.oneOf = [
        { const: sourceAuto },
        { type: "string", "x-supaschema-source-parser": "parseRuntimeSource" },
      ];
      from.type = undefined;
    }
    if (isRecord(to)) {
      to.description = "Default after-state source, usually dir:<schemaPaths[0]>.";
      to.examples = ["dir:database/schemas", "dir:supabase/schemas"];
      to["x-supaschema-source-parser"] = "parseRuntimeSource";
    }
  }
  const environments = properties.environments;
  if (isRecord(environments)) {
    environments.description =
      "Named database URL references used by --env. Store credentials in environment variables.";
  }
  const sync = properties.sync;
  if (isRecord(sync)) {
    sync.description =
      "Named apply targets for supaschema sync. workflow.migration_sync is the global apply policy; each target mode decides whether bare sync selects that target.";
  }
  const workflow = properties.workflow;
  const workflowProperties =
    isRecord(workflow) && isRecord(workflow.properties) ? workflow.properties : undefined;
  if (workflowProperties) {
    enrichWorkflowJsonSchema(workflowProperties);
  }
}

function enrichWorkflowJsonSchema(workflowProperties: Record<string, unknown>): void {
  setNestedDescription(
    workflowProperties,
    "schema_diff",
    "Controls whether agent hooks generate a schema migration automatically after configured schema-tree SQL writes."
  );
  setNestedDescription(
    workflowProperties,
    "migration_check",
    "Controls when replay-safety checks run after a generated migration."
  );
  setNestedDescription(
    workflowProperties,
    "migration_verify",
    "Controls whether agents should only suggest verification or run it automatically when a database is available."
  );
  setNestedDescription(
    workflowProperties,
    "migration_sync",
    'Global apply policy for supaschema sync: disable apply, require explicit --target, or let bare sync select sync.targets entries whose mode is "auto".'
  );
  setNestedDescription(
    workflowProperties,
    "type_safety",
    "Controls whether sync type-contract diagnostics are disabled, reported only, or block deploy."
  );
  setNestedDescription(
    workflowProperties,
    "rls_safety",
    "Controls whether sync RLS and least-privilege diagnostics are disabled, reported only, or block deploy."
  );
  setNestedDescription(
    workflowProperties,
    "type_generation",
    "Controls whether diff refreshes the configured TypeScript output after it writes a migration."
  );
  setNestedDescription(
    workflowProperties,
    "zod_generation",
    "Controls whether diff refreshes the configured Zod validator output after it writes a migration."
  );
  setNestedDescription(
    workflowProperties,
    "type_usage",
    "Controls whether agents should prefer generated Zod validators or TypeScript-only generated shapes when wiring application code."
  );
}

function setNestedDescription(
  properties: Record<string, unknown>,
  key: string,
  description: string
): void {
  const property = properties[key];
  if (isRecord(property)) {
    property.description = description;
  }
}

function validatePortablePath(
  diagnostics: ConfigValidationDiagnostic[],
  field: string,
  path: string,
  kind: "directory" | "file"
): void {
  if (path.trim().length === 0) {
    diagnostics.push({
      field,
      message: `${field} must not be empty.`,
      severity: "error",
    });
  }
  if (isAbsolute(path)) {
    diagnostics.push({
      field,
      hint: `Use a project-relative ${kind} path so generated configs remain portable.`,
      message: `${field} is absolute (${path}).`,
      severity: "warning",
    });
  }
}

async function validateExistingDirectory(
  diagnostics: ConfigValidationDiagnostic[],
  cwd: string,
  field: string,
  path: string
): Promise<void> {
  const result = await pathKind(resolve(cwd, path));
  if (result !== "directory") {
    diagnostics.push({
      field,
      hint: "Run supaschema init --repair or create the configured directory.",
      message: `${field} directory does not exist: ${path}.`,
      severity: "warning",
    });
  }
}

async function validateParentDirectory(
  diagnostics: ConfigValidationDiagnostic[],
  cwd: string,
  field: string,
  path: string
): Promise<void> {
  const parent = dirname(path);
  if (parent === ".") {
    return;
  }
  const result = await pathKind(resolve(cwd, parent));
  if (result !== "directory") {
    diagnostics.push({
      field,
      hint: "Create the parent directory before running supaschema types.",
      message: `${field} parent directory does not exist: ${parent}.`,
      severity: "warning",
    });
  }
}

function validateSource(
  diagnostics: ConfigValidationDiagnostic[],
  field: string,
  source: string,
  allowAuto: boolean
): void {
  if (!isConfigSource(source, allowAuto)) {
    diagnostics.push({
      field,
      hint: sourceHint(allowAuto),
      message: `${field} has an unsupported source value: ${redactSecrets(source)}.`,
      severity: "error",
    });
  }
}

function warnIfRawDatabaseUrl(
  diagnostics: ConfigValidationDiagnostic[],
  field: string,
  value: string
): void {
  if (!isRawDatabaseUrlSource(value)) {
    return;
  }
  if (value.includes("$")) {
    return;
  }
  diagnostics.push({
    field,
    hint: "Move the URL into an environment variable and reference it as $ENV_NAME.",
    message: `${field} contains an inline database URL: ${redactSecrets(value)}.`,
    severity: "warning",
  });
}

function isRawDatabaseUrlSource(value: string): boolean {
  const url = value.startsWith("database:") ? value.slice("database:".length) : value;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function validateSyncTargets(
  diagnostics: ConfigValidationDiagnostic[],
  config: SupaschemaConfig
): void {
  for (const [name, target] of Object.entries(config.sync.targets)) {
    if ((target.environment === undefined) === (target.databaseUrl === undefined)) {
      diagnostics.push({
        field: `sync.targets.${name}`,
        hint: "Set exactly one of environment or databaseUrl.",
        message: `sync target ${name} must define exactly one URL owner.`,
        severity: "error",
      });
    }
    if (target.environment !== undefined && config.environments[target.environment] === undefined) {
      diagnostics.push({
        field: `sync.targets.${name}.environment`,
        hint: `Add environments.${target.environment}.databaseUrl or use databaseUrl on the target.`,
        message: `sync target ${name} references unknown environment ${target.environment}.`,
        severity: "error",
      });
    }
    if (target.databaseUrl !== undefined) {
      warnIfRawDatabaseUrl(diagnostics, `sync.targets.${name}.databaseUrl`, target.databaseUrl);
    }
    if (isRemoteSyncTarget(name, target.remote) && target.requireApprovalEnv === undefined) {
      diagnostics.push({
        field: `sync.targets.${name}.requireApprovalEnv`,
        hint: "Set requireApprovalEnv to SUPASCHEMA_REMOTE_SYNC_APPROVED or another operator approval environment variable.",
        message: `remote sync target ${name} must require a runtime approval environment variable.`,
        severity: "error",
      });
    }
    if (target.historyTable.trim().length === 0) {
      diagnostics.push({
        field: `sync.targets.${name}.historyTable`,
        hint: `Use ${defaultMigrationHistoryTable} unless the target has a different migration history table.`,
        message: `sync target ${name} has an empty historyTable.`,
        severity: "error",
      });
    }
  }
}

function isRemoteSyncTarget(name: string, remote: boolean | undefined): boolean {
  return name === "remote" || remote === true;
}

async function pathKind(path: string): Promise<"directory" | "file" | "missing"> {
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      return "directory";
    }
    if (stats.isFile()) {
      return "file";
    }
  } catch {
    return "missing";
  }
  return "missing";
}

function isInsidePath(parent: string, child: string): boolean {
  const relPath = relative(parent, child);
  return relPath !== "" && !relPath.startsWith("..") && !isAbsolute(relPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
