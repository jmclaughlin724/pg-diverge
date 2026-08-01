import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { schemaWriteHookOutput } from "../../src/hooks/output.js";
import { hookEditTargets } from "../../src/hooks/targets.js";

const previousHookBin = process.env.SUPASCHEMA_HOOK_BIN;
const previousHookLog = process.env.SUPASCHEMA_HOOK_LOG;
const previousDatabaseUrl = process.env.SUPASCHEMA_HOOK_DATABASE_URL;
const previousRemoteApproval = process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED;

afterEach(() => {
  if (previousHookBin === undefined) {
    delete process.env.SUPASCHEMA_HOOK_BIN;
  } else {
    process.env.SUPASCHEMA_HOOK_BIN = previousHookBin;
  }
  if (previousHookLog === undefined) {
    delete process.env.SUPASCHEMA_HOOK_LOG;
  } else {
    process.env.SUPASCHEMA_HOOK_LOG = previousHookLog;
  }
  if (previousDatabaseUrl === undefined) {
    delete process.env.SUPASCHEMA_HOOK_DATABASE_URL;
  } else {
    process.env.SUPASCHEMA_HOOK_DATABASE_URL = previousDatabaseUrl;
  }
  if (previousRemoteApproval === undefined) {
    delete process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED;
  } else {
    process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED = previousRemoteApproval;
  }
});

describe("schema-write hook", () => {
  it("accepts canonical edit and apply-patch targets", () => {
    const project = join(tmpdir(), "supaschema-hook-project");
    expect(
      hookEditTargets(
        { tool_input: { file_path: "database/schemas/app.sql" }, tool_name: "Edit" },
        project
      )
    ).toEqual([join(project, "database", "schemas", "app.sql")]);
    expect(
      hookEditTargets(
        { tool_input: { command: "touch database/schemas/app.sql" }, tool_name: "Bash" },
        project
      )
    ).toEqual([]);
    expect(
      hookEditTargets(
        {
          tool_input: {
            command: "*** Begin Patch\n*** Update File: database/schemas/app.sql\n*** End Patch",
          },
          tool_name: "apply_patch",
        },
        project
      )
    ).toEqual([join(project, "database", "schemas", "app.sql")]);
  });

  it("uses one configured automatic target as durable sync authorization", async () => {
    const fixture = await automaticHookFixture({ remote: false });
    process.env.SUPASCHEMA_HOOK_DATABASE_URL = "postgresql://postgres:postgres@localhost/database";

    const output = schemaWriteHookOutput({
      cwd: fixture.project,
      tool_input: { file_path: fixture.schemaFile },
      tool_name: "Edit",
    });

    expect(output?.decision).toBeUndefined();
    expect(output?.hookSpecificOutput?.additionalContext).toContain(
      "Automatic sync target preflight passed for primary"
    );
    expect(await fakeCalls(fixture.callsPath)).toEqual([["sync"]]);
  });

  it("falls back to diff/check when remote approval is absent", async () => {
    const fixture = await automaticHookFixture({ remote: true });
    process.env.SUPASCHEMA_HOOK_DATABASE_URL = "postgresql://postgres:postgres@localhost/database";
    delete process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED;

    const output = schemaWriteHookOutput({
      cwd: fixture.project,
      tool_input: { file_path: fixture.schemaFile },
      tool_name: "Write",
    });

    expect(output?.hookSpecificOutput?.additionalContext).toContain(
      "requires SUPASCHEMA_REMOTE_SYNC_APPROVED=1"
    );
    const calls = await fakeCalls(fixture.callsPath);
    expect(calls[0]).toEqual(["diff", "--to", "dir:database/schemas"]);
    expect(calls[1]?.[0]).toBe("check");
    expect(
      calls[1]?.[1]
        ?.replaceAll("\\", "/")
        .endsWith("database/migrations/20260101000000_generated.sql")
    ).toBe(true);
  });

  it("runs configured sync when the remote operator approval is present", async () => {
    const fixture = await automaticHookFixture({ remote: true });
    process.env.SUPASCHEMA_HOOK_DATABASE_URL = "postgresql://postgres:postgres@localhost/database";
    process.env.SUPASCHEMA_REMOTE_SYNC_APPROVED = "1";

    const output = schemaWriteHookOutput({
      cwd: fixture.project,
      tool_input: { file_path: fixture.schemaFile },
      tool_name: "Edit",
    });

    expect(output?.decision).toBeUndefined();
    expect(output?.hookSpecificOutput?.additionalContext).toContain(
      "Automatic sync target preflight passed for primary"
    );
    expect(await fakeCalls(fixture.callsPath)).toEqual([["sync"]]);
  });

  it("checks the generated migration files after auto-diff", async () => {
    const project = await mkdtemp(join(tmpdir(), "supa-hook-check-"));
    const schemaFile = join(project, "database", "schemas", "app.sql");
    const staleMigration = join(project, "database", "migrations", "20250101000000_legacy.sql");
    const fakeBin = join(project, "fake-supaschema.mjs");
    const callsPath = join(project, "calls.jsonl");

    await mkdir(dirname(schemaFile), { recursive: true });
    await mkdir(dirname(staleMigration), { recursive: true });
    await writeFile(schemaFile, "CREATE TABLE app.accounts (id bigint);\n");
    await writeFile(
      staleMigration,
      "CREATE FUNCTION app.legacy() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n"
    );
    await writeFile(
      join(project, "supaschema.config.json"),
      `${JSON.stringify(
        {
          migrationsDir: "database/migrations",
          schemaPaths: ["database/schemas"],
          sources: { from: "empty:" },
          workflow: {
            migration_check: "after_schema_diff",
            migration_sync: "manual",
            migration_verify: "manual",
            schema_diff: "on_schema_write",
          },
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      fakeBin,
      `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [command, ...args] = process.argv.slice(2);
const logPath = process.env.SUPASCHEMA_HOOK_LOG;
if (!logPath) {
  process.exit(99);
}
appendFileSync(logPath, \`\${JSON.stringify([command, ...args])}\\n\`);
if (command === "diff") {
  const out = join(process.cwd(), "database", "migrations", "20260101000000_generated.sql");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, "-- supaschema: lineage from=a to=b\\nCREATE TABLE IF NOT EXISTS app.accounts (id bigint);\\n");
  console.log(out);
  process.exit(0);
}
if (command === "check") {
  if (args.length === 0) {
    console.error("zero-arg check scanned stale migration history");
    process.exit(2);
  }
  const checkPath = args[0]?.replaceAll("\\\\", "/");
  if (args.length === 1 && checkPath?.endsWith("database/migrations/20260101000000_generated.sql")) {
    console.log("ok");
    process.exit(0);
  }
  console.error(\`unexpected check args: \${JSON.stringify(args)}\`);
  process.exit(2);
}
process.exit(2);
`
    );
    await chmod(fakeBin, 0o755);

    process.env.SUPASCHEMA_HOOK_BIN = fakeBin;
    process.env.SUPASCHEMA_HOOK_LOG = callsPath;

    const output = schemaWriteHookOutput({
      cwd: project,
      tool_input: { file_path: schemaFile },
      tool_name: "Write",
    });

    const context = output?.hookSpecificOutput?.additionalContext ?? "";
    expect(output?.decision).toBeUndefined();
    expect(context).toContain("supaschema check passed for generated migration");
    expect(context).toContain("20260101000000_generated.sql");

    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls[0]).toEqual(["diff", "--to", "dir:database/schemas"]);
    expect(calls[1]?.[0]).toBe("check");
    expect(calls[1]?.[1]).toContain("database/migrations/20260101000000_generated.sql");
  });
});

