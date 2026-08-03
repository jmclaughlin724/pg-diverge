import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import { resolveGenerationSourceDefaults } from "../../src/planner/context.js";
import {
  defaultTreeSource,
  extractGenerationSourceModel,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "../../src/source/resolve.js";
import { verifyMigration } from "../../src/verify/migration.js";

const config = resolveConfig();
const execFileAsync = promisify(execFile);

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

  it("uses the baseline source and schema path owners before git fallback", async () => {
    const custom = resolveConfig({
      schemaPaths: ["db/schemas"],
      sources: { from: "dump:baseline.sql" },
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

  it("checks Git HEAD in the requested repository directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    let checkedCwd: string | undefined;

    await resolveGenerationSourceDefaults({ cwd: root }, config, (cwd) => {
      checkedCwd = cwd;
      return Promise.resolve(false);
    });

    expect(checkedCwd).toBe(root);
  });

  it("replays existing migrations when auto has no repository baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(join(root, "migrations", "20260101000000_existing.sql"), "select 1;");
    const custom = resolveConfig({ migrationsDir: "migrations" });

    const resolved = await resolveGenerationSourceDefaults(
      { cwd: root },
      custom,
      async () => false
    );

    expect(resolved.from).toBe("migrations:migrations");
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.notice).toContain("--from migrations:migrations");
  });

  it("prefers migration replay over git HEAD for a hand-authored tail", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(
      join(root, "migrations", "20260101000000_generated.sql"),
      "-- supaschema: lineage format=5 from=before to=after\nSELECT 1;\n"
    );
    await writeFile(join(root, "migrations", "20260102000000_manual.sql"), "CREATE SCHEMA app;\n");
    const custom = resolveConfig({ migrationsDir: "migrations" });

    const resolved = await resolveGenerationSourceDefaults({ cwd: root }, custom, async () => true);

    expect(resolved.from).toBe("migrations:migrations");
    expect(resolved.diagnostics).toEqual([]);
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

  it("accepts a configured migrations before-state that matches migrationsDir", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-resolve-"));
    await mkdir(join(root, "supabase", "migrations"), { recursive: true });
    const from = "migrations:supabase/migrations";
    const to = "dir:database/schemas";
    const custom = resolveConfig({
      migrationsDir: "supabase/migrations",
      sources: { from },
    });

    const resolved = await resolveGenerationSourceDefaults({ cwd: root, to }, custom);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.from).toBe(from);
    expect(resolved.to).toBe(to);
    expect(resolved.notice).toContain(`--from ${from}`);
  });

  it("rejects migrations replay as the generation target", async () => {
    const from = "database:postgresql://postgres:secret@example.test/db";
    const to = "migrations:supabase/migrations";
    const resolved = await resolveGenerationSourceDefaults({ from, to }, config);

    expect(resolved.from).toBe(from);
    expect(resolved.to).toBe(to);
    expect(resolved.diagnostics.map((item) => item.code)).toEqual([
      "SUPA_SOURCE_MIGRATIONS_TARGET_UNSUPPORTED",
    ]);
  });

  it("rejects a migrations before-state that does not match migrationsDir", async () => {
    const from = "migrations:supabase/migrations";
    const to = "database:postgresql://postgres:secret@example.test/db";
    const resolved = await resolveGenerationSourceDefaults({ from, to }, config);

    expect(resolved.from).toBe(from);
    expect(resolved.to).toBe(to);
    expect(resolved.diagnostics.map((item) => item.code)).toEqual([
      "SUPA_MIGRATION_BASELINE_UNSUPPORTED",
    ]);
  });

  it("redacts credentials when a configured database source is reported", async () => {
    const custom = resolveConfig({
      sources: { from: "database:postgresql://postgres:secret@example.test/db" },
    });

    const resolved = await resolveGenerationSourceDefaults({}, custom);

    expect(resolved.notice).toContain("postgresql://postgres:[redacted]@example.test/db");
    expect(resolved.notice).not.toContain("secret");
  });

  it("rejects removed configured target ownership", () => {
    expect(() =>
      resolveConfig({ sources: { from: "empty:", to: "migrations:supabase/migrations" } })
    ).toThrow();
  });
});

describe("generation source model reuse", () => {
  it("extracts a git revision once across the prove and plan phases", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-memo-"));
    await mkdir(join(root, "schemas"), { recursive: true });
    await writeFile(
      join(root, "schemas", "app.sql"),
      "CREATE TABLE public.accounts (id bigint);\n"
    );
    await execFileAsync("git", ["init", "-q", "."], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await execFileAsync("git", ["add", "-A"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "schema"], { cwd: root });
    const custom = resolveConfig({ migrationsDir: "migrations", schemaPaths: ["schemas"] });

    const proved = await extractGenerationSourceModel("git:HEAD", { config: custom, cwd: root });
    const planned = await extractGenerationSourceModel("git:HEAD", { config: custom, cwd: root });

    expect(planned).toBe(proved);
    expect(planned.objects.length).toBeGreaterThan(0);
  });

  it("does not reuse models across differing extraction inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-memo-scope-"));
    await mkdir(join(root, "schemas"), { recursive: true });
    await writeFile(
      join(root, "schemas", "app.sql"),
      "CREATE TABLE public.accounts (id bigint);\n"
    );
    await execFileAsync("git", ["init", "-q", "."], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await execFileAsync("git", ["add", "-A"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "schema"], { cwd: root });
    const custom = resolveConfig({ migrationsDir: "migrations", schemaPaths: ["schemas"] });
    const unnormalized = resolveConfig({
      migrationsDir: "migrations",
      normalize: "off",
      schemaPaths: ["schemas"],
    });

    const first = await extractGenerationSourceModel("git:HEAD", { config: custom, cwd: root });
    const second = await extractGenerationSourceModel("git:HEAD", {
      config: unnormalized,
      cwd: root,
    });

    expect(second).not.toBe(first);
  });

  it("never memoizes live database or catalog sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-live-"));
    const dump = join(root, "baseline.sql");
    await writeFile(dump, "CREATE TABLE public.accounts (id bigint);\n");
    const custom = resolveConfig({ migrationsDir: "migrations", schemaPaths: ["schemas"] });

    const first = await extractGenerationSourceModel(`dump:${dump}`, { config: custom, cwd: root });
    const second = await extractGenerationSourceModel(`dump:${dump}`, {
      config: custom,
      cwd: root,
    });

    expect(second).not.toBe(first);
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

describe("migrations source scope", () => {
  it("surfaces migrations extraction diagnostics in verify before connecting", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-source-scope-"));
    const migrationPath = join(root, "migration.sql");
    const history = join(root, "history");
    await mkdir(history);
    await writeFile(migrationPath, "CREATE SCHEMA IF NOT EXISTS app;\n");
    await writeFile(
      join(history, "20260101000000_invalid.sql"),
      "ALTER TABLE app.missing ADD COLUMN id bigint;\n"
    );

    const diagnostics = await verifyMigration({
      config,
      cwd: root,
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      from: "migrations:history",
      migrationPath,
      to: "migrations:history",
    });

    expect(diagnostics.map((item) => item.code)).toContain("SUPA_REPLAY_ORDER_GAP");
  });
});

describe("migrations directory resolution", () => {
  it("prefers the flag over config", () => {
    expect(resolveMigrationsDir("custom/migrations", config)).toBe("custom/migrations");
    expect(resolveMigrationsDir(undefined, config)).toBe("database/migrations");
  });
});
