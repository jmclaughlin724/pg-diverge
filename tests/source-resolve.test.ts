import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/schema.js";
import { resolveGenerationSourceDefaults } from "../src/planning/context.js";
import {
  defaultTreeSource,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "../src/source/resolve.js";

const config = resolveConfig();

describe("generation source defaults", () => {
  it("passes explicit sources through without a notice", async () => {
    const resolved = await resolveGenerationSourceDefaults(
      { from: "git:HEAD", to: "dir:custom" },
      config
    );

    expect(resolved).toEqual({
      diagnostics: [],
      from: "git:HEAD",
      notice: undefined,
      to: "dir:custom",
    });
  });

  it("defaults --to to the first config schema path", async () => {
    const custom = resolveConfig({ schemaPaths: ["db/schemas"] });

    expect(defaultTreeSource(custom)).toBe("dir:db/schemas");
    const resolved = await resolveGenerationSourceDefaults({ from: "git:HEAD" }, custom);
    expect(resolved.to).toBe("dir:db/schemas");
    expect(resolved.notice).toContain("--to dir:db/schemas");
  });

  it("uses config-owned source defaults before git fallback", async () => {
    const custom = resolveConfig({
      schemaPaths: ["ignored/schemas"],
      sources: { from: "dump:baseline.sql", to: "dir:db/schemas" },
    });

    const resolved = await resolveGenerationSourceDefaults({}, custom);

    expect(resolved.from).toBe("dump:baseline.sql");
    expect(resolved.to).toBe("dir:db/schemas");
    expect(resolved.notice).toContain("--from dump:baseline.sql");
    expect(resolved.notice).toContain("--to dir:db/schemas");
  });

  it("defaults --from to git:HEAD when HEAD exists", async () => {
    const resolved = await resolveGenerationSourceDefaults({}, config, async () => true);

    expect(resolved.from).toBe("git:HEAD");
    expect(resolved.notice).toContain("--from git:HEAD");
  });

  it("blocks auto with existing migrations and no repository baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(join(root, "migrations", "20260101000000_existing.sql"), "select 1;");
    const custom = resolveConfig({ migrationsDir: "migrations" });

    const resolved = await resolveGenerationSourceDefaults(
      { cwd: root },
      custom,
      async () => false
    );

    expect(resolved.from).toBe("empty:");
    expect(resolved.diagnostics.map((item) => item.code)).toContain(
      "SUPA_SOURCE_BASELINE_REQUIRED"
    );
    expect(resolved.notice).not.toContain("--from empty:");
  });

  it("falls back to empty: for a first migration with no git HEAD", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    const custom = resolveConfig({ migrationsDir: "migrations" });
    const resolved = await resolveGenerationSourceDefaults(
      { cwd: root },
      custom,
      async () => false
    );

    expect(resolved.from).toBe("empty:");
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.notice).toContain("--from empty:");
  });

  it("rejects live database sources for generation", async () => {
    const resolved = await resolveGenerationSourceDefaults(
      { from: "database:postgresql://postgres:secret@example.test/db" },
      config
    );

    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({ code: "SUPA_SOURCE_LIVE_DATABASE_FOR_GENERATION" }),
    ]);
  });
});

describe("generic source defaults", () => {
  it("still supports database fallback for explicit database-backed workflows", async () => {
    const resolved = await resolveSourceDefaults(
      {},
      config,
      async () => "postgresql://postgres:secret@127.0.0.1:5432/postgres",
      async () => false
    );

    expect(resolved.from).toBe("database:postgresql://postgres:secret@127.0.0.1:5432/postgres");
    expect(resolved.notice).toContain("[redacted]");
    expect(resolved.notice).not.toContain("secret");
  });
});

describe("migrations directory resolution", () => {
  it("prefers the flag over config", () => {
    expect(resolveMigrationsDir("custom/migrations", config)).toBe("custom/migrations");
    expect(resolveMigrationsDir(undefined, config)).toBe("database/migrations");
  });
});
