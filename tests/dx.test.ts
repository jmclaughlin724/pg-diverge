import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCheckReport } from "../src/check-reporters.js";
import {
  configJsonSchema,
  defaultConfigFile,
  resolveConfig,
  validateConfig,
} from "../src/config.js";
import { sourceSpecPattern } from "../src/config-contract.js";
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
    const config = resolveConfig({
      $schema: "./node_modules/supaschema/supaschema-config.schema.json",
    });
    expect(config.adapter).toBe("auto");
    expect(JSON.parse(defaultConfigFile)).toEqual({
      $schema: "./node_modules/supaschema/supaschema-config.schema.json",
      ...resolveConfig(),
    });
  });

  it("normalizes legacy adapter values at the input boundary", () => {
    expect(resolveConfig({ adapter: "supabase-auto" } as never).adapter).toBe("auto");
    expect(resolveConfig({ adapter: "postgres" } as never).adapter).toBe("auto");
    expect(resolveConfig({ adapter: "supabase" } as never).adapter).toBe("auto");
  });

  it("defaults to provider-neutral managed schemas unless configured", () => {
    expect(resolveConfig({}).managedSchemas).toEqual([]);

    expect(resolveConfig({ adapter: "auto", managedSchemas: ["auth"] }).managedSchemas).toEqual([
      "auth",
    ]);
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
    const schema = configJsonSchema() as {
      $id?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.$id).toBe("https://supaschema.com/schemas/supaschema-config.schema.json");
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
      "sources",
      "transactionMode",
      "typesFile",
      "validators",
      "workflow",
      "zodFile",
    ]) {
      expect(schema.properties?.[key], key).toBeDefined();
    }
    expect(schema.properties?.adapter).toMatchObject({
      default: "auto",
      enum: ["auto", "postgres", "supabase", "supabase-auto"],
    });
    const workflow = schema.properties?.workflow as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(workflow.properties?.migration_sync?.enum).toEqual([
      "disabled",
      "explicit_request_only",
    ]);
    const sources = schema.properties?.sources as {
      properties?: Record<string, { oneOf?: unknown[]; pattern?: string }>;
    };
    expect(sources.properties?.from?.oneOf).toEqual([
      { const: "auto" },
      { pattern: sourceSpecPattern, type: "string" },
    ]);
    expect(sources.properties?.to?.pattern).toBe(sourceSpecPattern);
  });

  it("rejects unknown workflow policy values", () => {
    expect(() =>
      resolveConfig({
        workflow: { migration_sync: "auto_apply" },
      } as never)
    ).toThrow();
    expect(resolveConfig().workflow).toEqual({
      schema_diff: "on_schema_write",
      migration_check: "after_schema_diff",
      migration_verify: "suggest_after_check",
      migration_sync: "explicit_request_only",
      type_generation: "create_or_refresh",
      zod_generation: "create_or_refresh",
      type_usage: "zod_validated",
    });
  });

  it("validates source defaults and redacts inline database URLs", async () => {
    const diagnostics = await validateConfig(
      resolveConfig({
        sources: {
          from: "postgresql://postgres:secret@example.com/app",
          to: "auto",
        },
      } as never),
      mkdtempSync(join(tmpdir(), "supa-config-validate-"))
    );

    expect(diagnostics.some((item) => item.field === "sources.from")).toBe(true);
    expect(diagnostics.some((item) => item.field === "sources.to")).toBe(true);
    const text = JSON.stringify(diagnostics);
    expect(text).toContain("postgresql://postgres:[redacted]@example.com/app");
    expect(text).not.toContain("secret");
  });

  it("reports pending install path confirmation during config validation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-config-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({ pathConfirmationNeeded: true })
    );

    const diagnostics = await validateConfig(resolveConfig(), cwd, { includeInstallState: true });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        field: ".supaschema/install.json",
        severity: "error",
      })
    );
  });

  it("accepts a stale pending install flag after explicit path confirmation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-confirmed-config-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({ pathConfirmationNeeded: true })
    );
    writeFileSync(
      join(cwd, "supaschema.config.json"),
      JSON.stringify({
        migrationsDir: "apps/api/migrations",
        schemaPaths: ["apps/api/schemas"],
        sources: { from: "auto", to: "dir:apps/api/schemas" },
      })
    );

    const diagnostics = await validateConfig(resolveConfig(), cwd, { includeInstallState: true });

    expect(diagnostics.map((item) => item.field)).not.toContain(".supaschema/install.json");
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

  it("fails zero-arg check on an empty migrations directory unless allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-empty-check-"));

    const rejected = spawnSync(process.execPath, [cliPath, "check"], {
      cwd,
      encoding: "utf8",
    });
    const allowed = spawnSync(process.execPath, [cliPath, "check", "--allow-empty"], {
      cwd,
      encoding: "utf8",
    });

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("no migrations found in database/migrations");
    expect(allowed.status).toBe(0);
  });
});

