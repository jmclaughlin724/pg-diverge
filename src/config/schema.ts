import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { diagnostic, diagnosticCatalog, formatDiagnostic } from "../diagnostics.js";
import { redactSecrets } from "../redaction.js";
import {
  AdapterInput,
  adapterInputValues,
  canonicalSchemaId,
  canonicalSourceTo,
  configFieldMetadata,
  createInstalledConfig,
  DestructiveChangesPolicy,
  defaultEnvironments,
  defaultSync,
  defaultTypesFile,
  defaultWorkflow,
  defaultZodFile,
  deploySafetyPolicies,
  destructiveChangesPolicies,
  generatedOutputPolicies,
  genericMigrationsDir,
  genericSchemaPath,
  migrationCheckPolicies,
  migrationSyncPolicies,
  migrationVerifyPolicies,
  NormalizePolicy,
  normalizePolicies,
  RenameDetectionPolicy,
  renameDetectionPolicies,
  schemaDiffPolicies,
  sourceAuto,
  syncTargetModes,
  syncTargetRunners,
  TransactionMode,
  transactionModes,
  typeUsagePolicies,
} from "./contract.js";

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
} from "./contract.js";

const hintsSchema = z
  .strictObject({
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
  .default({
    allowedGrantees: [],
    destructive: [],
    requiredPolicyColumns: {},
    renames: [],
  });

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

export function isFileMissing(error: unknown): boolean {
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
        'Default before-state source. For generation, "auto" resolves git:HEAD as a candidate baseline, then empty: only for a first migration with no existing migration corpus. Existing generated migrations must prove the same baseline through lineage.';
      from.examples = [
        "auto",
        "git:HEAD",
        "empty:",
        "dir:baseline/schemas",
        "database:$DATABASE_URL",
      ];
      from.oneOf = [
        { const: sourceAuto },
        {
          type: "string",
          not: { const: sourceAuto },
          "x-supaschema-source-parser": "parseRuntimeSource",
        },
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
      "Named apply targets for supaschema sync. workflow.migration_sync is the global apply policy; bare sync may select at most one target with mode auto.";
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
    'Global apply policy for supaschema sync: disable apply, require explicit --target, or let bare sync select one sync.targets entry whose mode is "auto".'
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
    "Controls whether sync refreshes the configured TypeScript output during the full workflow."
  );
  setNestedDescription(
    workflowProperties,
    "zod_generation",
    "Controls whether sync refreshes the configured Zod validator output during the full workflow."
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
