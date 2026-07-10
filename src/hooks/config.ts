import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "../config/schema.js";
import type { SupaschemaConfig } from "../core.js";
import { resolveDatabaseUrl } from "../database/url.js";
import { rel } from "./targets.js";

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

export interface SchemaPathState {
  candidateMigrationsDirs: string[];
  candidateSchemaPaths: string[];
  confirmationSchemaPaths: string[];
  environments: Record<string, { databaseUrl: string }>;
  migrationsDir?: string;
  pathConfirmationNeeded: boolean;
  schemaPaths: string[];
  sync: SupaschemaConfig["sync"];
  workflow: SupaschemaConfig["workflow"];
}

export interface AutomaticSyncPlan {
  enabled: boolean;
  line?: string;
  reason?: string;
}

export function readSchemaPathState(projectDir: string): SchemaPathState {
  const { environments, explicit, migrationsDir, schemaPaths, sync, workflow } =
    readConfigPathFields(projectDir);
  const manifest = readInstallManifest(projectDir);
  const confirmationNeeded =
    typeof manifest === "object" &&
    manifest !== null &&
    Reflect.get(manifest, "pathConfirmationNeeded") === true;
  if (confirmationNeeded && !explicit) {
    const candidateValue = Reflect.get(manifest, "candidates");
    const candidates =
      typeof candidateValue === "object" &&
      candidateValue !== null &&
      !Array.isArray(candidateValue)
        ? candidateValue
        : {};
    const schemaPathValue = Reflect.get(candidates, "schemaPaths");
    const migrationDirValue = Reflect.get(candidates, "migrationsDirs");
    const candidateSchemaPaths = Array.isArray(schemaPathValue)
      ? schemaPathValue.filter(
          (value): value is string => typeof value === "string" && value !== ""
        )
      : [];
    const candidateMigrationsDirs = Array.isArray(migrationDirValue)
      ? migrationDirValue.filter(
          (value): value is string => typeof value === "string" && value !== ""
        )
      : [];
    return {
      candidateMigrationsDirs,
      candidateSchemaPaths,
      confirmationSchemaPaths: [...new Set([...candidateSchemaPaths, ...schemaPaths])].map((path) =>
        resolve(projectDir, path)
      ),
      environments,
      ...(migrationsDir === undefined ? {} : { migrationsDir }),
      pathConfirmationNeeded: true,
      schemaPaths: schemaPaths.map((path) => resolve(projectDir, path)),
      sync,
      workflow,
    };
  }
  return {
    candidateMigrationsDirs: [],
    candidateSchemaPaths: [],
    confirmationSchemaPaths: schemaPaths.map((path) => resolve(projectDir, path)),
    environments,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    pathConfirmationNeeded: false,
    schemaPaths: schemaPaths.map((path) => resolve(projectDir, path)),
    sync,
    workflow,
  };
}

export function automaticSyncPlan(pathState: SchemaPathState): AutomaticSyncPlan {
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

export function pathConfirmationMessage(
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
    )} because path confirmation is pending from install. Inspect .supaschema/install.json agentInstructions, choose the owning schemaPaths and migrationsDir from the detected candidates, update supaschema.config.json, then run \`supaschema config validate\`, \`supaschema diff\`, and \`supaschema check\`. Candidate schema paths: ${schemaCandidates}. Candidate migrations dirs: ${migrationCandidates}.`;
}

function readConfigPathFields(projectDir: string): {
  environments: Record<string, { databaseUrl: string }>;
  explicit: boolean;
  migrationsDir?: string;
  schemaPaths: string[];
  sync: SupaschemaConfig["sync"];
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
  sync: SupaschemaConfig["sync"];
  workflow: SupaschemaConfig["workflow"];
} {
  const record =
    typeof config === "object" && config !== null && !Array.isArray(config) ? config : {};
  const schemaPathsValue = Reflect.get(record, "schemaPaths");
  const explicitSchemaPaths =
    Array.isArray(schemaPathsValue) && schemaPathsValue.length > 0
      ? schemaPathsValue.filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      : undefined;
  const migrationsDirValue = Reflect.get(record, "migrationsDir");
  const migrationsDir =
    typeof migrationsDirValue === "string" && migrationsDirValue.length > 0
      ? migrationsDirValue
      : undefined;
  const resolved = resolveConfig(record);
  return {
    environments: resolved.environments,
    explicit: explicitSchemaPaths !== undefined && migrationsDir !== undefined,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    schemaPaths: explicitSchemaPaths ?? [defaultSchemaPath(projectDir)],
    sync: resolved.sync,
    workflow: resolved.workflow,
  };
}

function readInstallManifest(projectDir: string): unknown {
  const path = join(projectDir, ".supaschema", "install.json");
  if (!existsSync(path)) {
    return;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}

function automaticSyncTargets(
  targets: SupaschemaConfig["sync"]["targets"]
): [string, SupaschemaConfig["sync"]["targets"][string]][] {
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
  target: SupaschemaConfig["sync"]["targets"][string],
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

function isRemoteSyncTarget(
  name: string,
  target: Pick<SupaschemaConfig["sync"]["targets"][string], "remote">
): boolean {
  return name === "remote" || target.remote === true;
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
