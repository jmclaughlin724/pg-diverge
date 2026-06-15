import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../src/check-reporters.js";
import { configJsonSchema, defaultConfigFile, resolveConfig } from "../src/config.js";
import type { Diagnostic } from "../src/core.js";

const cliPath = resolve(import.meta.dirname, "../dist/cli.js");

const sampleDiagnostics: Diagnostic[] = [
  {
    code: "SUPA_CHECK_DROP_IF_EXISTS",
    message: "DROP statements must use IF EXISTS",
    severity: "error",
  },
  {
    code: "SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE",
    hint: "lock review",
    message: "type change can rewrite",
    severity: "warning",
  },
];

describe("config DX", () => {
  it("tolerates $schema and keeps the scaffold explicit", () => {
    const config = resolveConfig({ $schema: "./node_modules/supaschema/config-schema.json" });
    expect(config.adapter).toBe("auto");
    expect(JSON.parse(defaultConfigFile)).toEqual({
      $schema: "./node_modules/supaschema/config-schema.json",
      ...resolveConfig(),
    });
  });

  it("normalizes legacy adapter values to auto", () => {
    const legacySupabase = resolveConfig({ adapter: "supabase-auto" } as never);
    const legacyPostgres = resolveConfig({ adapter: "postgres" } as never);
    const accidentalSupabase = resolveConfig({ adapter: "supabase" } as never);

    expect(legacySupabase.adapter).toBe("auto");
    expect(legacyPostgres.adapter).toBe("auto");
    expect(accidentalSupabase.adapter).toBe("auto");
  });

  it("keeps auto provider-neutral even when paths are Supabase-shaped", () => {
    const config = resolveConfig({
      adapter: "auto",
      migrationsDir: "supabase/migrations",
      schemaPaths: ["supabase/schemas"],
    });
    expect(config.adapter).toBe("auto");
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
    for (const key of [
      "adapter",
      "destructiveChanges",
      "environments",
      "excludedGrantRoles",
      "hints",
      "managedSchemas",
      "migrationsDir",
      "normalize",
      "schemaPaths",
      "schemas",
      "transactionMode",
      "typesFile",
      "validators",
      "zodFile",
    ]) {
      expect(schema.properties?.[key], key).toBeDefined();
    }
    expect(schema.properties?.adapter).toMatchObject({ const: "auto", default: "auto" });
  });
});

describe("check reporters", () => {
  const files = [{ diagnostics: sampleDiagnostics, file: "migrations/x.sql" }];

  it("renders github workflow commands with file and severity", () => {
    const output = renderCheckReport("github", files);
    expect(output).toContain("::error file=migrations/x.sql,title=SUPA_CHECK_DROP_IF_EXISTS::");
    expect(output).toContain("::warning file=");
  });

  it("renders valid SARIF with rule ids", () => {
    const sarif = JSON.parse(renderCheckReport("sarif", files)) as {
      runs: { results: { ruleId: string; level: string }[] }[];
      version: string;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results.map((result) => result.ruleId)).toContain(
      "SUPA_CHECK_DROP_IF_EXISTS"
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
    expect(`${result.stdout}${result.stderr}`).toContain("SUPA_CHECK_CREATE_TABLE_GUARD");
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

describe("raw CLI errors", () => {
  it("redacts secrets before printing uncaught errors", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-redact-"));
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    writeFileSync(
      join(cwd, "supaschema.config.mjs"),
      `throw new Error("failed postgresql://postgres:super-secret@localhost/db token=abc123 ${jwt}");\n`
    );

    const result = spawnSync(process.execPath, [cliPath, "inspect"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("postgresql://postgres:[redacted]@localhost/db");
    expect(result.stderr).toContain("token=[redacted]");
    expect(result.stderr).toContain("[redacted-jwt]");
    expect(result.stderr).not.toContain("super-secret");
    expect(result.stderr).not.toContain("abc123");
    expect(result.stderr).not.toContain("eyJhbGci");
  });
});

describe("verify environment flags", () => {
  it("exposes both enable and disable flags for the Supabase environment stub", () => {
    const result = spawnSync(process.execPath, [cliPath, "verify", "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--ensure-environment");
    expect(result.stdout).toContain("--no-ensure-environment");
  });
});

describe("doctor environment resolution", () => {
  it("honors the global --env database URL lane", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-doctor-env-"));
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      `${JSON.stringify({ environments: { staging: { databaseUrl: "$STAGING_DB" } } })}\n`
    );

    const result = spawnSync(process.execPath, [cliPath, "--env", "staging", "doctor"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        STAGING_DB: "postgresql://postgres:postgres@127.0.0.1:1/postgres",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("database url: resolved via --env staging");
  });
});
