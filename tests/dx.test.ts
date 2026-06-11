import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../src/check-reporters.js";
import { configJsonSchema, defaultConfigFile, resolveConfig } from "../src/config.js";
import type { Diagnostic } from "../src/core.js";

const cliPath = resolve(import.meta.dirname, "../dist/cli.js");

const sampleDiagnostics: Diagnostic[] = [
  {
    code: "PD_CHECK_DROP_IF_EXISTS",
    message: "DROP statements must use IF EXISTS",
    severity: "error",
  },
  {
    code: "PD_CHECK_ALTER_COLUMN_TYPE_REWRITE",
    hint: "lock review",
    message: "type change can rewrite",
    severity: "warning",
  },
];

describe("config DX", () => {
  it("tolerates $schema and scaffolds it into the default config file", () => {
    const config = resolveConfig({ $schema: "./node_modules/pg-diverge/config-schema.json" });
    expect(config.adapter).toBe("supabase-auto");
    expect(defaultConfigFile).toContain('"$schema"');
  });

  it("parses named environments and rejects unknown keys inside them", () => {
    const config = resolveConfig({
      environments: { staging: { databaseUrl: "$STAGING_DB" } },
    });
    expect(config.environments.staging?.databaseUrl).toBe("$STAGING_DB");
    expect(() => resolveConfig({ environments: { bad: { url: "x" } } as never })).toThrow();
  });

  it("generates a JSON schema documenting every config key", () => {
    const schema = configJsonSchema() as { properties?: Record<string, unknown> };
    expect(schema.properties).toBeDefined();
    for (const key of ["adapter", "environments", "hints", "normalize", "transactionMode"]) {
      expect(schema.properties?.[key], key).toBeDefined();
    }
  });
});

describe("check reporters", () => {
  const files = [{ diagnostics: sampleDiagnostics, file: "migrations/x.sql" }];

  it("renders github workflow commands with file and severity", () => {
    const output = renderCheckReport("github", files);
    expect(output).toContain("::error file=migrations/x.sql,title=PD_CHECK_DROP_IF_EXISTS::");
    expect(output).toContain("::warning file=");
  });

  it("renders valid SARIF with rule ids", () => {
    const sarif = JSON.parse(renderCheckReport("sarif", files)) as {
      runs: { results: { ruleId: string; level: string }[] }[];
      version: string;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results.map((result) => result.ruleId)).toContain(
      "PD_CHECK_DROP_IF_EXISTS",
    );
  });

  it("renders json as an array of per-file diagnostics", () => {
    const parsed = JSON.parse(renderCheckReport("json", files)) as {
      diagnostics: Diagnostic[];
      file: string;
    }[];
    expect(parsed[0]?.file).toBe("migrations/x.sql");
    expect(parsed[0]?.diagnostics).toHaveLength(2);
  });
});

describe("stdin sources", () => {
  it("checks SQL piped to `check -`", () => {
    const result = spawnSync(process.execPath, [cliPath, "check", "-"], {
      encoding: "utf8",
      input: "CREATE TABLE app.t (id bigint);\n",
    });
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("PD_CHECK_CREATE_TABLE_GUARD");
  });

  it("accepts replay-safe SQL from stdin", () => {
    const result = spawnSync(process.execPath, [cliPath, "check", "-"], {
      encoding: "utf8",
      input: "CREATE TABLE IF NOT EXISTS app.t (id bigint);\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok");
  });
});
