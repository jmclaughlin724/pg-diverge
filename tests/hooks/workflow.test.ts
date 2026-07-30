import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { schemaWriteHookOutput } from "../../src/hooks/output.js";
import { generatedArtifactEditTargets, hookEditTargets } from "../../src/hooks/targets.js";

const previousHookBin = process.env.SUPASCHEMA_HOOK_BIN;
const previousHookLog = process.env.SUPASCHEMA_HOOK_LOG;

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

describe("generated-artifact Bash wrappers", () => {
  const project = join(tmpdir(), "supaschema-hook-wrappers");
  const contract = join(project, "database.types.ts");
  const targets = (command: string) =>
    generatedArtifactEditTargets({ tool_input: { command }, tool_name: "Bash" }, project);

  it("classifies writes hidden behind command prefixes", () => {
    expect(targets("command rm database.types.ts")).toEqual([
      { operation: "delete", path: contract },
    ]);
    expect(targets("env rm database.types.ts")).toEqual([{ operation: "delete", path: contract }]);
    expect(targets("sudo -u postgres rm database.types.ts")).toEqual([
      { operation: "delete", path: contract },
    ]);
    expect(targets("env -u HOME rm database.types.ts")).toEqual([
      { operation: "delete", path: contract },
    ]);
    expect(targets("nohup mv database.types.ts backup")).toEqual([
      { operation: "delete", path: contract },
      { operation: "write", path: join(project, "backup") },
    ]);
  });
});
