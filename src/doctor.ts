import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { readBuildInfo } from "./build-info.js";
import { extractCatalogModel } from "./catalog/extract.js";
import { selfCheckCatalog } from "./catalog/selfcheck.js";
import type { SupaschemaConfig } from "./config/schema.js";
import { pendingInstallPathConfirmationDiagnostic } from "./config/validate.js";
import { databaseUrlLane, resolveDatabaseUrl } from "./database/url.js";
import { hasErrors } from "./diagnostics/diagnostics.js";
import { readMigrationContext } from "./migrations/context.js";
import { migrationsStatus } from "./migrations/status.js";
import { isMigrationDirectorySource } from "./planner/context.js";
import { extractSourceModel } from "./source/extract.js";
import { currentBaselineFingerprints } from "./source/resolve.js";
import { parseSqlAst } from "./sql/parser.js";

export interface DoctorCheck {
  detail: string;
  name: string;
  status: "pass" | "fail" | "skip";
}

export interface DoctorReport {
  checks: DoctorCheck[];
  healthy: boolean;
}

const minimumNodeVersion = "22.12.0";

interface ParserReadiness {
  check: DoctorCheck;
  postgresMajor?: number;
}

export async function runDoctor(
  config: SupaschemaConfig,
  options: {
    configPath?: string;
    cwd?: string;
    databaseUrl?: string;
    databaseUrlLane?: string;
    resolvedDatabaseUrl?: string;
  } = {}
): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  const parser = await sqlParserCheck();
  checks.push(
    nodeVersionCheck(),
    buildIdentityCheck(await readBuildInfo()),
    parser.check,
    configCheck(options.configPath),
    await installPathConfirmationCheck(cwd, options.configPath)
  );

  const explicit = options.databaseUrl;
  const resolved = options.resolvedDatabaseUrl ?? resolveDatabaseUrl(explicit);
  const lane = options.databaseUrlLane ?? databaseUrlLane(explicit);
  checks.push(
    databaseUrlCheck(resolved, lane),
    ...(await databaseChecks(resolved, config, parser.postgresMajor))
  );

  const migrationsDir = resolve(cwd, config.migrationsDir);
  const hasMigrationsDir = await access(migrationsDir)
    .then(() => true)
    .catch(() => false);
  checks.push(
    ...(await migrationReplayChecks(config, migrationsDir, hasMigrationsDir, cwd)),
    await migrationsHistoryCheck(config, migrationsDir, hasMigrationsDir, resolved, cwd)
  );

  const tree = config.schemaPaths[0] ?? "database/schemas";
  const hasTree = await access(resolve(cwd, tree))
    .then(() => true)
    .catch(() => false);
  checks.push(declarativeTreeCheck(tree, hasTree));
  checks.push(...(await catalogReadinessChecks(config, resolved)));

  return { checks, healthy: checks.every((item) => item.status !== "fail") };
}

function nodeVersionCheck(): DoctorCheck {
  return {
    detail: `running ${process.versions.node}, requires >=${minimumNodeVersion}`,
    name: "node version",
    status: nodeMeetsMinimum(process.versions.node) ? "pass" : "fail",
  };
}

function buildIdentityCheck(info: Awaited<ReturnType<typeof readBuildInfo>>): DoctorCheck {
  const commit = info.commit === null ? "unknown commit" : info.commit.slice(0, 12);
  const built = info.builtAt ?? "unknown build time";
  let dirty = "unknown tree state";
  if (info.dirty !== null) {
    dirty = info.dirty ? "dirty tree" : "clean tree";
  }
  return {
    detail: `${info.version} (${commit}, built ${built}, ${dirty})`,
    name: "build identity",
    status: "pass",
  };
}

async function sqlParserCheck(): Promise<ParserReadiness> {
  try {
    const parsed = await parseSqlAst("SELECT 1");
    const version = numericProperty(parsed.ast, "version");
    const postgresMajor = version === undefined ? undefined : Math.floor(version / 10_000);
    return {
      check: {
        detail: parserDetail(parsed.ast !== undefined, version, postgresMajor),
        name: "sql parser",
        status: parsed.ast === undefined || version === undefined ? "fail" : "pass",
      },
      ...(postgresMajor === undefined ? {} : { postgresMajor }),
    };
  } catch (error) {
    return {
      check: { detail: errorMessage(error), name: "sql parser", status: "fail" },
    };
  }
}

function configCheck(configPath: string | undefined): DoctorCheck {
  return {
    detail: configPath ?? "defaults (no config file found is fine)",
    name: "config",
    status: "pass",
  };
}

async function installPathConfirmationCheck(
  cwd: string,
  configPath: string | undefined
): Promise<DoctorCheck> {
  const pending = await pendingInstallPathConfirmationDiagnostic(cwd, configPath);
  if (!pending) {
    return {
      detail: "no pending install path confirmation",
      name: "install path confirmation",
      status: "pass",
    };
  }
  return {
    detail: `${pending.message} ${pending.hint}`,
    name: "install path confirmation",
    status: "fail",
  };
}

