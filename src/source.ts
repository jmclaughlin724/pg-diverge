import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { extractCatalogModel } from "./catalog.js";
import { resolveConfig } from "./config.js";
import type {
  Diagnostic,
  ExtractOptions,
  PgDivergeConfig,
  SchemaModel,
  SchemaObject,
} from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { fingerprintObjects, MODEL_FORMAT_VERSION } from "./hash.js";
import { normalizeSourceObjects } from "./source-normalize.js";
import { extractObjectsFromSql } from "./sql/extract.js";

const execFileAsync = promisify(execFile);

type SqlFile = {
  path: string;
  sql: string;
};

type CatalogSnapshot = {
  diagnostics?: Diagnostic[];
  fingerprint?: string;
  formatVersion?: number;
  objects?: SchemaObject[];
};

export async function extractSourceModel(
  source: string,
  options: ExtractOptions = {},
): Promise<SchemaModel> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveConfig(options.config);
  return applyConfigModelFilters(await extractRawModel(source, cwd, config), config);
}

async function extractRawModel(
  source: string,
  cwd: string,
  config: PgDivergeConfig,
): Promise<SchemaModel> {
  if (source.startsWith("catalog:")) {
    return readCatalogSource(source.slice("catalog:".length), cwd, source);
  }
  if (source.startsWith("database:")) {
    const databaseUrl = resolveDatabaseUrl(source.slice("database:".length));
    return extractCatalogModel({
      databaseUrl,
      normalize: config.normalize === "deparse",
      source,
    });
  }
  if (source.startsWith("dump:")) {
    const target = source.slice("dump:".length);
    if (target === "-") {
      const sql = await readAllStdin();
      return modelFromSqlFiles([{ path: "<stdin>", sql }], source, config);
    }
    const path = resolve(cwd, target);
    const sql = await readFile(path, "utf8");
    return modelFromSqlFiles([{ path, sql }], source, config);
  }
  if (source.startsWith("dir:")) {
    const root = resolve(cwd, source.slice("dir:".length));
    const files = await readSqlFiles(root);
    return modelFromSqlFiles(files, source, config);
  }
  if (source.startsWith("git:")) {
    const ref = source.slice("git:".length) || "HEAD";
    const files = await readGitSqlFiles(ref, cwd, config.schemaPaths);
    return modelFromSqlFiles(files, source, config);
  }
  throw new Error(`unsupported source "${source}"`);
}

const schemaScopedDiagnosticCodes = new Set([
  "PD_EXTRACT_SIDE_EFFECT_UNSUPPORTED",
  "PD_EXTRACT_UNSUPPORTED",
]);

export function filterModelBySchemas(model: SchemaModel, schemas: Set<string>): SchemaModel {
  if (schemas.size === 0) {
    return model;
  }
  // An include list defines the contract scope: extraction findings for
  // statements that reference no in-scope schema (managed-schema bootstrap,
  // out-of-contract partition wiring) must not block in-scope diffs.
  const filtered = withObjects(
    model,
    model.objects.filter((object) => schemas.has(objectSchema(object))),
  );
  return {
    ...filtered,
    diagnostics: filtered.diagnostics.filter(
      (item) =>
        !schemaScopedDiagnosticCodes.has(item.code) ||
        (item.schemas ?? []).some((schema) => schemas.has(schema)),
    ),
  };
}

function applyConfigModelFilters(model: SchemaModel, config: PgDivergeConfig): SchemaModel {
  let current = model;
  if (config.schemas.include.length > 0) {
    current = filterModelBySchemas(current, new Set(config.schemas.include));
  }
  if (config.schemas.exclude.length > 0) {
    const excluded = new Set(config.schemas.exclude);
    current = withObjects(
      current,
      current.objects.filter((object) => !excluded.has(objectSchema(object))),
    );
    current = {
      ...current,
      diagnostics: current.diagnostics.filter(
        (item) =>
          !schemaScopedDiagnosticCodes.has(item.code) ||
          (item.schemas ?? []).length === 0 ||
          (item.schemas ?? []).some((schema) => !excluded.has(schema)),
      ),
    };
  }
  if (config.excludedGrantRoles.length > 0) {
    const roles = new Set(config.excludedGrantRoles);
    current = withObjects(
      current,
      current.objects.filter((object) => !isExcludedGrant(object, roles)),
    );
  }
  return current;
}

function withObjects(model: SchemaModel, objects: SchemaObject[]): SchemaModel {
  if (objects.length === model.objects.length) {
    return model;
  }
  return { ...model, fingerprint: fingerprintObjects(objects), objects };
}

