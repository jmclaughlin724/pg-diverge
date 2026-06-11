import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import type { PgDivergeConfig } from "./config.js";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "./database-url.js";
import { migrationsStatus } from "./migrations-status.js";
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

const minimumNodeMajor = 22;

export async function runDoctor(
  config: PgDivergeConfig,
  options: { configPath?: string; cwd?: string; databaseUrl?: string } = {},
): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    detail: `running ${process.versions.node}, requires >=${minimumNodeMajor}`,
    name: "node version",
    status: nodeMajor >= minimumNodeMajor ? "pass" : "fail",
  });

  try {
    const parsed = await parseSqlAst("SELECT 1");
    checks.push({
      detail:
        parsed.ast !== undefined ? "libpg-query WASM parser loaded" : "parser returned no AST",
      name: "sql parser",
      status: parsed.ast !== undefined ? "pass" : "fail",
    });
  } catch (error) {
    checks.push({ detail: errorMessage(error), name: "sql parser", status: "fail" });
  }

  checks.push({
    detail: options.configPath ?? "defaults (no config file found is fine)",
    name: "config",
    status: "pass",
  });

  const explicit = options.databaseUrl;
  const resolved = resolveDatabaseUrl(explicit);
  const lane = explicit
    ? "explicit --database-url"
    : process.env.PG_DIVERGE_DATABASE_URL
      ? "PG_DIVERGE_DATABASE_URL"
      : resolveSupabaseLocalDatabaseUrl()
        ? "supabase/config.toml auto-discovery"
        : "none";
  checks.push({
    detail: resolved ? `resolved via ${lane}` : "no URL resolves; database commands will skip",
    name: "database url",
    status: resolved ? "pass" : "skip",
  });

  if (resolved) {
    const client = new Client({ connectionString: resolved });
    try {
      await client.connect();
      const capability = await client.query<{ can_create: boolean }>(
        "SELECT (rolcreatedb OR rolsuper) AS can_create FROM pg_catalog.pg_roles WHERE rolname = current_user",
      );
      checks.push({ detail: "SELECT 1 succeeded", name: "database reachable", status: "pass" });
      const canCreate = capability.rows[0]?.can_create === true;
      checks.push({
        detail: canCreate
          ? "role can CREATE DATABASE (verify/corpus will work)"
          : "role lacks CREATEDB; verify/corpus need a stronger role",
        name: "createdb capability",
        status: canCreate ? "pass" : "fail",
      });
    } catch (error) {
      checks.push({ detail: errorMessage(error), name: "database reachable", status: "fail" });
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const migrationsDir = resolve(cwd, "supabase/migrations");
  const hasMigrationsDir = await access(migrationsDir)
    .then(() => true)
    .catch(() => false);
  if (hasMigrationsDir && resolved) {
    const { report } = await migrationsStatus({ databaseUrl: resolved, directory: migrationsDir });
    const broken = report.ghosts.length + report.outOfOrder.length;
    checks.push({
      detail: `${report.applied.length} applied, ${report.pending.length} pending, ${report.ghosts.length} ghosts, ${report.outOfOrder.length} out-of-order`,
      name: "migrations history",
      status: broken === 0 ? "pass" : "fail",
    });
  } else {
    checks.push({
      detail: hasMigrationsDir ? "no database to compare against" : `${migrationsDir} not found`,
      name: "migrations history",
      status: "skip",
    });
  }

  const tree = config.schemaPaths[0] ?? "supabase/schemas";
  const hasTree = await access(resolve(cwd, tree))
    .then(() => true)
    .catch(() => false);
  checks.push({
    detail: hasTree ? `${tree} exists` : `${tree} not found (set schemaPaths in config)`,
    name: "declarative tree",
    status: hasTree ? "pass" : "skip",
  });

  return { checks, healthy: checks.every((item) => item.status !== "fail") };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((item) => {
    const badge = item.status === "pass" ? "PASS" : item.status === "fail" ? "FAIL" : "SKIP";
    return `${badge}  ${item.name}: ${item.detail}`;
  });
  lines.push(report.healthy ? "doctor: healthy" : "doctor: issues found");
  return `${lines.join("\n")}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
