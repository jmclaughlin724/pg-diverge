export const configSchemaFileName = "supaschema-config.schema.json";
export const canonicalSchemaId = `https://supaschema.com/schemas/${configSchemaFileName}`;
export const packageSchemaRef = `./node_modules/supaschema/${configSchemaFileName}`;
export const localSchemaRef = `./${configSchemaFileName}`;
export const genericProviderId = "postgres";
export const genericSchemaPath = "database/schemas";
export const genericMigrationsDir = "database/migrations";
export const defaultTypesFile = "database.types.ts";
export const defaultZodFile = "database.zod.ts";

function literalContract<const T extends Record<string, string>>(value: T): T {
  return value;
}

export const AdapterInput = literalContract({
  Auto: "auto",
});
export type AdapterInput = (typeof AdapterInput)[keyof typeof AdapterInput];

export const RuntimeSourceKind = literalContract({
  Catalog: "catalog",
  Database: "database",
  Dir: "dir",
  Dump: "dump",
  Empty: "empty",
  Git: "git",
});
export type RuntimeSourceKind = (typeof RuntimeSourceKind)[keyof typeof RuntimeSourceKind];

export const SchemaDiffPolicy = literalContract({
  Disabled: "disabled",
  Manual: "manual",
  OnSchemaWrite: "on_schema_write",
});
export type SchemaDiffPolicy = (typeof SchemaDiffPolicy)[keyof typeof SchemaDiffPolicy];

export const MigrationCheckPolicy = literalContract({
  Manual: "manual",
  AfterSchemaDiff: "after_schema_diff",
  RequiredBeforeComplete: "required_before_complete",
});
export type MigrationCheckPolicy = (typeof MigrationCheckPolicy)[keyof typeof MigrationCheckPolicy];

export const MigrationVerifyPolicy = literalContract({
  Manual: "manual",
  SuggestAfterCheck: "suggest_after_check",
  AfterSchemaDiff: "after_schema_diff",
});
export type MigrationVerifyPolicy =
  (typeof MigrationVerifyPolicy)[keyof typeof MigrationVerifyPolicy];

export const MigrationSyncPolicy = literalContract({
  Disabled: "disabled",
  Manual: "manual",
  Auto: "auto",
});
export type MigrationSyncPolicy = (typeof MigrationSyncPolicy)[keyof typeof MigrationSyncPolicy];

export const DeploySafetyPolicy = literalContract({
  Disabled: "disabled",
  ReportOnly: "report_only",
  DeployBlocking: "deploy_blocking",
});
export type DeploySafetyPolicy = (typeof DeploySafetyPolicy)[keyof typeof DeploySafetyPolicy];

export const GeneratedOutputPolicy = literalContract({
  Disabled: "disabled",
  RefreshExisting: "refresh_existing",
  CreateOrRefresh: "create_or_refresh",
});
export type GeneratedOutputPolicy =
  (typeof GeneratedOutputPolicy)[keyof typeof GeneratedOutputPolicy];

export const TypeUsagePolicy = literalContract({
  TypescriptOnly: "typescript_only",
  ZodValidated: "zod_validated",
});
export type TypeUsagePolicy = (typeof TypeUsagePolicy)[keyof typeof TypeUsagePolicy];

export const SyncTargetMode = literalContract({
  Manual: "manual",
  Auto: "auto",
});
export type SyncTargetMode = (typeof SyncTargetMode)[keyof typeof SyncTargetMode];

export const SyncTargetRunner = literalContract({
  Direct: "direct",
  SupabaseCli: "supabase-cli",
});
export type SyncTargetRunner = (typeof SyncTargetRunner)[keyof typeof SyncTargetRunner];

export const DestructiveChangesPolicy = literalContract({
  HintRequired: "hint-required",
  Block: "block",
  Allow: "allow",
});
export type DestructiveChangesPolicy =
  (typeof DestructiveChangesPolicy)[keyof typeof DestructiveChangesPolicy];

export const NormalizePolicy = literalContract({
  Off: "off",
  Deparse: "deparse",
});
export type NormalizePolicy = (typeof NormalizePolicy)[keyof typeof NormalizePolicy];

export const RenameDetectionPolicy = literalContract({
  HintsOnly: "hints-only",
  Off: "off",
});
export type RenameDetectionPolicy =
  (typeof RenameDetectionPolicy)[keyof typeof RenameDetectionPolicy];

export const TransactionMode = literalContract({
  PerMigration: "per-migration",
  PerStatement: "per-statement",
});
export type TransactionMode = (typeof TransactionMode)[keyof typeof TransactionMode];

export interface SupaschemaWorkflow {
  migration_check: MigrationCheckPolicy;
  migration_sync: MigrationSyncPolicy;
  migration_verify: MigrationVerifyPolicy;
  rls_safety: DeploySafetyPolicy;
  schema_diff: SchemaDiffPolicy;
  type_generation: GeneratedOutputPolicy;
  type_safety: DeploySafetyPolicy;
  type_usage: TypeUsagePolicy;
  zod_generation: GeneratedOutputPolicy;
}

