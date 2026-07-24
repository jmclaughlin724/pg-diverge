import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerToolCommands } from "../../src/cli/tools.js";
import { resolveConfig } from "../../src/config/schema.js";

describe("contracts CLI", () => {
  it("exposes only local export and diff subcommands", () => {
    const program = new Command();
    registerToolCommands(program, {
      configPath: () => undefined,
      loadCliConfig: () => Promise.resolve(resolveConfig()),
      printDiagnostics: () => undefined,
      resolveCliDatabaseUrl: () => Promise.resolve(undefined),
      resolveCliDatabaseUrlInfo: () => Promise.resolve({ lane: "none", url: undefined }),
    });

    const contracts = program.commands.find((command) => command.name() === "contracts");

    expect(contracts).toBeDefined();
    expect(contracts?.commands.map((command) => command.name()).sort()).toEqual(["diff", "export"]);
  });
});
