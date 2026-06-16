import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import {
  excludedMaintainerFiles,
  expectedInstalledConfig,
  installedAgentFiles,
} from "./install-parity-expectations.js";
import {
  expectedMigrationFragments,
  expectedTypesFragments,
  expectedZodFragments,
} from "./sample-schema-expectations.js";

// End-to-end consumer lifecycle: pack the real tarball, `npm install` it into a
// clean throwaway project (which resolves runtime deps AND runs supaschema's
// postinstall scaffolder via INIT_CWD, exactly like `npm install supaschema`),
// then EDIT a schema in the scaffolded tree and run the INSTALLED CLI binary to
// prove it generates an accurate migration + types. This is the "use" proof:
// it exercises the shipped dist through the installed bin, not the src tree.
// The install-boundary assertions (full scaffold contents) stay owned by
// tests/database-url.test.ts; this test owns the download -> install -> use chain.
//
// A bare `tar` extract cannot run the CLI (dist/cli.js needs commander/pg/
// libpg-query/pgsql-deparser/zod), so a real tarball install is required — the
// npm-documented "install the tarball, run the installed bin" pattern.

const run = promisify(execFile);

interface Spawn {
  args: string[];
  file: string;
}
interface CaptureResult {
  code: number;
  stderr: string;
  stdout: string;
}

function npmExec(args: string[]): Spawn {
  const execpath = process.env.npm_execpath;
  return execpath
    ? { args: [execpath, ...args], file: process.execPath }
    : { args, file: process.platform === "win32" ? "npm.cmd" : "npm" };
}

// Spawn through `node` (never the node_modules/.bin shim) and never throw on a
// non-zero exit — the bin's exit code is part of what we assert. This is the
// cross-platform-safe invocation (the .bin shim mishandles quoted args on Windows).
async function capture(file: string, args: string[], cwd: string): Promise<CaptureResult> {
  try {
    const { stdout, stderr } = await run(file, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stderr, stdout };
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; stdout?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stderr: failure.stderr ?? "",
      stdout: failure.stdout ?? "",
    };
  }
}

async function copySqlTree(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir)) {
    if (entry.endsWith(".sql")) {
      await cp(join(sourceDir, entry), join(targetDir, entry));
    }
  }
}

const repoVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string })
  .version;
// The shared fixture trees are the single source of the schema edit (the same
// edit the in-process unit test asserts): `schemas` is the prior state, and
// `schemas-next` is the edited desired state.
const fixtureFrom = "tests/fixtures/sample-project/supabase/schemas";
const fixtureTo = "tests/fixtures/sample-project/supabase/schemas-next";

let consumer = "";
let binPath = "";
// A second consumer installed WITH --ignore-scripts simulates blocked dependency
// lifecycle scripts: postinstall never runs, so `supaschema init` must complete
// setup. Marker-free -> generic layout.
let consumer2 = "";
let binPath2 = "";

