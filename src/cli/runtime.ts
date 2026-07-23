import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { loadConfig } from "../config/schema.js";
import {
  databaseUrlLane,
  resolveDatabaseUrl,
  resolveVerificationDatabaseUrl,
} from "../database/url.js";
import { formatDiagnostics } from "../diagnostics/diagnostics.js";
import { redactSecrets } from "../redaction.js";
import type { Diagnostic, SupaschemaConfig } from "../types.js";

interface CliGlobalOptions {
  config?: string;
  env?: string;
  quiet?: boolean;
}

let cliProgram: Command | undefined;

export function configureCliShared(program: Command): void {
  cliProgram = program;
}

export function loadCliConfig(): Promise<SupaschemaConfig> {
  const globals = globalOptions();
  return loadConfig(process.cwd(), globals.config);
}

export function currentConfigPath(): string | undefined {
  return globalOptions().config;
}

export async function runHookFailOpen(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Hooks are advisory in CLI flows and intentionally fail open.
  }
}

export async function resolveCliDatabaseUrl(explicit?: string): Promise<string | undefined> {
  return (await resolveCliDatabaseUrlInfo(explicit)).url;
}

export async function resolveCliVerificationDatabaseUrl(
  explicit?: string
): Promise<string | undefined> {
  if (globalOptions().env !== undefined) {
    return await resolveCliDatabaseUrl(explicit);
  }
  return resolveVerificationDatabaseUrl(explicit);
}

export async function resolveCliDatabaseUrlInfo(
  explicit?: string
): Promise<{ lane: string; url: string | undefined }> {
  if (explicit) {
    return { lane: "explicit --database-url", url: resolveDatabaseUrl(explicit) };
  }
  const globals = globalOptions();
  if (globals.env) {
    const config = await loadCliConfig();
    const entry = config.environments[globals.env];
    if (!entry) {
      throw new Error(
        `--env "${globals.env}" is not defined in config.environments (known: ${Object.keys(config.environments).join(", ") || "none"})`
      );
    }
    return { lane: `--env ${globals.env}`, url: resolveDatabaseUrl(entry.databaseUrl) };
  }
  const url = resolveDatabaseUrl();
  const lane = databaseUrlLane();
  return { lane, url };
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function printDiagnostics(diagnostics: Diagnostic[]): void {
  const globals = globalOptions();
  if (globals.quiet || diagnostics.length === 0) {
    return;
  }
  process.stderr.write(`${formatDiagnostics(diagnostics)}\n`);
}

export function redactRawError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item)]));
  }
  return value;
}

export async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const version = Reflect.get(parsed, "version");
      return typeof version === "string" ? version : "0.0.0";
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function globalOptions(): CliGlobalOptions {
  if (cliProgram === undefined) {
    throw new Error("supaschema CLI shared helpers have not been configured");
  }
  return cliProgram.opts<CliGlobalOptions>();
}