function databaseUrlCheck(resolved: string | undefined, lane: string): DoctorCheck {
  return {
    detail: resolved ? `resolved via ${lane}` : "no URL resolves; database commands will skip",
    name: "database url",
    status: resolved ? "pass" : "skip",
  };
}

async function databaseChecks(
  resolved: string | undefined,
  config: SupaschemaConfig,
  parserMajor: number | undefined
): Promise<DoctorCheck[]> {
  if (!resolved) {
    return [];
  }
  const client = new Client({ connectionString: resolved });
  try {
    await client.connect();
    const capability = await client.query<{ can_create: boolean; server_version_num: number }>(
      "SELECT (rolcreatedb OR rolsuper) AS can_create, current_setting('server_version_num')::integer AS server_version_num FROM pg_catalog.pg_roles WHERE rolname = current_user"
    );
    const canCreate = capability.rows[0]?.can_create === true;
    const serverVersion = capability.rows[0]?.server_version_num;
    const serverMajor =
      serverVersion === undefined ? undefined : Math.floor(serverVersion / 10_000);
    const supportedFloor = configuredPostgresFloor(config.postgresVersion);
    const compatible =
      serverMajor !== undefined &&
      parserMajor !== undefined &&
      serverMajor >= supportedFloor &&
      serverMajor <= parserMajor;
    return [
      { detail: "SELECT 1 succeeded", name: "database reachable", status: "pass" },
      {
        detail:
          serverMajor === undefined
            ? "target did not report server_version_num"
            : `target PostgreSQL ${serverMajor} (${serverVersion}), configured floor ${supportedFloor}+`,
        name: "database version",
        status: serverMajor !== undefined && serverMajor >= supportedFloor ? "pass" : "fail",
      },
      {
        detail: parserDatabaseCompatibilityDetail(parserMajor, serverMajor, compatible),
        name: "parser/database compatibility",
        status: compatible ? "pass" : "fail",
      },
      {
        detail: canCreate
          ? "role can CREATE DATABASE (verify/corpus will work)"
          : "role lacks CREATEDB; verify/corpus need a stronger role",
        name: "createdb capability",
        status: canCreate ? "pass" : "fail",
      },
    ];
  } catch (error) {
    return [{ detail: errorMessage(error), name: "database reachable", status: "fail" }];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function migrationReplayChecks(
  config: SupaschemaConfig,
  migrationsDir: string,
  hasMigrationsDir: boolean,
  cwd: string
): Promise<DoctorCheck[]> {
  if (!hasMigrationsDir) {
    return [
      {
        detail: `${migrationsDir} not found`,
        name: "migration replay",
        status: "skip",
      },
    ];
  }
  const context = await readMigrationContext(config.migrationsDir, { cwd });
  if (context.files.length === 0) {
    return [
      {
        detail: `${migrationsDir} has no migrations yet`,
        name: "migration replay",
        status: "skip",
      },
      {
        detail: "automatic baseline starts with the first migration",
        name: "automatic baseline",
        status: "skip",
      },
    ];
  }
  const source = `migrations:${config.migrationsDir}`;
  const model = await extractSourceModel(source, { config, cwd });
  const errors = model.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    const first = errors[0];
    return [
      {
        detail: `${first?.code ?? "SUPA_REPLAY_FAILED"}: ${first?.message ?? "migration replay failed"}`,
        name: "migration replay",
        status: "fail",
      },
      {
        detail: `resolve the replay diagnostic, then retry ${source}`,
        name: "automatic baseline",
        status: "fail",
      },
    ];
  }
  const requiresReplay =
    context.files.length > 0 &&
    (context.latestGeneratedBaseline === undefined || context.unprovenBaselineFiles.length > 0);
  const automaticBaseline =
    config.sources.from === "auto" ||
    (await isMigrationDirectorySource(config.sources.from, config.migrationsDir, cwd));
  return [
    {
      detail: `${model.objects.length} objects, fingerprint ${model.fingerprint}`,
      name: "migration replay",
      status: "pass",
    },
    {
      detail: automaticBaselineDetail(
        source,
        config.sources.from,
        requiresReplay,
        automaticBaseline,
        context.latestGeneratedBaseline?.fingerprint
      ),
      name: "automatic baseline",
      status: requiresReplay && !automaticBaseline ? "fail" : "pass",
    },
  ];
}

async function catalogReadinessChecks(
  config: SupaschemaConfig,
  databaseUrl: string | undefined
): Promise<DoctorCheck[]> {
  if (!databaseUrl) {
    return [
      {
        detail: "no database URL resolved",
        name: "catalog extraction",
        status: "skip",
      },
      {
        detail: "catalog extraction was not available",
        name: "catalog selfcheck",
        status: "skip",
      },
    ];
  }
  const catalog = await extractCatalogModel({
    config,
    databaseUrl,
    source: "doctor:catalog",
  });
  if (hasErrors(catalog.diagnostics)) {
    const first = catalog.diagnostics.find((item) => item.severity === "error");
    return [
      {
        detail: `${first?.code ?? "SUPA_CATALOG_EXTRACT_FAILED"}: ${first?.message ?? "catalog extraction failed"}`,
        name: "catalog extraction",
        status: "fail",
      },
      {
        detail: "catalog extraction failed; parity was not attempted",
        name: "catalog selfcheck",
        status: "skip",
      },
    ];
  }
  const selfcheck = await selfCheckCatalog({ config, databaseUrl });
  return [
    {
      detail: `${catalog.objects.length} objects, fingerprint ${catalog.fingerprint}`,
      name: "catalog extraction",
      status: "pass",
    },
    {
      detail: `${selfcheck.checkedObjects} objects, ${selfcheck.mismatches} parity mismatches`,
      name: "catalog selfcheck",
      status: selfcheck.mismatches === 0 && !hasErrors(selfcheck.diagnostics) ? "pass" : "fail",
    },
  ];
}

async function migrationsHistoryCheck(
  config: SupaschemaConfig,
  migrationsDir: string,
  hasMigrationsDir: boolean,
  resolved: string | undefined,
  cwd: string
): Promise<DoctorCheck> {
  if (!hasMigrationsDir) {
    return {
      detail: `${migrationsDir} not found`,
      name: "migrations history",
      status: "skip",
    };
  }
  const { report } = await migrationsStatus({
    currentFingerprints: await currentBaselineFingerprints(config, cwd),
    directory: migrationsDir,
    ...(resolved === undefined ? {} : { databaseUrl: resolved }),
  });
  const stale = report.staleBaseline.length;
  if (!resolved) {
    return {
      detail: `${report.pending.length} pending on disk, ${stale} stale-baseline (no database to compare against)`,
      name: "migrations history",
      status: stale === 0 ? "skip" : "fail",
    };
  }
  const broken = report.ghosts.length + report.outOfOrder.length + stale;
  return {
    detail: `${report.applied.length} applied, ${report.pending.length} pending, ${report.ghosts.length} ghosts, ${report.outOfOrder.length} out-of-order, ${stale} stale-baseline`,
    name: "migrations history",
    status: broken === 0 ? "pass" : "fail",
  };
}

function declarativeTreeCheck(tree: string, hasTree: boolean): DoctorCheck {
  return {
    detail: hasTree ? `${tree} exists` : `${tree} not found (set schemaPaths in config)`,
    name: "declarative tree",
    status: hasTree ? "pass" : "skip",
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((item) => {
    const badge = doctorStatusBadge(item.status);
    return `${badge}  ${item.name}: ${item.detail}`;
  });
  lines.push(report.healthy ? "doctor: healthy" : "doctor: issues found");
  return `${lines.join("\n")}\n`;
}

function doctorStatusBadge(status: DoctorReport["checks"][number]["status"]): string {
  if (status === "pass") {
    return "PASS";
  }
  if (status === "fail") {
    return "FAIL";
  }
  return "SKIP";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nodeMeetsMinimum(version: string): boolean {
  const current = versionParts(version);
  const minimum = versionParts(minimumNodeVersion);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] ?? 0) > (minimum[index] ?? 0)) {
      return true;
    }
    if ((current[index] ?? 0) < (minimum[index] ?? 0)) {
      return false;
    }
  }
  return true;
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function configuredPostgresFloor(value: string): number {
  let digits = "";
  for (const char of value) {
    if (char < "0" || char > "9") {
      break;
    }
    digits += char;
  }
  return digits.length > 0 ? Number(digits) : 15;
}

