import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const hintsSchema = z
  .object({
    destructive: z.array(z.string()).default([]),
    renames: z
      .array(
        z.strictObject({
          from: z.string(),
          to: z.string(),
        }),
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

export const pgDivergeConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  adapter: z.enum(["supabase-auto", "postgres"]).default("supabase-auto"),
  cascade: z.literal("never").default("never"),
  destructiveChanges: z.enum(["hint-required", "block", "allow"]).default("hint-required"),
  environments: z.record(z.string(), environmentSchema).default({}),
  excludedGrantRoles: z.array(z.string()).default([]),
  hints: hintsSchema,
  idempotency: z.literal("required").default("required"),
  lockTimeout: z.string().default("5s"),
  normalize: z.enum(["off", "deparse"]).default("off"),
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
  schemaPaths: z.array(z.string()).default(["supabase/schemas"]),
  schemas: schemaFilterSchema,
  statementTimeout: z.string().default("60s"),
  transactionMode: z.enum(["per-migration", "per-statement"]).default("per-migration"),
  validators: z.array(z.string()).default(["internal-parser"]),
});

export type PgDivergeConfig = z.infer<typeof pgDivergeConfigSchema>;

export const defaultConfig: PgDivergeConfig = pgDivergeConfigSchema.parse({});

export function resolveConfig(config?: Partial<PgDivergeConfig>): PgDivergeConfig {
  return pgDivergeConfigSchema.parse(config ?? {});
}

const moduleConfigFiles = ["pg-diverge.config.mjs", "pg-diverge.config.js"];

export async function loadConfig(
  cwd: string = process.cwd(),
  explicitPath?: string,
): Promise<PgDivergeConfig> {
  if (explicitPath) {
    const path = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    return loadConfigFile(path);
  }
  const fromJson = await tryLoadJsonConfig(resolve(cwd, "pg-diverge.config.json"));
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

async function loadConfigFile(path: string): Promise<PgDivergeConfig> {
  if (path.endsWith(".mjs") || path.endsWith(".js")) {
    const loaded = await tryLoadModuleConfig(path);
    if (!loaded) {
      throw new Error(`config module not found at ${path}`);
    }
    return loaded;
  }
  const raw = await readFile(path, "utf8");
  return resolveConfig(JSON.parse(raw) as Partial<PgDivergeConfig>);
}

async function tryLoadJsonConfig(path: string): Promise<PgDivergeConfig | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return resolveConfig(JSON.parse(raw) as Partial<PgDivergeConfig>);
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function tryLoadModuleConfig(path: string): Promise<PgDivergeConfig | undefined> {
  try {
    const module = (await import(pathToFileURL(path).href)) as {
      default?: Partial<PgDivergeConfig>;
    };
    return resolveConfig(module.default ?? {});
  } catch (error) {
    if (isFileMissing(error) || isModuleMissing(error)) {
      return undefined;
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
  $schema: "./node_modules/pg-diverge/config-schema.json",
  ...defaultConfig,
};
delete (scaffoldConfig as { environments?: unknown }).environments;

export const defaultConfigFile = `${JSON.stringify(scaffoldConfig, null, 2)}\n`;

export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(pgDivergeConfigSchema, { io: "input" }) as Record<string, unknown>;
}
