import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const localSupabaseBinary = resolve(root, "node_modules/.bin/supabase");

export const adapters = [
  {
    binary: process.execPath,
    id: "supaschema-file",
    mode: "source-file diff",
    output: "sql",
    requiresDatabase: false,
    async command(context) {
      return {
        args: [
          resolve(root, "dist/cli.js"),
          ...(context.supaschemaConfigPath ? ["--config", context.supaschemaConfigPath] : []),
          "--quiet",
          "diff",
          "--from",
          `dump:${context.fromSqlPath}`,
          "--to",
          `dump:${context.toSqlPath}`,
          "--out",
          "stdout",
        ],
        command: process.execPath,
      };
    },
  },
  {
    binary: process.execPath,
    id: "supaschema-db",
    mode: "live-catalog diff",
    output: "sql",
    requiresDatabase: true,
    async command(context) {
      return {
        args: [
          resolve(root, "dist/cli.js"),
          ...(context.supaschemaConfigPath ? ["--config", context.supaschemaConfigPath] : []),
          "--quiet",
          "diff",
          "--from",
          `database:${context.fromDatabaseUrl}`,
          "--to",
          `database:${context.toDatabaseUrl}`,
          "--out",
          "stdout",
        ],
        command: process.execPath,
      };
    },
  },
  supabaseAdapter("supabase-default"),
  supabaseAdapter("supabase-migra", "--use-migra"),
  supabaseAdapter("supabase-pg-delta", "--use-pg-delta"),
  supabaseAdapter("supabase-pg-schema", "--use-pg-schema"),
  supabaseAdapter("supabase-pgadmin", "--use-pgadmin"),
];

export async function adapterAvailability(adapter) {
  const binary = adapter.resolveBinary ? await adapter.resolveBinary() : adapter.binary;
  if (binary === process.execPath) {
    return { available: true };
  }
  if (binary.includes("/")) {
    try {
      await access(binary);
      return { available: true };
    } catch {
      return { available: false, reason: `binary "${binary}" was not found` };
    }
  }
  const found = await findOnPath(binary);
  if (found) {
    return { available: true };
  }
  return { available: false, reason: `binary "${binary}" was not found on PATH` };
}

async function findOnPath(binary) {
  const path = process.env.PATH ?? "";
  for (const segment of path.split(":")) {
    if (!segment) {
      continue;
    }
    const candidate = resolve(segment, binary);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue scanning PATH.
    }
  }
  return undefined;
}

async function resolveSupabaseBinary() {
  try {
    await access(localSupabaseBinary);
    return localSupabaseBinary;
  } catch {
    return "supabase";
  }
}

function supabaseAdapter(id, engineFlag) {
  return {
    binary: "supabase",
    id,
    maxAttempts: 3,
    mode: engineFlag ? `Supabase db diff ${engineFlag}` : "Supabase db diff default",
    output: "sql",
    requiresDatabase: true,
    resolveBinary: resolveSupabaseBinary,
    retryDelayMs: 2_000,
    retryOnFailure(execution) {
      return execution.stderr.includes("Address already in use");
    },
    async command(context) {
      const args = [
        "--workdir",
        context.runRoot,
        "db",
        "diff",
        "--from",
        context.fromDatabaseUrl,
        "--to",
        context.toDatabaseUrl,
        "--schema",
        (context.schemas ?? ["app"]).join(","),
        "--output",
        context.outputPath,
      ];
      if (engineFlag) {
        args.push(engineFlag);
      }
      return {
        args,
        command: await resolveSupabaseBinary(),
      };
    },
  };
}
