import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, resolveSupabaseLocalDatabaseUrl } from "../src/database-url.js";

const run = promisify(execFile);

describe("supabase database URL discovery", () => {
  it("reads [db] port from the nearest supabase/config.toml, walking upward", async () => {
    const root = await mkdtemp(join(tmpdir(), "pgd-url-"));
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(
      join(root, "supabase", "config.toml"),
      "[api]\nport = 64321\n\n[db]\nport = 64322 # local db\nshadow_port = 64320\nmajor_version = 17\n\n[studio]\nport = 64323\n",
    );
    const nested = join(root, "apps", "web");
    await mkdir(nested, { recursive: true });

    expect(resolveSupabaseLocalDatabaseUrl(nested)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:64322/postgres",
    );
  });

  it("returns undefined when no supabase config exists upward", async () => {
    const root = await mkdtemp(join(tmpdir(), "pgd-url-none-"));

    expect(resolveSupabaseLocalDatabaseUrl(root)).toBeUndefined();
  });

  it("applies the Supabase default port when [db] omits it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pgd-url-default-"));
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), "[db]\nmajor_version = 17\n");

    expect(resolveSupabaseLocalDatabaseUrl(root)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
  });

  it("prefers an explicit value and supports $ENV indirection", () => {
    expect(resolveDatabaseUrl("postgresql://x@y/z")).toBe("postgresql://x@y/z");
    process.env.PGD_URL_TEST = "postgresql://from-env@host/db";
    try {
      expect(resolveDatabaseUrl("$PGD_URL_TEST")).toBe("postgresql://from-env@host/db");
    } finally {
      delete process.env.PGD_URL_TEST;
    }
  });
});

describe("install-time config scaffold", () => {
  it("creates supaschema.config.json in the consumer root and never overwrites", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "pgd-postinstall-"));
    const env = { ...process.env, INIT_CWD: consumer };

    await run("node", ["bin/postinstall.mjs"], { env });
    const configPath = join(consumer, "supaschema.config.json");
    expect(existsSync(configPath)).toBe(true);
    const written = await readFile(configPath, "utf8");
    expect(JSON.parse(written)).toHaveProperty("adapter", "supabase-auto");

    await writeFile(configPath, '{"adapter":"postgres"}\n');
    await run("node", ["bin/postinstall.mjs"], { env });
    expect(await readFile(configPath, "utf8")).toBe('{"adapter":"postgres"}\n');
  });

  it("does nothing inside supaschema's own checkout", async () => {
    const env = { ...process.env, INIT_CWD: process.cwd() };

    const { stdout } = await run("node", ["bin/postinstall.mjs"], { env });

    expect(stdout).toBe("");
    expect(existsSync(join(process.cwd(), "supaschema.config.json"))).toBe(false);
  });
});
