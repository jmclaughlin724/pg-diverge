export const configSchemaFileName = "supaschema-config.schema.json";
export const canonicalSchemaId = `https://supaschema.com/schemas/${configSchemaFileName}`;
export const packageSchemaRef = `./node_modules/supaschema/${configSchemaFileName}`;
export const localSchemaRef = `./${configSchemaFileName}`;
export const genericProviderId = "postgres";
export const genericSchemaPath = "database/schemas";
export const genericMigrationsDir = "database/migrations";
export const defaultTypesFile = "database.types.ts";
export const defaultZodFile = "database.zod.ts";
export const adapterInputValues = ["auto", "postgres", "supabase", "supabase-auto"] as const;

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
] as const;

export const supportedValidators = [
  "internal-parser",
  "squawk",
  "squawk-cli",
  "pgls",
  "postgres-language-server",
  "@postgres-language-server/cli",
  "sqlfluff",
  "pg-formatter",
  "pgformatter",
] as const;

export const sourceAuto = "auto";
export const runtimeSourcePrefixes = ["dir:", "git:", "database:", "dump:", "catalog:"] as const;
export const sourcePrefixes = [sourceAuto, ...runtimeSourcePrefixes] as const;
export const sourceSpecPattern = "^(?:(?:dir|database|dump|catalog):.+|git:.*)$";
export const schemaDiffPolicies = ["disabled", "manual", "on_schema_write"] as const;
export const migrationCheckPolicies = [
  "manual",
  "after_schema_diff",
  "required_before_complete",
] as const;
export const migrationVerifyPolicies = [
  "manual",
  "suggest_after_check",
  "after_schema_diff",
] as const;
export const migrationSyncPolicies = ["disabled", "explicit_request_only"] as const;
export const generatedOutputPolicies = [
  "disabled",
  "refresh_existing",
  "create_or_refresh",
] as const;
export const typeUsagePolicies = ["typescript_only", "zod_validated"] as const;
export const defaultWorkflow = {
  schema_diff: "on_schema_write",
  migration_check: "after_schema_diff",
  migration_verify: "suggest_after_check",
  migration_sync: "explicit_request_only",
  type_generation: "create_or_refresh",
  zod_generation: "create_or_refresh",
  type_usage: "zod_validated",
} as const;

export type SchemaDiffPolicy = (typeof schemaDiffPolicies)[number];
export type MigrationCheckPolicy = (typeof migrationCheckPolicies)[number];
export type MigrationVerifyPolicy = (typeof migrationVerifyPolicies)[number];
export type MigrationSyncPolicy = (typeof migrationSyncPolicies)[number];
export type GeneratedOutputPolicy = (typeof generatedOutputPolicies)[number];
export type TypeUsagePolicy = (typeof typeUsagePolicies)[number];

export interface SupaschemaWorkflow {
  migration_check: MigrationCheckPolicy;
  migration_sync: MigrationSyncPolicy;
  migration_verify: MigrationVerifyPolicy;
  schema_diff: SchemaDiffPolicy;
  type_generation: GeneratedOutputPolicy;
  type_usage: TypeUsagePolicy;
  zod_generation: GeneratedOutputPolicy;
}

export type RuntimeSourceKind = "catalog" | "database" | "dir" | "dump" | "git";

export interface ParsedRuntimeSource {
  kind: RuntimeSourceKind;
  payload: string;
}

export interface ProviderMarker {
  contentTerms?: string[];
  fileNames?: string[];
  path?: string;
}

export interface ProviderPreset {
  adapter: "auto";
  id: string;
  label: string;
  managedSchemas: string[];
  markers: ProviderMarker[];
  migrationsDir: string;
  schemaPath: string;
}