export interface SupaschemaEnvironment {
  databaseUrl: string;
}

export interface SupaschemaSyncTarget {
  databaseUrl?: string;
  environment?: string;
  historyTable: string;
  mode: SyncTargetMode;
  remote?: boolean;
  requireApprovalEnv?: string;
  runner: SyncTargetRunner;
}

export interface SupaschemaSync {
  targets: Record<string, SupaschemaSyncTarget>;
}

export interface ParsedRuntimeSource {
  kind: RuntimeSourceKind;
  payload: string;
}

export const adapterInputValues = Object.values(AdapterInput);

export const supabaseManagedSchemas = [
  "auth",
  "storage",
  "realtime",
  "vault",
  "extensions",
  "cron",
  "net",
  "supabase_functions",
  "graphql",
  "graphql_public",
] satisfies string[];

export const supportedValidators = [
  "internal-parser",
  "squawk",
  "squawk-cli",
  "pgls",
  "postgres-language-server",
  "@postgres-language-server/cli",
  "sqlfluff",
] satisfies string[];

export const sourceAuto = "auto";
const runtimeSourcePrefixEntries: readonly [RuntimeSourceKind, string][] = [
  [RuntimeSourceKind.Dir, "dir:"],
  [RuntimeSourceKind.Git, "git:"],
  [RuntimeSourceKind.Database, "database:"],
  [RuntimeSourceKind.Dump, "dump:"],
  [RuntimeSourceKind.Catalog, "catalog:"],
  [RuntimeSourceKind.Empty, "empty:"],
];
export const runtimeSourcePrefixes = runtimeSourcePrefixEntries.map((entry) => entry[1]);
export const sourcePrefixes = [sourceAuto, ...runtimeSourcePrefixes];
export const schemaDiffPolicies = Object.values(SchemaDiffPolicy);
export const migrationCheckPolicies = Object.values(MigrationCheckPolicy);
export const migrationVerifyPolicies = Object.values(MigrationVerifyPolicy);
export const migrationSyncPolicies = Object.values(MigrationSyncPolicy);
export const deploySafetyPolicies = Object.values(DeploySafetyPolicy);
export const generatedOutputPolicies = Object.values(GeneratedOutputPolicy);
export const typeUsagePolicies = Object.values(TypeUsagePolicy);
export const syncTargetModes = Object.values(SyncTargetMode);
export const syncTargetRunners = Object.values(SyncTargetRunner);
export const destructiveChangesPolicies = Object.values(DestructiveChangesPolicy);
export const normalizePolicies = Object.values(NormalizePolicy);
export const renameDetectionPolicies = Object.values(RenameDetectionPolicy);
export const transactionModes = Object.values(TransactionMode);
export const defaultMigrationHistoryTable = "supabase_migrations.schema_migrations";
export const defaultEnvironments: Record<string, SupaschemaEnvironment> = {};
export const defaultWorkflow: SupaschemaWorkflow = {
  schema_diff: SchemaDiffPolicy.OnSchemaWrite,
  migration_check: MigrationCheckPolicy.AfterSchemaDiff,
  migration_verify: MigrationVerifyPolicy.SuggestAfterCheck,
  migration_sync: MigrationSyncPolicy.Auto,
  type_safety: DeploySafetyPolicy.DeployBlocking,
  rls_safety: DeploySafetyPolicy.DeployBlocking,
  type_generation: GeneratedOutputPolicy.CreateOrRefresh,
  zod_generation: GeneratedOutputPolicy.CreateOrRefresh,
  type_usage: TypeUsagePolicy.ZodValidated,
};

export interface ProviderMarker {
  contentTerms?: string[];
  fileNames?: string[];
  path?: string;
}

export interface ProviderPreset {
  adapter: AdapterInput;
  id: string;
  label: string;
  managedSchemas: string[];
  markers: ProviderMarker[];
  migrationsDir: string;
  schemaPath: string;
}

export const providerPresets = [
  {
    adapter: AdapterInput.Auto,
    id: "supabase",
    label: "Supabase",
    managedSchemas: [...supabaseManagedSchemas],
    markers: [{ path: "supabase/config.toml" }],
    migrationsDir: "supabase/migrations",
    schemaPath: "supabase/schemas",
  },
  {
    adapter: AdapterInput.Auto,
    id: "neon",
    label: "Neon",
    managedSchemas: [],
    markers: [
      { path: "neon.toml" },
      { path: ".neon/project.json" },
      { path: ".neon/config.json" },
      {
        contentTerms: ["neon.tech", "neon.com"],
        fileNames: ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"],
      },
    ],
    migrationsDir: "neon/migrations",
    schemaPath: "neon/schemas",
  },
  {
    adapter: AdapterInput.Auto,
    id: "aws-postgresql",
    label: "RDS/Aurora PostgreSQL",
    managedSchemas: [],
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
    migrationsDir: "aws-postgresql/migrations",
    schemaPath: "aws-postgresql/schemas",
  },
  {
    adapter: AdapterInput.Auto,
    id: "alloydb",
    label: "AlloyDB",
    managedSchemas: [],
    markers: [
      {
        contentTerms: ["google_alloydb_cluster", "google_alloydb_instance"],
        fileNames: ["*.tf"],
      },
      {
        contentTerms: ["alloydb", "alloydb.googleapis.com"],
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
      },
    ],
    migrationsDir: "alloydb/migrations",
    schemaPath: "alloydb/schemas",
  },
  {
    adapter: AdapterInput.Auto,
    id: "cloud-sql",
    label: "Cloud SQL for PostgreSQL",
    managedSchemas: [],
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
    migrationsDir: "cloud-sql/migrations",
    schemaPath: "cloud-sql/schemas",
  },
  {
    adapter: AdapterInput.Auto,
    id: "azure-postgresql",
    label: "Azure PostgreSQL",
    managedSchemas: [],
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
    migrationsDir: "azure-postgresql/migrations",
    schemaPath: "azure-postgresql/schemas",
  },
] satisfies ProviderPreset[];