interface AutomaticHookFixture {
  callsPath: string;
  project: string;
  schemaFile: string;
}

async function automaticHookFixture(options: { remote: boolean }): Promise<AutomaticHookFixture> {
  const project = await mkdtemp(join(tmpdir(), "supa-hook-auto-sync-"));
  const schemaFile = join(project, "database", "schemas", "app.sql");
  const fakeBin = join(project, "fake-supaschema.mjs");
  const callsPath = join(project, "calls.jsonl");
  await mkdir(dirname(schemaFile), { recursive: true });
  await writeFile(schemaFile, "CREATE TABLE app.accounts (id bigint);\n");
  await writeFile(
    join(project, "supaschema.config.json"),
    `${JSON.stringify({
      environments: { local: { databaseUrl: "$SUPASCHEMA_HOOK_DATABASE_URL" } },
      migrationsDir: "database/migrations",
      schemaPaths: ["database/schemas"],
      sources: { from: "empty:" },
      sync: {
        targets: {
          primary: {
            environment: "local",
            historyTable: "supabase_migrations.schema_migrations",
            mode: "auto",
            ...(options.remote
              ? {
                  remote: true,
                  requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
                }
              : {}),
            runner: "direct",
          },
        },
      },
      workflow: { migration_sync: "auto" },
    })}\n`
  );
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [command, ...args] = process.argv.slice(2);
appendFileSync(process.env.SUPASCHEMA_HOOK_LOG, JSON.stringify([command, ...args]) + "\\n");
if (command === "sync" || command === "check") {
  process.exit(0);
}
if (command === "diff") {
  const migration = join(process.cwd(), "database", "migrations", "20260101000000_generated.sql");
  mkdirSync(dirname(migration), { recursive: true });
  writeFileSync(migration, "-- supaschema: lineage from=a to=b\\nCREATE TABLE app.accounts (id bigint);\\n");
  process.stdout.write(migration + "\\n");
  process.exit(0);
}
process.exit(2);
`
  );
  await chmod(fakeBin, 0o755);
  process.env.SUPASCHEMA_HOOK_BIN = fakeBin;
  process.env.SUPASCHEMA_HOOK_LOG = callsPath;
  return { callsPath, project, schemaFile };
}

async function fakeCalls(path: string): Promise<string[][]> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
