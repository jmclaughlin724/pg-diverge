import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerToolCommands } from "../../src/cli/tools.js";
import { resolveConfig } from "../../src/config/schema.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function typesProgram(workflow?: {
  type_generation: "refresh_existing";
  zod_generation: "refresh_existing";
}) {
  const root = await mkdtemp(join(tmpdir(), "supa-types-cli-"));
  tempRoots.push(root);
  const schemas = join(root, "schemas");
  await mkdir(schemas);
  await writeFile(join(schemas, "app.sql"), "CREATE TABLE public.items (id bigint);\n");
  const config = resolveConfig({
    schemaPaths: [schemas],
    typesFile: join(root, "database.types.ts"),
    zodFile: join(root, "database.zod.ts"),
    ...(workflow === undefined ? {} : { workflow }),
  });
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  registerToolCommands(program, {
    configPath: () => undefined,
    loadCliConfig: () => Promise.resolve(config),
    printDiagnostics: (diagnostics) => {
      for (const diagnostic of diagnostics) {
        process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
      }
    },
    resolveCliDatabaseUrl: () => Promise.resolve(undefined),
    resolveCliDatabaseUrlInfo: () => Promise.resolve({ lane: "test", url: undefined }),
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return { program, stderr, stdout };
}

async function run(program: Command, args: string[]): Promise<number | undefined> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(["node", "supaschema", ...args]);
    return process.exitCode;
  } finally {
    process.exitCode = previousExitCode;
  }
}

describe("types --check CLI", () => {
  it("rejects --check combined with --out", async () => {
    const { program, stderr } = await typesProgram();

    expect(await run(program, ["types", "--check", "--out", "stdout"])).toBe(1);
    expect(stderr.mock.calls.flat().join("")).toContain("--check cannot be combined with --out");
  });

  it("exits 0 when contracts are up to date", async () => {
    const { program, stdout } = await typesProgram();

    expect(await run(program, ["types"])).toBeUndefined();
    expect(await run(program, ["types", "--check"])).toBeUndefined();
    expect(stdout.mock.calls.flat().join("")).toContain("contracts up to date (2 checked)");
  });

  it("exits 2 with SUPA_TYPES_CONTRACT_DRIFT when contracts are missing", async () => {
    const { program, stderr } = await typesProgram();

    expect(await run(program, ["types", "--check"])).toBe(2);
    expect(stderr.mock.calls.flat().join("")).toContain("SUPA_TYPES_CONTRACT_DRIFT");
  });

  it("exits 2 when refresh-only outputs are deleted instead of passing with 0 checked", async () => {
    const { program, stderr, stdout } = await typesProgram({
      type_generation: "refresh_existing",
      zod_generation: "refresh_existing",
    });

    expect(await run(program, ["types", "--check"])).toBe(2);
    expect(stderr.mock.calls.flat().join("")).toContain("SUPA_TYPES_CONTRACT_DRIFT");
    expect(stdout.mock.calls.flat().join("")).not.toContain("contracts up to date (0 checked)");
  });
});