export const providerPresets = [
  {
    adapter: "auto",
    id: "supabase",
    label: "Supabase",
    managedSchemas: [...supabaseManagedSchemas],
    markers: [{ path: "supabase/config.toml" }],
    migrationsDir: "supabase/migrations",
    schemaPath: "supabase/schemas",
  },
  {
    adapter: "auto",
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
    adapter: "auto",
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
    adapter: "auto",
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
    adapter: "auto",
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
    adapter: "auto",
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
] as const satisfies readonly ProviderPreset[];

export const genericProviderPreset = {
  adapter: "auto",
  id: genericProviderId,
  label: "PostgreSQL",
  managedSchemas: [],
  markers: [],
  migrationsDir: genericMigrationsDir,
  schemaPath: genericSchemaPath,
} as const satisfies ProviderPreset;

export const allProviderPresets = [genericProviderPreset, ...providerPresets] as const;
export const providerSchemaPaths = providerPresets.map((preset) => preset.schemaPath);
export const providerMigrationsDirs = providerPresets.map((preset) => preset.migrationsDir);

export interface InstalledConfigOptions {
  migrationsDir?: string;
  providerId?: string;
  schemaPaths?: string[];
  schemaRef?: string;
}

export function canonicalSourceTo(schemaPaths: readonly string[] = [genericSchemaPath]): string {
  return `dir:${schemaPaths[0] ?? genericSchemaPath}`;
}

export function parseRuntimeSource(source: string): ParsedRuntimeSource | undefined {
  for (const prefix of runtimeSourcePrefixes) {
    if (!source.startsWith(prefix)) {
      continue;
    }
    return {
      kind: prefix.slice(0, -1) as RuntimeSourceKind,
      payload: source.slice(prefix.length),
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

export function createInstalledConfig(
  options: InstalledConfigOptions = {}
): Record<string, unknown> {
  const provider = providerPreset(options.providerId);
  const schemaPaths = normalizedStringArray(options.schemaPaths, [provider.schemaPath]);
  const migrationsDir = normalizedString(options.migrationsDir, provider.migrationsDir);
  return orderInstalledConfig({
    $schema: options.schemaRef ?? packageSchemaRef,
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: {},
    excludedGrantRoles: [],
    hints: {
      destructive: [],
      renames: [],
    },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    migrationsDir,
    typesFile: defaultTypesFile,
    zodFile: defaultZodFile,
    normalize: "deparse",
    managedSchemas: managedSchemasForProvider(provider.id),
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths,
    schemas: {
      exclude: [],
      include: [],
    },
    sources: {
      from: "auto",
      to: canonicalSourceTo(schemaPaths),
    },
    statementTimeout: "60s",
    transactionMode: "per-migration",
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
  const schemaPaths = normalizedStringArray(existing.schemaPaths, base.schemaPaths as string[]);
  const merged = {
    ...base,
    ...existing,
    $schema: normalizedString(existing.$schema, base.$schema as string),
    adapter: "auto",
    environments: isRecord(existing.environments) ? existing.environments : base.environments,
    excludedGrantRoles: normalizedStringArray(
      existing.excludedGrantRoles,
      base.excludedGrantRoles as string[]
    ),
    hints: {
      ...(base.hints as Record<string, unknown>),
      ...(isRecord(existing.hints) ? existing.hints : {}),
    },
    managedSchemas: normalizedStringArray(existing.managedSchemas, base.managedSchemas as string[]),
    migrationsDir: normalizedString(existing.migrationsDir, base.migrationsDir as string),
    schemaPaths,
    schemas: {
      ...(base.schemas as Record<string, unknown>),
      ...(isRecord(existing.schemas) ? existing.schemas : {}),
    },
    sources: {
      ...(base.sources as Record<string, unknown>),
      ...(isRecord(existing.sources) ? existing.sources : {}),
    },
    workflow: {
      ...(base.workflow as Record<string, unknown>),
      ...(isRecord(existing.workflow) ? existing.workflow : {}),
    },
    typesFile: normalizedString(existing.typesFile, base.typesFile as string),
    validators: normalizedStringArray(existing.validators, base.validators as string[]),
    zodFile: normalizedString(existing.zodFile, base.zodFile as string),
  };
  const sources = merged.sources as Record<string, unknown>;
  if (typeof sources.to !== "string" || sources.to.length === 0) {
    sources.to = canonicalSourceTo(schemaPaths);
  }
  if (typeof sources.from !== "string" || sources.from.length === 0) {
    sources.from = "auto";
  }
  return orderInstalledConfig(merged);
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

export const configFieldMetadata = [
  {
    default: "Generated configs point to the package schema.",
    description:
      "JSON Schema pointer for editor autocomplete and validation. The loader ignores it.",
    examples: [packageSchemaRef, localSchemaRef],
    key: "$schema",
  },
  {
    allowed: [...adapterInputValues],
    default: "auto",
    description:
      "Provider-neutral adapter sentinel. Legacy adapter strings are accepted at the input boundary and normalized to auto.",
    key: "adapter",
  },
  {
    allowed: ["never"],
    default: "never",
    description: "CASCADE is never emitted by generated migrations.",
    key: "cascade",
  },
  {
    allowed: ["hint-required", "block", "allow"],
    default: "hint-required",
    description:
      "Controls whether destructive operations require exact hints, always block, or are allowed.",
    key: "destructiveChanges",
  },
  {
    default: {},
    description:
      "Named database URL references for --env. Use $ENV_NAME values instead of committed credentials.",
    examples: [{ staging: { databaseUrl: "$STAGING_DB" } }],
    key: "environments",
  },
  {
    default: [],
    description:
      "Grant/default-privilege roles to remove from extracted models, usually provider platform roles.",
    key: "excludedGrantRoles",
  },
  {
    default: { destructive: [], renames: [] },
    description: "Reviewed destructive-change and rename hints using exact object keys.",
    key: "hints",
  },
  {
    allowed: ["required"],
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
      "Agent and hook workflow policy for schema diffs, migration checks, verification, explicit migration sync, and generated type/Zod output refresh.",
    key: "workflow",
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
    allowed: ["off", "deparse"],
    default: "deparse",
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
    allowed: ["hints-only", "off"],
    default: "hints-only",
    description: "Controls whether reviewed hints can render guarded renames.",
    key: "renameDetection",
  },
  {
    default: [genericSchemaPath],
    description: "Declarative SQL tree directories. The first path owns the default sources.to.",
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
    default: { from: "auto", to: canonicalSourceTo([genericSchemaPath]) },
    description: "Default before/after sources for zero-source-flag diff, plan, and verify.",
    examples: [
      { from: "auto", to: "dir:database/schemas" },
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
    allowed: ["per-migration", "per-statement"],
    default: "per-migration",
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
] as const;

export function configContractModuleText(): string {
  const data = {
    allProviderPresets,
    adapterInputValues,
    canonicalSchemaId,
    configFieldMetadata,
    configSchemaFileName,
    defaultTypesFile,
    defaultZodFile,
    defaultWorkflow,
    generatedOutputPolicies,
    genericMigrationsDir,
    genericProviderId,
    genericProviderPreset,
    genericSchemaPath,
    localSchemaRef,
    migrationCheckPolicies,
    migrationSyncPolicies,
    migrationVerifyPolicies,
    packageSchemaRef,
    providerMigrationsDirs,
    providerPresets,
    providerSchemaPaths,
    runtimeSourcePrefixes,
    schemaDiffPolicies,
    sourceAuto,
    sourcePrefixes,
    sourceSpecPattern,
    supabaseManagedSchemas,
    supportedValidators,
    typeUsagePolicies,
  };
  return `// Generated by src/config-schema-gen.ts from src/config-contract.ts. Do not edit by hand.
const contract = JSON.parse(\`${JSON.stringify(data, null, 2)}\`);

export const configSchemaFileName = contract.configSchemaFileName;
export const canonicalSchemaId = contract.canonicalSchemaId;
export const packageSchemaRef = contract.packageSchemaRef;
export const localSchemaRef = contract.localSchemaRef;
export const genericProviderId = contract.genericProviderId;
export const genericSchemaPath = contract.genericSchemaPath;
export const genericMigrationsDir = contract.genericMigrationsDir;
export const defaultTypesFile = contract.defaultTypesFile;
export const defaultZodFile = contract.defaultZodFile;
export const adapterInputValues = contract.adapterInputValues;
export const defaultWorkflow = contract.defaultWorkflow;
export const supabaseManagedSchemas = contract.supabaseManagedSchemas;
export const supportedValidators = contract.supportedValidators;
export const sourceAuto = contract.sourceAuto;
export const runtimeSourcePrefixes = contract.runtimeSourcePrefixes;
export const sourcePrefixes = contract.sourcePrefixes;
export const sourceSpecPattern = contract.sourceSpecPattern;
export const schemaDiffPolicies = contract.schemaDiffPolicies;
export const migrationCheckPolicies = contract.migrationCheckPolicies;
export const migrationVerifyPolicies = contract.migrationVerifyPolicies;
export const migrationSyncPolicies = contract.migrationSyncPolicies;
export const generatedOutputPolicies = contract.generatedOutputPolicies;
export const typeUsagePolicies = contract.typeUsagePolicies;
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

export function createInstalledConfig(options = {}) {
  const provider = providerPreset(options.providerId);
  const schemaPaths = normalizedStringArray(options.schemaPaths, [provider.schemaPath]);
  const migrationsDir = normalizedString(options.migrationsDir, provider.migrationsDir);
  return orderInstalledConfig({
    $schema: options.schemaRef ?? packageSchemaRef,
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: {},
    excludedGrantRoles: [],
    hints: { destructive: [], renames: [] },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
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
  const schemaPaths = normalizedStringArray(existing.schemaPaths, base.schemaPaths);
  const merged = {
    ...base,
    ...existing,
    $schema: normalizedString(existing.$schema, base.$schema),
    adapter: "auto",
    environments: isRecord(existing.environments) ? existing.environments : base.environments,
    excludedGrantRoles: normalizedStringArray(existing.excludedGrantRoles, base.excludedGrantRoles),
    hints: { ...base.hints, ...(isRecord(existing.hints) ? existing.hints : {}) },
    managedSchemas: normalizedStringArray(existing.managedSchemas, base.managedSchemas),
    migrationsDir: normalizedString(existing.migrationsDir, base.migrationsDir),
    schemaPaths,
    schemas: { ...base.schemas, ...(isRecord(existing.schemas) ? existing.schemas : {}) },
    sources: { ...base.sources, ...(isRecord(existing.sources) ? existing.sources : {}) },
    workflow: { ...base.workflow, ...(isRecord(existing.workflow) ? existing.workflow : {}) },
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

function normalizedStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : [...fallback];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
