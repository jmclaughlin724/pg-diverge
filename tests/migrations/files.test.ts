import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MigrationPlan } from "../../src/core.js";
import {
  defaultMigrationName,
  latestMigrationFile,
  migrationFiles,
  migrationNameSlug,
} from "../../src/migrations/files.js";

function planWith(operations: MigrationPlan["operations"]): MigrationPlan {
  return {
    diagnostics: [],
    fingerprint: "f",
    fromFingerprint: "a",
    operations,
    toFingerprint: "b",
  };
}

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
    ]);

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
    ]);
    expect(defaultMigrationName(multi)).toBe("schema_diff");
  });

  it("sanitizes slugs to lowercase snake case", () => {
    expect(migrationNameSlug('Create View app."Mixed Case"!')).toBe("create_view_app_mixed_case");
  });
});

describe("migration file enumeration", () => {
  it("lists and picks the newest migration file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "supa-defaults-"));
    await writeFile(join(dir, "20240101000000_one.sql"), "SELECT 1;\n");
    await writeFile(join(dir, "20250101000000_two.sql"), "SELECT 2;\n");
    await writeFile(join(dir, "notes.md"), "not sql\n");

    const files = await migrationFiles(dir);
    expect(files.map((file) => basename(file))).toEqual([
      "20240101000000_one.sql",
      "20250101000000_two.sql",
    ]);
    expect((await latestMigrationFile(dir))?.endsWith("20250101000000_two.sql")).toBe(true);
    expect(await migrationFiles(join(dir, "missing"))).toEqual([]);
  });
});