export const genericProviderPreset = {
  adapter: AdapterInput.Auto,
  id: genericProviderId,
  label: "PostgreSQL",
  managedSchemas: [],
  markers: [],
  migrationsDir: genericMigrationsDir,
  schemaPath: genericSchemaPath,
} satisfies ProviderPreset;

export const allProviderPresets = [genericProviderPreset, ...providerPresets];
export const providerSchemaPaths = providerPresets.map((preset) => preset.schemaPath);
export const providerMigrationsDirs = providerPresets.map((preset) => preset.migrationsDir);
export const cascadePolicies = ["never"];
export const idempotencyPolicies = ["required"];

export interface InstalledConfigOptions {
  localDatabaseUrlEnv?: string;
  migrationsDir?: string;
  providerId?: string;
  remoteDatabaseUrlEnv?: string;
  schemaPaths?: string[];
  schemaRef?: string;
}

export function canonicalSourceTo(schemaPaths: readonly string[] = [genericSchemaPath]): string {
  return `dir:${schemaPaths[0] ?? genericSchemaPath}`;
}

export function parseRuntimeSource(source: string): ParsedRuntimeSource | undefined {
  for (const [kind, prefix] of runtimeSourcePrefixEntries) {
    if (!source.startsWith(prefix)) {
      continue;
    }
    const payload = source.slice(prefix.length);
    if (kind !== RuntimeSourceKind.Empty && payload.length === 0) {
      continue;
    }
    return {
      kind,
      payload,
    };
  }
  return;
}

export function isRuntimeSource(source: string): boolean {
  return parseRuntimeSource(source) !== undefined;
}

export function isConfigSource(source: string, allowAuto: boolean): boolean {
  return (allowAuto && source === sourceAuto) || isRuntimeSource(source);
}

export function sourceHint(allowAuto: boolean): string {
  return `Use ${allowAuto ? '"auto" or ' : ""}${runtimeSourcePrefixes.join(", ")}.`;
}

export function providerPreset(providerId?: string): ProviderPreset {
  return allProviderPresets.find((preset) => preset.id === providerId) ?? genericProviderPreset;
}

export function managedSchemasForProvider(providerId?: string): string[] {
  return [...providerPreset(providerId).managedSchemas];
}

