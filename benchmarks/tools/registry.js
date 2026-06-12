import { access, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  {
    binary: process.execPath,
    id: "supaschema-workflow",
    mode: "full workflow: diff + migration + TS types + Zod validators",
    output: "sql",
    requiresDatabase: false,
    async command(context) {
      const typesFile = join(context.runRoot, "database.types.ts");
      const zodFile = join(context.runRoot, "database.zod.ts");
      await writeFile(typesFile, "", "utf8");
      await writeFile(zodFile, "", "utf8");
      const configPath = join(context.runRoot, "supaschema.workflow.config.json");
      await writeFile(
        configPath,
        `${JSON.stringify({
          ...(context.supaschemaAdapter ? { adapter: context.supaschemaAdapter } : {}),
          typesFile,
          zodFile,
        })}\n`,
        "utf8",
      );
      const spec = {
        diff: {
          args: [
            resolve(root, "dist/cli.js"),
            "--config",
            configPath,
            "--quiet",
            "diff",
            "--from",
            `dump:${context.fromSqlPath}`,
            "--to",
            `dump:${context.toSqlPath}`,
            "--out",
            context.outputPath,
          ],
          command: process.execPath,
        },
        migrationPath: context.outputPath,
      };
      const specPath = join(context.runRoot, "workflow.json");
      await writeFile(specPath, `${JSON.stringify(spec)}\n`, "utf8");
      return {
        args: [resolve(here, "run-workflow.mjs"), specPath],
        command: process.execPath,
      };
    },
  },
  supabaseAdapter("supabase-default"),
  supabaseAdapter("supabase-migra", "--use-migra"),
  supabaseAdapter("supabase-pg-delta", "--use-pg-delta"),
  supabaseAdapter("supabase-pg-schema", "--use-pg-schema"),
  supabaseAdapter("supabase-pgadmin", "--use-pgadmin"),
  supabaseWorkflowAdapter("supabase-default-workflow"),
  supabaseWorkflowAdapter("supabase-migra-workflow", "--use-migra"),
  supabaseWorkflowAdapter("supabase-pg-delta-workflow", "--use-pg-delta"),
  supabaseWorkflowAdapter("supabase-pg-schema-workflow", "--use-pg-schema"),
  supabaseWorkflowAdapter("supabase-pgadmin-workflow", "--use-pgadmin"),
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

function supabaseWorkflowAdapter(id, engineFlag) {
  return {
    binary: "supabase",
    id,
    maxAttempts: 3,
    mode: "full workflow: db diff + apply + gen types",
    output: "sql",
    requiresDatabase: true,
    resolveBinary: resolveSupabaseBinary,
    retryDelayMs: 2_000,
    retryOnFailure(execution) {
      return (
        execution.stderr.includes("Address already in use") &&
        !execution.stderr.includes("workflow: applying migration")
      );
    },
    async command(context) {
      const supabaseBinary = await resolveSupabaseBinary();
      const schemas = context.schemas ?? ["app"];
      const diffArgs = [
        "--workdir",
        context.runRoot,
        "db",
        "diff",
        "--from",
        context.fromDatabaseUrl,
        "--to",
        context.toDatabaseUrl,
        "--schema",
        schemas.join(","),
        "--output",
        context.outputPath,
      ];
      if (engineFlag) {
        diffArgs.push(engineFlag);
      }
      const spec = {
        applyDatabaseUrl: context.fromDatabaseUrl,
        diff: { args: diffArgs, command: supabaseBinary },
        genTypes: {
          args: [
            "--workdir",
            context.runRoot,
            "gen",
            "types",
            "--lang=typescript",
            "--db-url",
            context.fromDatabaseUrl,
            ...schemas.flatMap((schema) => ["--schema", schema]),
          ],
          command: supabaseBinary,
          outPath: join(context.runRoot, "database.types.ts"),
        },
        migrationPath: context.outputPath,
      };
      const specPath = join(context.runRoot, "workflow.json");
      await writeFile(specPath, `${JSON.stringify(spec)}\n`, "utf8");
      return {
        args: [resolve(here, "run-workflow.mjs"), specPath],
        command: process.execPath,
      };
    },
  };
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