function numericProperty(value: unknown, key: string): number | undefined {
  if (!(value && typeof value === "object")) {
    return;
  }
  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : undefined;
}

function parserDetail(
  hasAst: boolean,
  version: number | undefined,
  postgresMajor: number | undefined
): string {
  if (!hasAst) {
    return "parser returned no AST";
  }
  if (version === undefined || postgresMajor === undefined) {
    return "libpg-query loaded but did not report its PostgreSQL AST version";
  }
  return `libpg-query loaded PostgreSQL ${postgresMajor} grammar (AST ${version})`;
}

function parserDatabaseCompatibilityDetail(
  parserMajor: number | undefined,
  serverMajor: number | undefined,
  compatible: boolean
): string {
  if (parserMajor === undefined || serverMajor === undefined) {
    return "parser or target major is unavailable";
  }
  if (compatible) {
    return `PostgreSQL ${parserMajor} parser grammar covers target PostgreSQL ${serverMajor}`;
  }
  return `PostgreSQL ${parserMajor} parser grammar does not cover configured target PostgreSQL ${serverMajor}`;
}

function automaticBaselineDetail(
  source: string,
  configuredSource: string,
  requiresReplay: boolean,
  automaticBaseline: boolean,
  lineageFingerprint: string | undefined
): string {
  if (requiresReplay) {
    return automaticBaseline
      ? `${source} is the configured recovery baseline for adoption or a manual migration tail`
      : `set sources.from to auto or ${source}; ${configuredSource} cannot prove the manual migration tail`;
  }
  return lineageFingerprint
    ? `contiguous generated lineage ends at ${lineageFingerprint}`
    : "no migration files require a baseline";
}
