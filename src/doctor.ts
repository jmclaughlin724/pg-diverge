import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import type { SupaschemaConfig } from "./config/schema.js";
import { pendingInstallPathConfirmationDiagnostic } from "./config/validate.js";
import { databaseUrlLane, resolveDatabaseUrl } from "./database/url.js";
import { migrationsStatus } from "./migrations/status.js";
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

  checks.push(
    nodeVersionCheck(),
    await sqlParserCheck(),
    configCheck(options.configPath),
    await installPathConfirmationCheck(cwd, options.configPath)
  );

  const explicit = options.databaseUrl;
  const resolved = options.resolvedDatabaseUrl ?? resolveDatabaseUrl(explicit);
  const lane = options.databaseUrlLane ?? databaseUrlLane(explicit);
  checks.push(databaseUrlCheck(resolved, lane), ...(await databaseChecks(resolved)));

  const migrationsDir = resolve(cwd, config.migrationsDir);
  const hasMigrationsDir = await access(migrationsDir)
    .then(() => true)
    .catch(() => false);
  checks.push(await migrationsHistoryCheck(migrationsDir, hasMigrationsDir, resolved));

  const tree = config.schemaPaths[0] ?? "database/schemas";
  const hasTree = await access(resolve(cwd, tree))
    .then(() => true)
    .catch(() => false);
  checks.push(declarativeTreeCheck(tree, hasTree));

  return { checks, healthy: checks.every((item) => item.status !== "fail") };
}

function nodeVersionCheck(): DoctorCheck {
  return {
    detail: `running ${process.versions.node}, requires >=${minimumNodeVersion}`,
    name: "node version",
    status: nodeMeetsMinimum(process.versions.node) ? "pass" : "fail",
  };
}

async function sqlParserCheck(): Promise<DoctorCheck> {
  try {
    const parsed = await parseSqlAst("SELECT 1");
    return {
      detail:
        parsed.ast === undefined ? "parser returned no AST" : "libpg-query WASM parser loaded",
      name: "sql parser",
      status: parsed.ast === undefined ? "fail" : "pass",
    };
  } catch (error) {
    return { detail: errorMessage(error), name: "sql parser", status: "fail" };
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

async function databaseChecks(resolved: string | undefined): Promise<DoctorCheck[]> {
  if (!resolved) {
    return [];
  }
  const client = new Client({ connectionString: resolved });
  try {
    await client.connect();
    const capability = await client.query<{ can_create: boolean }>(
      "SELECT (rolcreatedb OR rolsuper) AS can_create FROM pg_catalog.pg_roles WHERE rolname = current_user"
    );
    const canCreate = capability.rows[0]?.can_create === true;
    return [
      { detail: "SELECT 1 succeeded", name: "database reachable", status: "pass" },
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

async function migrationsHistoryCheck(
  migrationsDir: string,
  hasMigrationsDir: boolean,
  resolved: string | undefined
): Promise<DoctorCheck> {
  if (!(hasMigrationsDir && resolved)) {
    return {
      detail: hasMigrationsDir ? "no database to compare against" : `${migrationsDir} not found`,
      name: "migrations history",
      status: "skip",
    };
  }
  const { report } = await migrationsStatus({ databaseUrl: resolved, directory: migrationsDir });
  const broken = report.ghosts.length + report.outOfOrder.length;
  return {
    detail: `${report.applied.length} applied, ${report.pending.length} pending, ${report.ghosts.length} ghosts, ${report.outOfOrder.length} out-of-order`,
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
