import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerReportCommands } from "../../src/cli/reports.js";
import { resolveConfig } from "../../src/config/schema.js";

async function sqlSource(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-type-contract-cli-"));
  await writeFile(join(root, "001.sql"), sql);
  return `dir:${root}`;
}

describe("type-contract CLI", () => {
  it("enforces breaking changes without license environment variables", async () => {
    const fromSource = await sqlSource("CREATE TABLE public.users (id bigint, email text);\n");
    const toSource = await sqlSource("CREATE TABLE public.users (id bigint);\n");
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    registerReportCommands(program, {
      cliVersion: "test",
      configPath: () => undefined,
      globalEnvName: () => undefined,
      loadCliConfig: () => Promise.resolve(resolveConfig()),
      printDiagnostics: () => undefined,
      resolveCliDatabaseUrl: () => Promise.resolve(undefined),
    });

    const previousExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("SUPASCHEMA_LICENSE", "invalid-token");
    process.exitCode = undefined;

    try {
      await program.parseAsync([
        "node",
        "supaschema",
        "type-contract",
        "--from",
        fromSource,
        "--to",
        toSource,
        "--enforce",
      ]);

      expect(process.exitCode).toBe(2);
      expect(stdout.mock.calls.flat().join("")).toContain("SUPA_TYPE_COLUMN_REMOVED");
      expect(stderr.mock.calls.flat().join("")).not.toContain("license");
    } finally {
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      stderr.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
