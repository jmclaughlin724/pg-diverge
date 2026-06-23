import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/schema.js";
import {
  defaultTreeSource,
  resolveMigrationsDir,
  resolveSourceDefaults,
} from "../src/source/resolve.js";

const config = resolveConfig();

describe("source defaults", () => {
  it("passes explicit sources through without a notice", async () => {
    const resolved = await resolveSourceDefaults(
      { from: "git:HEAD", to: "dir:custom" },
      config,
      async () => "postgresql://ignored"
    );

    expect(resolved).toEqual({ from: "git:HEAD", notice: undefined, to: "dir:custom" });
  });

  it("defaults --to to the first config schema path", async () => {
    const custom = resolveConfig({ schemaPaths: ["db/schemas"] });

    expect(defaultTreeSource(custom)).toBe("dir:db/schemas");
    const resolved = await resolveSourceDefaults(
      { from: "git:HEAD" },
      custom,
      async () => undefined
    );
    expect(resolved.to).toBe("dir:db/schemas");
    expect(resolved.notice).toContain("--to dir:db/schemas");
  });

  it("uses config-owned source defaults before git/database fallback", async () => {
    const custom = resolveConfig({
      schemaPaths: ["ignored/schemas"],
      sources: { from: "dump:baseline.sql", to: "dir:db/schemas" },
    });

    const resolved = await resolveSourceDefaults({}, custom, () =>
      Promise.reject(new Error("database lookup should not run"))
    );

    expect(resolved.from).toBe("dump:baseline.sql");
    expect(resolved.to).toBe("dir:db/schemas");
    expect(resolved.notice).toContain("--from dump:baseline.sql");
    expect(resolved.notice).toContain("--to dir:db/schemas");
  });

  it("defaults --from to git:HEAD before a resolved database when HEAD exists", async () => {
    const resolved = await resolveSourceDefaults(
      {},
      config,
      () => {
        throw new Error("database lookup should not run when HEAD exists");
      },
      async () => true
    );

    expect(resolved.from).toBe("git:HEAD");
    expect(resolved.notice).toContain("--from git:HEAD");
  });

  it("falls back to the resolved database when no git HEAD exists and redacts credentials", async () => {
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

  it("falls back to empty: when no git HEAD or database URL resolves", async () => {
    const resolved = await resolveSourceDefaults(
      {},
      config,
      async () => undefined,
      async () => false
    );

    expect(resolved.from).toBe("empty:");
    expect(resolved.notice).toContain("--from empty:");
  });
});

describe("migrations directory resolution", () => {
  it("prefers the flag over config", () => {
    expect(resolveMigrationsDir("custom/migrations", config)).toBe("custom/migrations");
    expect(resolveMigrationsDir(undefined, config)).toBe("database/migrations");
  });
});
