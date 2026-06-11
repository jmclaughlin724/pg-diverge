import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultMigrationName,
  defaultTreeSource,
  latestMigrationFile,
  migrationFiles,
  migrationNameSlug,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "../src/cli-defaults.js";
import { resolveConfig } from "../src/config.js";
import type { MigrationPlan } from "../src/core.js";

const config = resolveConfig();

function planWith(operations: MigrationPlan["operations"]): MigrationPlan {
  return {
    diagnostics: [],
    fingerprint: "f",
    fromFingerprint: "a",
    operations,
    toFingerprint: "b",
  };
}

describe("source defaults", () => {
  it("passes explicit sources through without a notice", async () => {
    const resolved = await resolveSourceDefaults(
      { from: "git:HEAD", to: "dir:custom" },
      config,
      async () => "postgresql://ignored",
    );

    expect(resolved).toEqual({ from: "git:HEAD", notice: undefined, to: "dir:custom" });
  });

  it("defaults --to to the first config schema path", async () => {
    const custom = resolveConfig({ schemaPaths: ["db/schemas"] });

    expect(defaultTreeSource(custom)).toBe("dir:db/schemas");
    const resolved = await resolveSourceDefaults({ from: "git:HEAD" }, custom, async () => {
      return undefined;
    });
    expect(resolved.to).toBe("dir:db/schemas");
    expect(resolved.notice).toContain("--to dir:db/schemas");
  });

  it("defaults --from to the resolved database and redacts credentials", async () => {
    const resolved = await resolveSourceDefaults(
      {},
      config,
      async () => "postgresql://postgres:secret@127.0.0.1:5432/postgres",
    );

    expect(resolved.from).toBe("database:postgresql://postgres:secret@127.0.0.1:5432/postgres");
    expect(resolved.notice).toContain("[redacted]");
    expect(resolved.notice).not.toContain("secret");
  });

  it("falls back to git:HEAD when no database URL resolves", async () => {
    const resolved = await resolveSourceDefaults({}, config, async () => undefined);

    expect(resolved.from).toBe("git:HEAD");
    expect(resolved.notice).toContain("--from git:HEAD");
  });
});

describe("migration name defaults", () => {
  it("derives a slug from a single operation", () => {
    const plan = planWith([
      {
        blocked: false,
        destructive: false,
        key: "table:app.accounts",
        kind: "create",
        ref: { kind: "table", name: "accounts", schema: "app" },
        sql: "",
      },
    ] as MigrationPlan["operations"]);

    expect(defaultMigrationName(plan)).toBe("create_table_accounts");
  });

  it("uses schema_diff for empty and multi-operation plans", () => {
    expect(defaultMigrationName(planWith([]))).toBe("schema_diff");
    const multi = planWith([
      {
        blocked: false,
        destructive: false,
        key: "a",
        kind: "create",
        ref: { kind: "table", name: "a", schema: "app" },
        sql: "",
      },
      {
        blocked: false,
        destructive: false,
        key: "b",
        kind: "drop",
        ref: { kind: "view", name: "b", schema: "app" },
        sql: "",
      },
    ] as MigrationPlan["operations"]);
    expect(defaultMigrationName(multi)).toBe("schema_diff");
  });

  it("sanitizes slugs to lowercase snake case", () => {
    expect(migrationNameSlug('Create View app."Mixed Case"!')).toBe("create_view_app_mixed_case");
  });
});

describe("migrations directory defaults", () => {
  it("prefers the flag over config", () => {
    expect(resolveMigrationsDir("custom/migrations", config)).toBe("custom/migrations");
    expect(resolveMigrationsDir(undefined, config)).toBe("supabase/migrations");
  });

  it("lists and picks the newest migration file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgd-defaults-"));
    await writeFile(join(dir, "20240101000000_one.sql"), "SELECT 1;\n");
    await writeFile(join(dir, "20250101000000_two.sql"), "SELECT 2;\n");
    await writeFile(join(dir, "notes.md"), "not sql\n");

    const files = await migrationFiles(dir);
    expect(files.map((file) => file.split("/").at(-1))).toEqual([
      "20240101000000_one.sql",
      "20250101000000_two.sql",
    ]);
    expect((await latestMigrationFile(dir))?.endsWith("20250101000000_two.sql")).toBe(true);
    expect(await migrationFiles(join(dir, "missing"))).toEqual([]);
  });
});