export function syncForInstalledConfig(options: InstalledConfigOptions = {}): SupaschemaSync {
  if (options.providerId === "supabase") {
    return {
      targets: {
        local: {
          mode: SyncTargetMode.Auto,
          runner: SyncTargetRunner.SupabaseCli,
          historyTable: defaultMigrationHistoryTable,
        },
        remote: {
          mode: SyncTargetMode.Manual,
          runner: SyncTargetRunner.SupabaseCli,
          historyTable: defaultMigrationHistoryTable,
          requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          remote: true,
        },
      },
    };
  }
  const localDatabaseUrl = databaseUrlEnvReference(options.localDatabaseUrlEnv);
  const remoteDatabaseUrl = databaseUrlEnvReference(options.remoteDatabaseUrlEnv);
  return {
    targets: {
      local: {
        mode: SyncTargetMode.Auto,
        runner: SyncTargetRunner.Direct,
        ...(localDatabaseUrl === undefined ? {} : { databaseUrl: localDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
      },
      remote: {
        mode: SyncTargetMode.Manual,
        runner: SyncTargetRunner.Direct,
        ...(remoteDatabaseUrl === undefined ? {} : { databaseUrl: remoteDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
        requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
        remote: true,
      },
    },
  };
}

export const defaultSync: SupaschemaSync = syncForInstalledConfig();

function databaseUrlEnvReference(name: string | undefined): string | undefined {
  if (typeof name !== "string") {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

export function createInstalledConfig(
  options: InstalledConfigOptions = {}
): Record<string, unknown> {
  const provider = providerPreset(options.providerId);
  const schemaPaths = normalizedStringArray(options.schemaPaths, [provider.schemaPath]);
  const migrationsDir = normalizedString(options.migrationsDir, provider.migrationsDir);
  const sync = syncForInstalledConfig({ ...options, providerId: provider.id });
  return orderInstalledConfig({
    $schema: options.schemaRef ?? packageSchemaRef,
    adapter: AdapterInput.Auto,
    cascade: "never",
    destructiveChanges: DestructiveChangesPolicy.HintRequired,
    environments: defaultEnvironments,
    excludedGrantRoles: [],
    hints: {
      allowedGrantees: [],
      destructive: [],
      requiredPolicyColumns: {},
      renames: [],
    },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    sync,
    migrationsDir,
    typesFile: defaultTypesFile,
    zodFile: defaultZodFile,
    normalize: NormalizePolicy.Deparse,
    managedSchemas: managedSchemasForProvider(provider.id),
    postgresVersion: "15+",
    renameDetection: RenameDetectionPolicy.HintsOnly,
    schemaPaths,
    schemas: {
      exclude: [],
      include: [],
    },
    sources: {
      from: sourceAuto,
      to: canonicalSourceTo(schemaPaths),
    },
    statementTimeout: "60s",
    transactionMode: TransactionMode.PerMigration,
    validators: ["internal-parser"],
  });
}

export function mergeInstalledConfig(
  existing: unknown,
  options: InstalledConfigOptions = {}
): Record<string, unknown> {
  const base = createInstalledConfig(options);
  if (!isRecord(existing)) {
    return base;
  }
  const baseHints = recordValue(base.hints);
  const baseSchemas = recordValue(base.schemas);
  const baseSources = recordValue(base.sources);
  const baseSync = recordValue(base.sync);
  const baseWorkflow = recordValue(base.workflow);
  const existingWorkflow = isRecord(existing.workflow)
    ? normalizeInstalledWorkflow(existing.workflow)
    : {};
  const schemaPaths = normalizedStringArray(
    existing.schemaPaths,
    normalizedStringArray(base.schemaPaths, [genericSchemaPath])
  );
  const existingEnvironments = isRecord(existing.environments) ? existing.environments : undefined;
  const hasExistingEnvironments =
    existingEnvironments !== undefined && !isLegacyDefaultEnvironments(existingEnvironments);
  const existingSync = normalizeInstalledSync(
    isRecord(existing.sync) ? existing.sync : undefined,
    existingEnvironments !== undefined && isLegacyDefaultEnvironments(existingEnvironments),
    baseSync
  );
  const merged = {
    ...base,
    ...existing,
    $schema: normalizedString(existing.$schema, normalizedString(base.$schema, packageSchemaRef)),
    adapter: AdapterInput.Auto,
    environments: hasExistingEnvironments ? existingEnvironments : base.environments,
    excludedGrantRoles: normalizedStringArray(
      existing.excludedGrantRoles,
      normalizedStringArray(base.excludedGrantRoles, [])
    ),
    hints: {
      ...baseHints,
      ...(isRecord(existing.hints) ? existing.hints : {}),
    },
    managedSchemas: normalizedStringArray(
      existing.managedSchemas,
      normalizedStringArray(base.managedSchemas, [])
    ),
    migrationsDir: normalizedString(
      existing.migrationsDir,
      normalizedString(base.migrationsDir, genericMigrationsDir)
    ),
    schemaPaths,
    schemas: {
      ...baseSchemas,
      ...(isRecord(existing.schemas) ? existing.schemas : {}),
    },
    sources: {
      ...baseSources,
      ...(isRecord(existing.sources) ? existing.sources : {}),
    },
    sync:
      hasExistingEnvironments && existingSync === undefined
        ? { targets: {} }
        : {
            ...baseSync,
            ...(existingSync ?? {}),
          },
    workflow: {
      ...baseWorkflow,
      ...existingWorkflow,
    },
    typesFile: normalizedString(
      existing.typesFile,
      normalizedString(base.typesFile, defaultTypesFile)
    ),
    validators: normalizedStringArray(
      existing.validators,
      normalizedStringArray(base.validators, ["internal-parser"])
    ),
    zodFile: normalizedString(existing.zodFile, normalizedString(base.zodFile, defaultZodFile)),
  };
  const sources = merged.sources;
  if (typeof sources.to !== "string" || sources.to.length === 0) {
    sources.to = canonicalSourceTo(schemaPaths);
  }
  if (typeof sources.from !== "string" || sources.from.length === 0) {
    sources.from = sourceAuto;
  }
  return orderInstalledConfig(merged);
}

function normalizeInstalledWorkflow(workflow: Record<string, unknown>): Record<string, unknown> {
  const next = { ...workflow };
  if (next.migration_sync === "explicit_request_only") {
    next.migration_sync = MigrationSyncPolicy.Manual;
  }
  return next;
}

function isLegacyDefaultEnvironments(environments: Record<string, unknown>): boolean {
  const entries = Object.entries(environments);
  if (entries.length !== 2) {
    return false;
  }
  return (
    environmentDatabaseUrl(environments.local) === "$LOCAL_DATABASE_URL" &&
    environmentDatabaseUrl(environments.production) === "$PRODUCTION_DATABASE_URL"
  );
}

function environmentDatabaseUrl(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  return typeof record?.databaseUrl === "string" ? record.databaseUrl : undefined;
}

function normalizeInstalledSync(
  sync: Record<string, unknown> | undefined,
  legacyDefaultEnvironments: boolean,
  baseSync: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (sync === undefined || !legacyDefaultEnvironments) {
    return sync;
  }
  const targets = isRecord(sync.targets) ? sync.targets : undefined;
  if (targets === undefined) {
    return sync;
  }
  const normalizedTargets: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(targets)) {
    normalizedTargets[name] = normalizeLegacyDefaultSyncTarget(name, value, baseSync);
  }
  return { ...sync, targets: normalizedTargets };
}

function normalizeLegacyDefaultSyncTarget(
  name: string,
  value: unknown,
  baseSync: Record<string, unknown>
): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (name !== "local" && name !== "remote") {
    return value;
  }
  const legacyEnvironment = name === "local" ? "local" : "production";
  if (value.environment !== legacyEnvironment || value.databaseUrl !== undefined) {
    return value;
  }
  const baseTargets = isRecord(baseSync.targets) ? baseSync.targets : {};
  return baseTargets[name] ?? value;
}

export function orderInstalledConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    $schema: config.$schema,
    adapter: config.adapter,
    cascade: config.cascade,
    destructiveChanges: config.destructiveChanges,
    environments: config.environments,
    excludedGrantRoles: config.excludedGrantRoles,
    hints: config.hints,
    idempotency: config.idempotency,
    lockTimeout: config.lockTimeout,
    workflow: config.workflow,
    sync: config.sync,
    migrationsDir: config.migrationsDir,
    typesFile: config.typesFile,
    zodFile: config.zodFile,
    normalize: config.normalize,
    managedSchemas: config.managedSchemas,
    postgresVersion: config.postgresVersion,
    renameDetection: config.renameDetection,
    schemaPaths: config.schemaPaths,
    schemas: config.schemas,
    sources: config.sources,
    statementTimeout: config.statementTimeout,
    transactionMode: config.transactionMode,
    validators: config.validators,
  };
}

interface ConfigFieldMetadata {
  allowed?: readonly unknown[];
  default: unknown;
  description: string;
  examples?: readonly unknown[];
  key: string;
  pathKind?: string;
}

export const configFieldMetadata: ConfigFieldMetadata[] = [
  {
    default: "Generated configs point to the package schema.",
    description:
      "JSON Schema pointer for editor autocomplete and validation. The loader ignores it.",
    examples: [packageSchemaRef, localSchemaRef],
    key: "$schema",
  },
  {
    allowed: adapterInputValues,
    default: AdapterInput.Auto,
    description: "Provider-neutral adapter sentinel.",
    key: "adapter",
  },
  {
    allowed: cascadePolicies,
    default: "never",
    description: "CASCADE is never emitted by generated migrations.",
    key: "cascade",
  },
  {
    allowed: destructiveChangesPolicies,
    default: DestructiveChangesPolicy.HintRequired,
    description:
      "Controls whether destructive operations require exact hints, always block, or are allowed.",
    key: "destructiveChanges",
  },
  {
    default: defaultEnvironments,
    description:
      "Named database URL references for --env. Use $ENV_NAME values instead of committed credentials.",
    examples: [defaultEnvironments, { staging: { databaseUrl: "$STAGING_DB" } }],
    key: "environments",
  },
  {
    default: [],
    description:
      "Grant/default-privilege roles to remove from extracted models, usually provider platform roles.",
    key: "excludedGrantRoles",
  },
  {
    default: { allowedGrantees: [], destructive: [], requiredPolicyColumns: {}, renames: [] },
    description:
      "Reviewed grant, RLS policy-column, destructive-change, and rename hints using exact object keys, table keys, or role names.",
    key: "hints",
  },
  {
    allowed: idempotencyPolicies,
    default: "required",
    description: "Generated SQL must be replay-safe by construction.",
    key: "idempotency",
  },
  {
    default: "5s",
    description: "Migration preamble SET lock_timeout value.",
    key: "lockTimeout",
  },
  {
    default: defaultWorkflow,
    description:
      "Automation policy for generated outputs, hook diff/check, verification guidance, deploy safety gates, and whether bare sync may apply selected targets.",
    key: "workflow",
  },
  {
    default: defaultSync,
    description:
      "Named apply targets for supaschema sync. workflow.migration_sync is the global apply policy; each target mode decides whether bare sync selects that target.",
    examples: [defaultSync],
    key: "sync",
  },
  {
    default: genericMigrationsDir,
    description:
      "Directory where diff writes migrations and zero-arg check/verify read pending migrations.",
    examples: [
      genericMigrationsDir,
      "supabase/migrations",
      "neon/migrations",
      "aws-postgresql/migrations",
    ],
    key: "migrationsDir",
    pathKind: "directory",
  },
  {
    default: defaultTypesFile,
    description: "Output file for TypeScript database types generated by supaschema types.",
    key: "typesFile",
    pathKind: "file",
  },
  {
    default: defaultZodFile,
    description: "Output file for Zod runtime schemas generated by supaschema types.",
    key: "zodFile",
    pathKind: "file",
  },
  {
    allowed: normalizePolicies,
    default: NormalizePolicy.Deparse,
    description: "Controls canonical SQL deparse normalization for extracted objects.",
    key: "normalize",
  },
  {
    default: [],
    description:
      "Externally owned schemas blocked from declarative ownership. Supabase installs seed the Supabase platform schema list.",
    examples: [[], [...supabaseManagedSchemas]],
    key: "managedSchemas",
  },
  {
    default: "15+",
    description: "Documented supported PostgreSQL syntax floor.",
    key: "postgresVersion",
  },
  {
    allowed: renameDetectionPolicies,
    default: RenameDetectionPolicy.HintsOnly,
    description: "Controls whether reviewed hints can render guarded renames.",
    key: "renameDetection",
  },
  {
    default: [genericSchemaPath],
    description:
      "Declarative SQL tree roots. Each root is read recursively; the first path usually matches sources.to.",
    examples: [
      [genericSchemaPath],
      ["supabase/schemas"],
      ["neon/schemas"],
      ["aws-postgresql/schemas"],
    ],
    key: "schemaPaths",
    pathKind: "directory-list",
  },
  {
    default: { exclude: [], include: [] },
    description: "Persistent schema include/exclude filters applied to extracted models.",
    key: "schemas",
  },
  {
    default: { from: sourceAuto, to: canonicalSourceTo([genericSchemaPath]) },
    description:
      "Default before/after sources for zero-source-flag diff, plan, and verify. Keep sources.to explicit even when it matches schemaPaths[0].",
    examples: [
      { from: sourceAuto, to: "dir:database/schemas" },
      { from: "dir:baseline/schemas", to: "dir:database/schemas" },
    ],
    key: "sources",
  },
  {
    default: "60s",
    description: "Migration preamble SET statement_timeout value.",
    key: "statementTimeout",
  },
  {
    allowed: transactionModes,
    default: TransactionMode.PerMigration,
    description: "Transaction model used by verification and transaction-hazard diagnostics.",
    key: "transactionMode",
  },
  {
    default: ["internal-parser"],
    description:
      "Configured external validator commands. The internal parser always remains the correctness owner.",
    examples: [["internal-parser"], ["internal-parser", "squawk"]],
    key: "validators",
  },
];

export function configContractModuleText(): string {
  const data = {
    allProviderPresets,
    adapterInputValues,
    cascadePolicies,
    canonicalSchemaId,
    configFieldMetadata,
    configSchemaFileName,
    defaultEnvironments,
    defaultMigrationHistoryTable,
    defaultSync,
    defaultTypesFile,
    defaultZodFile,
    defaultWorkflow,
    destructiveChangesPolicies,
    deploySafetyPolicies,
    generatedOutputPolicies,
    genericMigrationsDir,
    genericProviderId,
    genericProviderPreset,
    genericSchemaPath,
    localSchemaRef,
    migrationCheckPolicies,
    migrationSyncPolicies,
    migrationVerifyPolicies,
    normalizePolicies,
    packageSchemaRef,
    providerMigrationsDirs,
    providerPresets,
    providerSchemaPaths,
    renameDetectionPolicies,
    runtimeSourcePrefixes,
    schemaDiffPolicies,
    sourceAuto,
    sourcePrefixes,
    supabaseManagedSchemas,
    supportedValidators,
    syncTargetModes,
    syncTargetRunners,
    transactionModes,
    typeUsagePolicies,
  };
  return `const contract = JSON.parse(\`${JSON.stringify(data, null, 2)}\`);

export const configSchemaFileName = contract.configSchemaFileName;
export const canonicalSchemaId = contract.canonicalSchemaId;
export const packageSchemaRef = contract.packageSchemaRef;
export const localSchemaRef = contract.localSchemaRef;
export const genericProviderId = contract.genericProviderId;
export const genericSchemaPath = contract.genericSchemaPath;
export const genericMigrationsDir = contract.genericMigrationsDir;
export const defaultTypesFile = contract.defaultTypesFile;
export const defaultZodFile = contract.defaultZodFile;
export const defaultMigrationHistoryTable = contract.defaultMigrationHistoryTable;
export const defaultEnvironments = contract.defaultEnvironments;
export const defaultSync = contract.defaultSync;
export const adapterInputValues = contract.adapterInputValues;
export const defaultWorkflow = contract.defaultWorkflow;
export const supabaseManagedSchemas = contract.supabaseManagedSchemas;
export const supportedValidators = contract.supportedValidators;
export const sourceAuto = contract.sourceAuto;
export const runtimeSourcePrefixes = contract.runtimeSourcePrefixes;
export const sourcePrefixes = contract.sourcePrefixes;
export const schemaDiffPolicies = contract.schemaDiffPolicies;
export const migrationCheckPolicies = contract.migrationCheckPolicies;
export const migrationVerifyPolicies = contract.migrationVerifyPolicies;
export const migrationSyncPolicies = contract.migrationSyncPolicies;
export const deploySafetyPolicies = contract.deploySafetyPolicies;
export const generatedOutputPolicies = contract.generatedOutputPolicies;
export const typeUsagePolicies = contract.typeUsagePolicies;
export const syncTargetModes = contract.syncTargetModes;
export const syncTargetRunners = contract.syncTargetRunners;
export const destructiveChangesPolicies = contract.destructiveChangesPolicies;
export const normalizePolicies = contract.normalizePolicies;
export const renameDetectionPolicies = contract.renameDetectionPolicies;
export const transactionModes = contract.transactionModes;
export const cascadePolicies = contract.cascadePolicies;
export const providerPresets = contract.providerPresets;
export const genericProviderPreset = contract.genericProviderPreset;
export const allProviderPresets = contract.allProviderPresets;
export const providerSchemaPaths = contract.providerSchemaPaths;
export const providerMigrationsDirs = contract.providerMigrationsDirs;
export const configFieldMetadata = contract.configFieldMetadata;

export function canonicalSourceTo(schemaPaths = [genericSchemaPath]) {
  return \`dir:\${schemaPaths[0] ?? genericSchemaPath}\`;
}

export function parseRuntimeSource(source) {
  for (const prefix of runtimeSourcePrefixes) {
    if (!source.startsWith(prefix)) {
      continue;
    }
    return {
      kind: prefix.slice(0, -1),
      payload: source.slice(prefix.length),
    };
  }
}

export function isRuntimeSource(source) {
  return parseRuntimeSource(source) !== undefined;
}

export function isConfigSource(source, allowAuto) {
  return (allowAuto && source === sourceAuto) || isRuntimeSource(source);
}

export function sourceHint(allowAuto) {
  return \`Use \${allowAuto ? '"auto" or ' : ""}\${runtimeSourcePrefixes.join(", ")}.\`;
}

export function providerPreset(providerId) {
  return allProviderPresets.find((preset) => preset.id === providerId) ?? genericProviderPreset;
}

export function managedSchemasForProvider(providerId) {
  return [...providerPreset(providerId).managedSchemas];
}

export function syncForInstalledConfig(options = {}) {
  if (options.providerId === "supabase") {
    return {
      targets: {
        local: {
          mode: "auto",
          runner: "supabase-cli",
          historyTable: defaultMigrationHistoryTable,
        },
        remote: {
          mode: "manual",
          runner: "supabase-cli",
          historyTable: defaultMigrationHistoryTable,
          requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          remote: true,
        },
      },
    };
  }
  const localDatabaseUrl = databaseUrlEnvReference(options.localDatabaseUrlEnv);
  const remoteDatabaseUrl = databaseUrlEnvReference(options.remoteDatabaseUrlEnv);
  return {
    targets: {
      local: {
        mode: "auto",
        runner: "direct",
        ...(localDatabaseUrl === undefined ? {} : { databaseUrl: localDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
      },
      remote: {
        mode: "manual",
        runner: "direct",
        ...(remoteDatabaseUrl === undefined ? {} : { databaseUrl: remoteDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
        requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
        remote: true,
      },
    },
  };
}

function databaseUrlEnvReference(name) {
  if (typeof name !== "string") {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  return trimmed.startsWith("$") ? trimmed : \`$\${trimmed}\`;
}

export function createInstalledConfig(options = {}) {
  const provider = providerPreset(options.providerId);
  const schemaPaths = normalizedStringArray(options.schemaPaths, [provider.schemaPath]);
  const migrationsDir = normalizedString(options.migrationsDir, provider.migrationsDir);
  const sync = syncForInstalledConfig({ ...options, providerId: provider.id });
  return orderInstalledConfig({
    $schema: options.schemaRef ?? packageSchemaRef,
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: defaultEnvironments,
    excludedGrantRoles: [],
    hints: { allowedGrantees: [], destructive: [], requiredPolicyColumns: {}, renames: [] },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    sync,
    migrationsDir,
    typesFile: defaultTypesFile,
    zodFile: defaultZodFile,
    normalize: "deparse",
    managedSchemas: managedSchemasForProvider(provider.id),
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths,
    schemas: { exclude: [], include: [] },
    sources: { from: "auto", to: canonicalSourceTo(schemaPaths) },
    statementTimeout: "60s",
    transactionMode: "per-migration",
    validators: ["internal-parser"],
  });
}

export function mergeInstalledConfig(existing, options = {}) {
  const base = createInstalledConfig(options);
  if (!isRecord(existing)) {
    return base;
  }
  const baseSync = isRecord(base.sync) ? base.sync : defaultSync;
  const schemaPaths = normalizedStringArray(existing.schemaPaths, base.schemaPaths);
  const existingEnvironments = isRecord(existing.environments) ? existing.environments : undefined;
  const hasExistingEnvironments =
    existingEnvironments !== undefined && !isLegacyDefaultEnvironments(existingEnvironments);
  const existingSync = normalizeInstalledSync(
    isRecord(existing.sync) ? existing.sync : undefined,
    existingEnvironments !== undefined && isLegacyDefaultEnvironments(existingEnvironments),
    baseSync
  );
  const existingWorkflow = isRecord(existing.workflow)
    ? normalizeInstalledWorkflow(existing.workflow)
    : {};
  const merged = {
    ...base,
    ...existing,
    $schema: normalizedString(existing.$schema, base.$schema),
    adapter: "auto",
    environments: hasExistingEnvironments ? existingEnvironments : base.environments,
    excludedGrantRoles: normalizedStringArray(existing.excludedGrantRoles, base.excludedGrantRoles),
    hints: { ...base.hints, ...(isRecord(existing.hints) ? existing.hints : {}) },
    managedSchemas: normalizedStringArray(existing.managedSchemas, base.managedSchemas),
    migrationsDir: normalizedString(existing.migrationsDir, base.migrationsDir),
    schemaPaths,
    schemas: { ...base.schemas, ...(isRecord(existing.schemas) ? existing.schemas : {}) },
    sources: { ...base.sources, ...(isRecord(existing.sources) ? existing.sources : {}) },
    sync:
      hasExistingEnvironments && existingSync === undefined
        ? { targets: {} }
        : { ...baseSync, ...(existingSync ?? {}) },
    workflow: { ...base.workflow, ...existingWorkflow },
    typesFile: normalizedString(existing.typesFile, base.typesFile),
    validators: normalizedStringArray(existing.validators, base.validators),
    zodFile: normalizedString(existing.zodFile, base.zodFile),
  };
  if (typeof merged.sources.to !== "string" || merged.sources.to.length === 0) {
    merged.sources.to = canonicalSourceTo(schemaPaths);
  }
  if (typeof merged.sources.from !== "string" || merged.sources.from.length === 0) {
    merged.sources.from = "auto";
  }
  return orderInstalledConfig(merged);
}

function normalizeInstalledWorkflow(workflow) {
  const next = { ...workflow };
  if (next.migration_sync === "explicit_request_only") {
    next.migration_sync = "manual";
  }
  return next;
}

function isLegacyDefaultEnvironments(environments) {
  const entries = Object.entries(environments);
  if (entries.length !== 2) {
    return false;
  }
  return (
    environmentDatabaseUrl(environments.local) === "$LOCAL_DATABASE_URL" &&
    environmentDatabaseUrl(environments.production) === "$PRODUCTION_DATABASE_URL"
  );
}

function environmentDatabaseUrl(value) {
  const record = isRecord(value) ? value : undefined;
  return typeof record?.databaseUrl === "string" ? record.databaseUrl : undefined;
}

function normalizeInstalledSync(sync, legacyDefaultEnvironments, baseSync) {
  if (sync === undefined || !legacyDefaultEnvironments) {
    return sync;
  }
  const targets = isRecord(sync.targets) ? sync.targets : undefined;
  if (targets === undefined) {
    return sync;
  }
  const normalizedTargets = {};
  for (const [name, value] of Object.entries(targets)) {
    normalizedTargets[name] = normalizeLegacyDefaultSyncTarget(name, value, baseSync);
  }
  return { ...sync, targets: normalizedTargets };
}

function normalizeLegacyDefaultSyncTarget(name, value, baseSync) {
  if (!isRecord(value)) {
    return value;
  }
  if (name !== "local" && name !== "remote") {
    return value;
  }
  const legacyEnvironment = name === "local" ? "local" : "production";
  if (value.environment !== legacyEnvironment || value.databaseUrl !== undefined) {
    return value;
  }
  const baseTargets = isRecord(baseSync.targets) ? baseSync.targets : {};
  return baseTargets[name] ?? value;
}

export function orderInstalledConfig(config) {
  return {
    $schema: config.$schema,
    adapter: config.adapter,
    cascade: config.cascade,
    destructiveChanges: config.destructiveChanges,
    environments: config.environments,
    excludedGrantRoles: config.excludedGrantRoles,
    hints: config.hints,
    idempotency: config.idempotency,
    lockTimeout: config.lockTimeout,
    workflow: config.workflow,
    sync: config.sync,
    migrationsDir: config.migrationsDir,
    typesFile: config.typesFile,
    zodFile: config.zodFile,
    normalize: config.normalize,
    managedSchemas: config.managedSchemas,
    postgresVersion: config.postgresVersion,
    renameDetection: config.renameDetection,
    schemaPaths: config.schemaPaths,
    schemas: config.schemas,
    sources: config.sources,
    statementTimeout: config.statementTimeout,
    transactionMode: config.transactionMode,
    validators: config.validators,
  };
}

function normalizedString(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizedStringArray(value, fallback) {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : [...fallback];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
`;
}

function normalizedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizedStringArray(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : [...fallback];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
