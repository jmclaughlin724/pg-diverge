import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathsOverlap } from "../paths.js";
import { redactSecrets } from "../redaction.js";
import { defaultMigrationHistoryTable, isConfigSource, sourceHint } from "./contract.js";
import { isFileMissing, isRecord, type SupaschemaConfig } from "./schema.js";

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
  if (options.includeInstallState === true) {
    const pendingInstall = await pendingInstallPathConfirmationDiagnostic(cwd, options.configPath);
    if (pendingInstall) {
      return [pendingInstall];
    }
  }

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
    if (pathsOverlap(schemaPath, config.migrationsDir)) {
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

  warnIfRawDatabaseUrl(diagnostics, "sources.from", config.sources.from);
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
    hint: "Inspect .supaschema/install.json agentInstructions, choose the owning paths from candidates, then set schemaPaths and migrationsDir in supaschema.config.json.",
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
    parsed.migrationsDir.trim().length > 0
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
    if (target.environment !== undefined && target.databaseUrl !== undefined) {
      diagnostics.push({
        field: `sync.targets.${name}`,
        hint: "Set at most one of environment or databaseUrl. Omit both to use CLI database URL fallback.",
        message: `sync target ${name} must not define multiple URL owners.`,
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
