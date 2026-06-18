import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { applySqlStatements } from "./db-admin.js";
import { migrationFileVersion } from "./migrations-status.js";
import { redactSecrets } from "./redaction.js";
import { quoteIdent } from "./sql/identifiers.js";

export type MigrationRunnerKind = "direct" | "supabase-cli";
export type SupabaseCliOperation = "local" | "remote";
export type SupabaseCliTargetScope = "linked" | "local";

export interface DirectMigrationRunnerOptions {
  databaseUrl: string;
  directory: string;
  historyTable: string;
  pending: string[];
  transactionMode: "per-migration" | "per-statement";
}

export interface SupabaseCliCommandOptions {
  databaseUrl?: string;
  operation: SupabaseCliOperation;
  scope?: SupabaseCliTargetScope;
}

export interface SupabaseCliMigrationRunnerOptions extends SupabaseCliCommandOptions {
  cwd?: string;
}

export interface SupabaseCliCommand {
  args: string[];
  command: "supabase";
  displayCommand: string;
}

export interface MigrationUnit {
  files: string[];
  transactional: boolean;
  version: string;
}

export type MigrationRunnerResult =
  | {
      appliedFiles: string[];
      appliedVersions: string[];
      displayCommand?: string;
      ok: true;
      runner: MigrationRunnerKind;
    }
  | {
      displayCommand?: string;
      error?: Error;
      exitCode?: number;
      kind: "failed" | "unavailable";
      message: string;
      ok: false;
      runner: MigrationRunnerKind;
    };

export function groupMigrationUnits(
  files: string[],
  transactionMode: "per-migration" | "per-statement"
): MigrationUnit[] {
  const byVersion = new Map<string, string[]>();
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    const version = migrationFileVersion(file);
    if (version === undefined) {
      continue;
    }
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  return [...byVersion.entries()].map(([version, unitFiles]) => {
    const ordered = unitFiles.sort((left, right) => {
      const leftConcurrent = isConcurrentMigrationFile(left);
      const rightConcurrent = isConcurrentMigrationFile(right);
      if (leftConcurrent === rightConcurrent) {
        return left.localeCompare(right);
      }
      return leftConcurrent ? 1 : -1;
    });
    return {
      files: ordered,
      transactional:
        transactionMode === "per-migration" && !ordered.some(isConcurrentMigrationFile),
      version,
    };
  });
}

export function isConcurrentMigrationFile(file: string): boolean {
  return file.endsWith(".concurrent.sql");
}

export async function runDirectMigrationRunner(
  options: DirectMigrationRunnerOptions
): Promise<MigrationRunnerResult> {
  const history = parseHistoryTable(options.historyTable);
  if (history === undefined) {
    return {
      kind: "failed",
      message: `history table "${options.historyTable}" must be schema-qualified`,
      ok: false,
      runner: "direct",
    };
  }
  const client = new Client({ connectionString: options.databaseUrl });
  const appliedFiles: string[] = [];
  const appliedVersions: string[] = [];
  try {
    await client.connect();
    await ensureMigrationHistoryTable(client, history);
    for (const unit of groupMigrationUnits(options.pending, options.transactionMode)) {
      if (unit.transactional) {
        await applyTransactionalUnit(client, options.directory, unit, history);
      } else {
        await applyAutocommitUnit(client, options.directory, unit, history);
      }
      appliedFiles.push(...unit.files);
      appliedVersions.push(unit.version);
    }
    return {
      appliedFiles,
      appliedVersions,
      ok: true,
      runner: "direct",
    };
  } catch (error) {
    return {
      ...(error instanceof Error ? { error } : {}),
      kind: "failed",
      message: redactSecrets(error instanceof Error ? error.message : String(error)),
      ok: false,
      runner: "direct",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function buildSupabaseCliCommand(options: SupabaseCliCommandOptions): SupabaseCliCommand {
  const args = options.operation === "local" ? ["migration", "up"] : ["db", "push"];
  if (options.databaseUrl !== undefined) {
    args.push("--db-url", options.databaseUrl);
  } else if (options.scope !== undefined) {
    args.push(options.scope === "local" ? "--local" : "--linked");
  }
  return {
    args,
    command: "supabase",
    displayCommand: redactSecrets(["supabase", ...args].join(" ")),
  };
}

export async function runSupabaseCliMigrationRunner(
  options: SupabaseCliMigrationRunnerOptions
): Promise<MigrationRunnerResult> {
  const command = buildSupabaseCliCommand(options);
  const outcome = await run(command.command, command.args, options.cwd);
  if (outcome.kind === "spawn-error") {
    return {
      displayCommand: command.displayCommand,
      error: outcome.error,
      kind: "unavailable",
      message: `could not launch \`${command.command}\`: the Supabase CLI is not installed or not on PATH`,
      ok: false,
      runner: "supabase-cli",
    };
  }
  if (outcome.code !== 0) {
    return {
      displayCommand: command.displayCommand,
      exitCode: outcome.code,
      kind: "failed",
      message: `\`${command.displayCommand}\` exited with code ${outcome.code}`,
      ok: false,
      runner: "supabase-cli",
    };
  }
  return {
    appliedFiles: [],
    appliedVersions: [],
    displayCommand: command.displayCommand,
    ok: true,
    runner: "supabase-cli",
  };
}

async function applyTransactionalUnit(
  client: Client,
  directory: string,
  unit: MigrationUnit,
  history: HistoryTableParts
): Promise<void> {
  await client.query("BEGIN");
  try {
    await applyUnitSql(client, directory, unit);
    await insertMigrationHistoryVersion(client, history, unit.version);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function applyAutocommitUnit(
  client: Client,
  directory: string,
  unit: MigrationUnit,
  history: HistoryTableParts
): Promise<void> {
  await applyUnitSql(client, directory, unit);
  await insertMigrationHistoryVersion(client, history, unit.version);
}

async function applyUnitSql(client: Client, directory: string, unit: MigrationUnit): Promise<void> {
  for (const file of unit.files) {
    await applySqlStatements(client, await readFile(join(directory, file), "utf8"));
  }
}

interface HistoryTableParts {
  schema: string;
  table: string;
}

function parseHistoryTable(value: string): HistoryTableParts | undefined {
  const [schema, table, extra] = value.split(".");
  if (!(schema && table) || extra !== undefined) {
    return;
  }
  return { schema, table };
}

async function ensureMigrationHistoryTable(
  client: Pick<Client, "query">,
  history: HistoryTableParts
): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(history.schema)}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(history.schema)}.${quoteIdent(history.table)} (version text PRIMARY KEY, inserted_at timestamptz NOT NULL DEFAULT now())`
  );
}

async function insertMigrationHistoryVersion(
  client: Pick<Client, "query">,
  history: HistoryTableParts,
  version: string
): Promise<void> {
  await client.query(
    `INSERT INTO ${quoteIdent(history.schema)}.${quoteIdent(history.table)} (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
    [version]
  );
}

type RunOutcome = { code: number; kind: "exit" } | { error: Error; kind: "spawn-error" };

function run(command: string, args: string[], cwd: string | undefined): Promise<RunOutcome> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      ...(cwd === undefined ? {} : { cwd }),
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: process.env.SUPABASE_TELEMETRY_DISABLED ?? "1",
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", (error) => resolvePromise({ error, kind: "spawn-error" }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, kind: "exit" }));
  });
}