beforeAll(async () => {
  const packDir = await mkdtemp(join(tmpdir(), "supa-pack-"));
  const pack = npmExec(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir]);
  const { stdout } = await run(pack.file, pack.args, { maxBuffer: 32 * 1024 * 1024 });
  const [packed] = JSON.parse(stdout) as { filename: string }[];
  const tarball = join(packDir, packed.filename);

  consumer = await mkdtemp(join(tmpdir(), "supa-consumer-"));
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "supaschema-consumer-fixture", private: true, version: "0.0.0" })}\n`
  );
  // A supabase/config.toml marker makes postinstall scaffold the Supabase layout.
  await mkdir(join(consumer, "supabase"), { recursive: true });
  await writeFile(join(consumer, "supabase", "config.toml"), "[db]\nport = 54322\n");

  // Resolves runtime deps and runs supaschema's postinstall with INIT_CWD=consumer.
  // --prefer-offline uses the local npm cache; --ignore-scripts is intentionally NOT
  // passed so the real postinstall scaffolder runs as a consumer would experience it.
  const install = npmExec(["install", tarball, "--prefer-offline", "--no-audit", "--no-fund"]);
  await run(install.file, install.args, { cwd: consumer, maxBuffer: 64 * 1024 * 1024 });

  binPath = join(consumer, "node_modules", "supaschema", "bin", "supaschema");

  // Second consumer: marker-free (generic layout), installed WITH --ignore-scripts to
  // simulate blocked dependency lifecycle scripts — postinstall does NOT run, leaving
  // the project unscaffolded for the `supaschema init` fallback lane to complete. The
  // same packed tarball is reused (only the pack is shared; this install is independent).
  consumer2 = await mkdtemp(join(tmpdir(), "supa-consumer-init-"));
  await writeFile(
    join(consumer2, "package.json"),
    `${JSON.stringify({ name: "supaschema-init-fixture", private: true, version: "0.0.0" })}\n`
  );
  const installNoScripts = npmExec([
    "install",
    tarball,
    "--ignore-scripts",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
  ]);
  await run(installNoScripts.file, installNoScripts.args, {
    cwd: consumer2,
    maxBuffer: 64 * 1024 * 1024,
  });
  binPath2 = join(consumer2, "node_modules", "supaschema", "bin", "supaschema");
}, 300_000);

describe("consumer lifecycle: install then use the published package", () => {
  it("npm install of the packed tarball scaffolds the project and ships a runnable CLI", () => {
    // Install scaffolded the Supabase layout (deep contents are asserted by
    // database-url.test.ts; here we confirm the preconditions for "use").
    expect(existsSync(join(consumer, "supaschema.config.json"))).toBe(true);
    expect(existsSync(join(consumer, "supabase", "schemas"))).toBe(true);
    expect(existsSync(join(consumer, "supabase", "migrations"))).toBe(true);
    // The installed package ships the real dist that the 2-line bin loads.
    expect(existsSync(join(consumer, "node_modules", "supaschema", "dist", "cli.js"))).toBe(true);
    expect(existsSync(binPath)).toBe(true);

    const config = JSON.parse(
      readFileSync(join(consumer, "supaschema.config.json"), "utf8")
    ) as Record<string, unknown>;
    expect(config.schemaPaths).toEqual(["supabase/schemas"]);
    expect(config.migrationsDir).toBe("supabase/migrations");
  });

  it("runs --version from the installed binary", async () => {
    const result = await capture(process.execPath, [binPath, "--version"], consumer);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(repoVersion);
  });

  it("turns a schema edit into an accurate migration and generated types via the installed CLI", async () => {
    // Prior state -> a `baseline` tree; the edit lands in the scaffolded schemaPaths
    // tree. Both come from the shared fixture, so the expected output is known.
    await copySqlTree(fixtureFrom, join(consumer, "baseline", "schemas"));
    await copySqlTree(fixtureTo, join(consumer, "supabase", "schemas"));

    const configPath = join(consumer, "supaschema.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config.sources = {
      from: "dir:baseline/schemas",
      to: "dir:supabase/schemas",
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    // `diff` (no --out and no source flags) writes <ts>_<name>.sql into the
    // install-configured migrationsDir from config-owned source defaults.
    const diff = await capture(process.execPath, [binPath, "diff"], consumer);
    expect(diff.code, diff.stderr).toBe(0);

    const migrations = (await readdir(join(consumer, "supabase", "migrations"))).filter((entry) =>
      entry.endsWith(".sql")
    );
    expect(migrations).toHaveLength(1);
    const migrationSql = await readFile(
      join(consumer, "supabase", "migrations", migrations[0] ?? ""),
      "utf8"
    );
    for (const fragment of expectedMigrationFragments) {
      expect(migrationSql, fragment).toContain(fragment);
    }
    // Generated migrations carry the lineage marker.
    expect(migrationSql).toContain("-- supaschema: lineage");

    // `check` (zero-arg) gates every migration in the configured migrationsDir.
    const check = await capture(process.execPath, [binPath, "check"], consumer);
    expect(check.code, check.stderr).toBe(0);

    // `types` (zero-arg) reads the configured schema tree and writes typesFile + zodFile.
    const types = await capture(process.execPath, [binPath, "types"], consumer);
    expect(types.code, types.stderr).toBe(0);

    const typesFile = await readFile(join(consumer, "database.types.ts"), "utf8");
    for (const fragment of expectedTypesFragments) {
      expect(typesFile, fragment).toContain(fragment);
    }
    const zodFile = await readFile(join(consumer, "database.zod.ts"), "utf8");
    for (const fragment of expectedZodFragments) {
      expect(zodFile, fragment).toContain(fragment);
    }
  });
});

describe("consumer lifecycle: ignore-scripts install then supaschema init reaches full parity", () => {
  it("install --ignore-scripts does not scaffold but still ships the CLI and shared scaffolder", () => {
    // Dependency lifecycle scripts were blocked: postinstall did not run, so nothing scaffolded...
    expect(existsSync(join(consumer2, "supaschema.config.json"))).toBe(false);
    expect(existsSync(join(consumer2, ".supaschema", "install.json"))).toBe(false);
    expect(existsSync(join(consumer2, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(consumer2, "database", "schemas"))).toBe(false);
    // ...but the tarball was still extracted, so the bin, its dist, and the shared
    // scaffolder are present for `supaschema init` to complete setup.
    expect(existsSync(binPath2)).toBe(true);
    expect(existsSync(join(consumer2, "node_modules", "supaschema", "dist", "cli.js"))).toBe(true);
    expect(existsSync(join(consumer2, "node_modules", "supaschema", "bin", "scaffold.mjs"))).toBe(
      true
    );
  });

  it("supaschema init scaffolds the full setup at parity with postinstall, idempotently", async () => {
    const first = await capture(process.execPath, [binPath2, "init"], consumer2);
    expect(first.code, first.stderr).toBe(0);

    // Full parity with the postinstall scaffold (generic layout — no provider marker).
    const config = JSON.parse(
      readFileSync(join(consumer2, "supaschema.config.json"), "utf8")
    ) as Record<string, unknown>;
    expect(config).toEqual(expectedInstalledConfig("database/schemas", "database/migrations"));
    expect(existsSync(join(consumer2, "database", "schemas"))).toBe(true);
    expect(existsSync(join(consumer2, "database", "migrations"))).toBe(true);
    for (const file of installedAgentFiles) {
      expect(existsSync(join(consumer2, file)), file).toBe(true);
    }
    for (const file of excludedMaintainerFiles) {
      expect(existsSync(join(consumer2, file)), file).toBe(false);
    }
    const manifest = JSON.parse(
      readFileSync(join(consumer2, ".supaschema", "install.json"), "utf8")
    ) as { adapter?: string };
    expect(manifest.adapter).toBe("auto");
    const agents = await readFile(join(consumer2, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- supaschema:agent-guidance:start -->");
    expect(agents).toContain("Schema intent belongs in `database/schemas`");

    // Idempotent: a second init must not crash (no EEXIST) and keeps ONE guidance block.
    const second = await capture(process.execPath, [binPath2, "init"], consumer2);
    expect(second.code, second.stderr).toBe(0);
    const agentsAfter = await readFile(join(consumer2, "AGENTS.md"), "utf8");
    expect(agentsAfter.split("<!-- supaschema:agent-guidance:start -->")).toHaveLength(2);
  });

  it("generates an accurate migration and types after init, via the installed CLI", async () => {
    await copySqlTree(fixtureFrom, join(consumer2, "baseline", "schemas"));
    await copySqlTree(fixtureTo, join(consumer2, "database", "schemas"));

    const diff = await capture(
      process.execPath,
      [binPath2, "diff", "--from", "dir:baseline/schemas", "--name", "add_account_status"],
      consumer2
    );
    expect(diff.code, diff.stderr).toBe(0);

    const migrations = (await readdir(join(consumer2, "database", "migrations"))).filter((entry) =>
      entry.endsWith(".sql")
    );
    expect(migrations).toHaveLength(1);
    const migrationSql = await readFile(
      join(consumer2, "database", "migrations", migrations[0] ?? ""),
      "utf8"
    );
    for (const fragment of expectedMigrationFragments) {
      expect(migrationSql, fragment).toContain(fragment);
    }
    expect(migrationSql).toContain("-- supaschema: lineage");

    const check = await capture(process.execPath, [binPath2, "check"], consumer2);
    expect(check.code, check.stderr).toBe(0);

    const types = await capture(process.execPath, [binPath2, "types"], consumer2);
    expect(types.code, types.stderr).toBe(0);
    const typesFile = await readFile(join(consumer2, "database.types.ts"), "utf8");
    for (const fragment of expectedTypesFragments) {
      expect(typesFile, fragment).toContain(fragment);
    }
    const zodFile = await readFile(join(consumer2, "database.zod.ts"), "utf8");
    for (const fragment of expectedZodFragments) {
      expect(zodFile, fragment).toContain(fragment);
    }
  });
});
