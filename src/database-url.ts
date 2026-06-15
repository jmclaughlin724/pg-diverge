import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const supabaseDefaultDbPort = 54_322;

export function resolveSupabaseLocalDatabaseUrl(cwd: string = process.cwd()): string | undefined {
  let current = resolve(cwd);
  for (;;) {
    const configPath = join(current, "supabase", "config.toml");
    if (existsSync(configPath)) {
      const port = readTomlDbPort(readFileSync(configPath, "utf8")) ?? supabaseDefaultDbPort;
      return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
    }
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

/**
 * Database URL precedence shared by `verify`, tests, and benchmarks:
 * explicit value (supports `$ENV_NAME` indirection) > SUPASCHEMA_DATABASE_URL
 * > the local Supabase stack discovered from supabase/config.toml.
 */
export function resolveDatabaseUrl(
  explicit?: string,
  cwd: string = process.cwd()
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) {
    if (explicit.startsWith("$")) {
      const envName = explicit.slice(1);
      const resolved = process.env[envName];
      if (!resolved) {
        throw new Error(`environment variable ${envName} is not set`);
      }
      return resolved;
    }
    return explicit;
  }
  return process.env.SUPASCHEMA_DATABASE_URL ?? resolveSupabaseLocalDatabaseUrl(cwd);
}

function readTomlDbPort(content: string): number | undefined {
  let inDbSection = false;
  for (const raw of content.split("\n")) {
    const line = stripTomlComment(raw).trim();
    if (line.startsWith("[")) {
      inDbSection = line === "[db]";
      continue;
    }
    if (!inDbSection) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim() !== "port") {
      continue;
    }
    const value = Number.parseInt(line.slice(separator + 1).trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  return;
}

function stripTomlComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}