describe("raw CLI errors", () => {
  it("rejects JavaScript config files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-redact-"));
    writeFileSync(
      join(cwd, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/migrations" };\n'
    );

    const result = spawnSync(
      process.execPath,
      [cliPath, "--config", "supaschema.config.mjs", "inspect"],
      {
        cwd,
        encoding: "utf8",
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("JavaScript config files are not supported");
  });

  it("redacts database source credentials from inspect JSON output", () => {
    const password = "p".repeat(300);
    const source = `database:postgresql://user:${password}@127.0.0.1:9/db`;
    const result = spawnSync(process.execPath, [cliPath, "inspect", "--from", source], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).not.toContain(password);
    expect(result.stdout).toContain("postgresql://user:[redacted]@127.0.0.1:9/db");
  });

  it("ignores JavaScript config files during default discovery", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-cli-js-default-"));
    writeFileSync(
      join(cwd, "supaschema.config.mjs"),
      'export default { schemaPaths: ["db/sql"], migrationsDir: "db/migrations" };\n'
    );

    const result = spawnSync(process.execPath, [cliPath, "config", "validate", "--json"], {
      cwd,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { diagnostics: { field: string }[] };
    expect(parsed.diagnostics.map((item) => item.field)).toContain("schemaPaths[0]");
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

describe("pending install path confirmation", () => {
  it("blocks config validate, doctor, zero-source diff, and zero-arg check", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-install-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    mkdirSync(join(cwd, "database/migrations"), { recursive: true });
    writeFileSync(
      join(cwd, ".supaschema", "install.json"),
      JSON.stringify({
        candidates: {
          migrationsDirs: ["apps/api/migrations", "packages/db/migrations"],
          schemaPaths: ["apps/api/schemas", "packages/db/schemas"],
        },
        pathConfirmationNeeded: true,
      })
    );
    writeFileSync(
      join(cwd, "database/migrations", "20260101000000_safe.sql"),
      "CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE IF NOT EXISTS app.t (id bigint);\n"
    );

    const validate = spawnSync(process.execPath, [cliPath, "config", "validate", "--json"], {
      cwd,
      encoding: "utf8",
    });
    const doctor = spawnSync(process.execPath, [cliPath, "doctor"], { cwd, encoding: "utf8" });
    const diff = spawnSync(process.execPath, [cliPath, "diff"], { cwd, encoding: "utf8" });
    const check = spawnSync(process.execPath, [cliPath, "check"], { cwd, encoding: "utf8" });

    expect(validate.status).toBe(2);
    expect(JSON.parse(validate.stdout).diagnostics).toContainEqual(
      expect.objectContaining({ field: ".supaschema/install.json", severity: "error" })
    );
    expect(doctor.status).toBe(2);
    expect(doctor.stdout).toContain("install path confirmation");
    expect(diff.status).toBe(2);
    expect(diff.stderr).toContain(".supaschema/install.json");
    expect(check.status).toBe(2);
    expect(check.stderr).toContain(".supaschema/install.json");
  });

  it("allows explicit source diff as a recovery path while install confirmation is pending", () => {
    const cwd = mkdtempSync(join(tmpdir(), "supa-pending-explicit-diff-"));
    mkdirSync(join(cwd, ".supaschema"), { recursive: true });
    mkdirSync(join(cwd, "schemas"), { recursive: true });
    writeFileSync(join(cwd, ".supaschema", "install.json"), '{"pathConfirmationNeeded":true}\n');
    writeFileSync(join(cwd, "schemas", "schema.sql"), "CREATE SCHEMA app;\n");

    const result = spawnSync(
      process.execPath,
      [cliPath, "diff", "--from", "empty:", "--to", "dir:schemas", "--out", "stdout"],
      { cwd, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CREATE SCHEMA IF NOT EXISTS app");
  });
});
