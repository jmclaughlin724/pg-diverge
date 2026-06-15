import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { diagnostic, diagnosticCatalog, formatDiagnostic, redactSecrets } from "./diagnostics.js";

const hintsSchema = z
  .object({
    destructive: z.array(z.string()).default([]),
    renames: z
      .array(
        z.strictObject({
          from: z.string(),
          to: z.string(),
        })
      )
      .default([]),
  })
  .default({ destructive: [], renames: [] });

const schemaFilterSchema = z
  .strictObject({
    exclude: z.array(z.string()).default([]),
    include: z.array(z.string()).default([]),
  })
  .default({ exclude: [], include: [] });

const environmentSchema = z.strictObject({
  databaseUrl: z.string(),
});

const sourcesSchema = z
  .strictObject({
    from: z.string().default("auto"),
    to: z.string().optional(),
  })
  .default({ from: "auto" });

const adapterSchema = z.literal("auto").default("auto");

export const supaschemaConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  adapter: adapterSchema,
  cascade: z.literal("never").default("never"),
  destructiveChanges: z.enum(["hint-required", "block", "allow"]).default("hint-required"),
  environments: z.record(z.string(), environmentSchema).default({}),
  excludedGrantRoles: z.array(z.string()).default([]),
  hints: hintsSchema,
  idempotency: z.literal("required").default("required"),
  lockTimeout: z.string().default("5s"),
  migrationsDir: z.string().default("database/migrations"),
  typesFile: z.string().default("database.types.ts"),
  zodFile: z.string().default("database.zod.ts"),
  normalize: z.enum(["off", "deparse"]).default("deparse"),
  managedSchemas: z
    .array(z.string())
    .default([
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
    ]),
  postgresVersion: z.string().default("15+"),
  renameDetection: z.enum(["hints-only", "off"]).default("hints-only"),
  schemaPaths: z.array(z.string()).default(["database/schemas"]),
  schemas: schemaFilterSchema,
  sources: sourcesSchema,
  statementTimeout: z.string().default("60s"),
  transactionMode: z.enum(["per-migration", "per-statement"]).default("per-migration"),
  validators: z.array(z.string()).default(["internal-parser"]),
});

export type SupaschemaConfig = z.infer<typeof supaschemaConfigSchema>;
export type SupaschemaAdapter = z.infer<typeof adapterSchema>;

export const defaultConfig: SupaschemaConfig = supaschemaConfigSchema.parse({});

export function resolveConfig(config?: Partial<SupaschemaConfig>): SupaschemaConfig {
  return supaschemaConfigSchema.parse(normalizeConfigInput(config ?? {}));
}

/**
 * Parse a user-authored config file (e.g. supaschema.config.json) at the trust
 * boundary. On failure this throws a redacted SUPA_CONFIG_INVALID diagnostic so
 * library consumers of loadConfig() get a coded, secret-safe error instead of a
 * raw ZodError. The typed Partial path stays on resolveConfig()/.parse().
 */
function parseUserConfigFile(input: unknown, path: string): SupaschemaConfig {
  const result = supaschemaConfigSchema.safeParse(
    normalizeConfigInput((input ?? {}) as Partial<SupaschemaConfig>)
  );
  if (result.success) {
    return result.data;
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

const moduleConfigFiles = ["supaschema.config.mjs", "supaschema.config.js"];

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
  for (const candidate of moduleConfigFiles) {
    const fromModule = await tryLoadModuleConfig(resolve(cwd, candidate));
    if (fromModule) {
      return fromModule;
    }
  }
  return defaultConfig;
}

async function loadConfigFile(path: string): Promise<SupaschemaConfig> {
  if (path.endsWith(".mjs") || path.endsWith(".js")) {
    const loaded = await tryLoadModuleConfig(path);
    if (!loaded) {
      throw new Error(`config module not found at ${path}`);
    }
    return loaded;
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

async function tryLoadModuleConfig(path: string): Promise<SupaschemaConfig | undefined> {
  try {
    const module = (await import(pathToFileURL(path).href)) as {
      default?: Partial<SupaschemaConfig>;
    };
    return resolveConfig(module.default ?? {});
  } catch (error) {
    if (isFileMissing(error) || isModuleMissing(error)) {
      return;
    }
    throw error;
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isModuleMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
}

const scaffoldConfig = {
  $schema: "./node_modules/supaschema/supaschema-config.schema.json",
  adapter: defaultConfig.adapter,
  cascade: defaultConfig.cascade,
  destructiveChanges: defaultConfig.destructiveChanges,
  environments: defaultConfig.environments,
  excludedGrantRoles: defaultConfig.excludedGrantRoles,
  hints: defaultConfig.hints,
  idempotency: defaultConfig.idempotency,
  lockTimeout: defaultConfig.lockTimeout,
  migrationsDir: defaultConfig.migrationsDir,
  typesFile: defaultConfig.typesFile,
  zodFile: defaultConfig.zodFile,
  normalize: defaultConfig.normalize,
  managedSchemas: defaultConfig.managedSchemas,
  postgresVersion: defaultConfig.postgresVersion,
  renameDetection: defaultConfig.renameDetection,
  schemaPaths: defaultConfig.schemaPaths,
  schemas: defaultConfig.schemas,
  sources: defaultConfig.sources,
  statementTimeout: defaultConfig.statementTimeout,
  transactionMode: defaultConfig.transactionMode,
  validators: defaultConfig.validators,
};

export const defaultConfigFile = `${JSON.stringify(scaffoldConfig, null, 2)}\n`;

export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(supaschemaConfigSchema, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
}

function normalizeConfigInput(config: Partial<SupaschemaConfig>): Partial<SupaschemaConfig> {
  const adapter = (config as { adapter?: unknown }).adapter;
  if (adapter !== "supabase-auto" && adapter !== "supabase" && adapter !== "postgres") {
    return config;
  }
  const normalized: Partial<SupaschemaConfig> = { ...config, adapter: "auto" };
  // Legacy `adapter: "postgres"` was the opt-out from Supabase managed-schema
  // enforcement: before adapters were unified, those checks ran only when the
  // adapter was "auto", and "postgres" was the default. Preserve that
  // provider-neutral posture on upgrade unless the project pins `managedSchemas`,
  // so plain-PostgreSQL trees that own schemas like `auth`/`storage` do not start
  // failing with SUPA_SUPABASE_MANAGED_SCHEMA after the adapter is normalized.
  if (adapter === "postgres" && normalized.managedSchemas === undefined) {
    normalized.managedSchemas = [];
  }
  return normalized;
}