function objectSchema(object: SchemaObject): string {
  if (object.ref.kind === "schema") {
    return object.ref.name;
  }
  if (object.ref.kind === "extension" && typeof object.metadata.schema === "string") {
    return object.metadata.schema;
  }
  return object.ref.schema ?? "public";
}

function isExcludedGrant(object: SchemaObject, roles: Set<string>): boolean {
  if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
    return false;
  }
  const grantee = typeof object.metadata.grantee === "string" ? object.metadata.grantee : undefined;
  const forRole = typeof object.metadata.forRole === "string" ? object.metadata.forRole : undefined;
  return (
    (grantee !== undefined && roles.has(grantee)) || (forRole !== undefined && roles.has(forRole))
  );
}
async function readCatalogSource(path: string, cwd: string, source: string): Promise<SchemaModel> {
  const fullPath = resolve(cwd, path);
  const raw = JSON.parse(await readFile(fullPath, "utf8")) as CatalogSnapshot;
  const objects = Array.isArray(raw.objects) ? raw.objects : [];
  const diagnostics = Array.isArray(raw.diagnostics) ? raw.diagnostics : [];
  if (raw.formatVersion !== MODEL_FORMAT_VERSION) {
    diagnostics.push(
      diagnostic(
        "PD_CATALOG_SNAPSHOT_VERSION",
        "warning",
        `catalog snapshot model version ${raw.formatVersion ?? "unknown"} does not match this pg-diverge model version ${MODEL_FORMAT_VERSION}`,
        {
          file: fullPath,
          hint: "Object hashes are version-specific; regenerate the snapshot with `pg-diverge inspect` to avoid false replacements.",
        },
      ),
    );
  }
  const model: SchemaModel = {
    diagnostics,
    fingerprint: raw.fingerprint ?? fingerprintObjects(objects),
    objects,
    source,
  };
  if (raw.formatVersion !== undefined) {
    model.formatVersion = raw.formatVersion;
  }
  return model;
}
async function modelFromSqlFiles(
  files: SqlFile[],
  source: string,
  config: PgDivergeConfig,
): Promise<SchemaModel> {
  const extractedObjects: SchemaObject[] = [];
  const diagnostics: Diagnostic[] = [];
  let ordinal = 0;
  for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
    const extracted = await extractObjectsFromSql(file.sql, {
      config,
      file: file.path,
      startOrdinal: ordinal,
    });
    extractedObjects.push(...extracted.objects);
    diagnostics.push(...extracted.diagnostics);
    ordinal = extracted.nextOrdinal;
  }
  const objects = await normalizeSourceObjects(extractedObjects, diagnostics, {
    normalize: config.normalize === "deparse",
  });
  diagnostics.push(...duplicateKeyDiagnostics(objects));
  return {
    diagnostics,
    fingerprint: fingerprintObjects(objects),
    formatVersion: MODEL_FORMAT_VERSION,
    objects: objects.sort((left, right) => left.ordinal - right.ordinal),
    source,
  };
}
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readSqlFiles(root: string): Promise<SqlFile[]> {
  const files: SqlFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && extname(entry.name) === ".sql") {
        files.push({
          path: relative(root, fullPath),
          sql: await readFile(fullPath, "utf8"),
        });
      }
    }
  }
  await walk(root);
  return files;
}
async function readGitSqlFiles(
  ref: string,
  cwd: string,
  schemaPaths: string[],
): Promise<SqlFile[]> {
  const files: SqlFile[] = [];
  for (const schemaPath of schemaPaths) {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "ls-tree", "-r", "--name-only", ref, "--", schemaPath],
      { maxBuffer: 1024 * 1024 * 10 },
    );
    const paths = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".sql"));
    for (const path of paths) {
      const { stdout: sql } = await execFileAsync("git", ["-C", cwd, "show", `${ref}:${path}`], {
        maxBuffer: 1024 * 1024 * 20,
      });
      files.push({ path, sql });
    }
  }
  return files;
}
function resolveDatabaseUrl(value: string): string {
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    const resolved = process.env[envName];
    if (!resolved) {
      throw new Error(`environment variable ${envName} is not set`);
    }
    return resolved;
  }
  return value;
}
function duplicateKeyDiagnostics(objects: SchemaObject[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, SchemaObject>();
  for (const object of objects) {
    const previous = seen.get(object.key);
    if (previous) {
      diagnostics.push(
        diagnostic("PD_EXTRACT_DUPLICATE_OBJECT", "error", "duplicate object identity", {
          file: object.file,
          hint: `first seen in ${previous.file ?? "unknown source"}`,
          ref: object.ref,
        }),
      );
      continue;
    }
    seen.set(object.key, object);
  }
  return diagnostics;
}
