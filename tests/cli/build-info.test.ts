import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUnreleasedBuild,
  readBuildInfo,
  staleDistWarning,
  unreleasedBuildBanner,
} from "../../src/build-info.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supaschema-build-info-"));
  tempRoots.push(root);
  return root;
}

describe("readBuildInfo", () => {
  it("falls back to the package version when the stamp is missing", async () => {
    const info = await readBuildInfo(
      "9.9.9",
      pathToFileURL(join(await tempRoot(), "missing.json"))
    );
    expect(info).toEqual({ builtAt: null, commit: null, dirty: null, version: "9.9.9" });
  });

  it("reads a written stamp", async () => {
    const root = await tempRoot();
    const stampPath = join(root, "build-info.json");
    await writeFile(
      stampPath,
      JSON.stringify({
        builtAt: "2026-07-30T01:15:00.000Z",
        commit: "abc123",
        dirty: false,
        version: "0.5.5",
      })
    );
    const info = await readBuildInfo("0.0.0", pathToFileURL(stampPath));
    expect(info).toEqual({
      builtAt: "2026-07-30T01:15:00.000Z",
      commit: "abc123",
      dirty: false,
      version: "0.5.5",
    });
  });
});

describe("unreleased build banner", () => {
  const base = { builtAt: null, commit: "abcdef1234567890", dirty: false };

  it("flags prerelease versions", () => {
    const info = { ...base, version: "0.5.6-dev.abc1234" };
    expect(isUnreleasedBuild(info)).toBe(true);
    expect(unreleasedBuildBanner(info)).toBe(
      "supaschema 0.5.6-dev.abc1234 (abcdef123456) — unreleased build"
    );
  });

  it("flags dirty trees", () => {
    expect(isUnreleasedBuild({ ...base, dirty: true, version: "0.5.5" })).toBe(true);
  });

  it("passes clean release builds", () => {
    const info = { ...base, version: "0.5.5" };
    expect(isUnreleasedBuild(info)).toBe(false);
    expect(unreleasedBuildBanner(info)).toBeNull();
  });
});

describe("staleDistWarning", () => {
  const stamp = {
    builtAt: "2026-07-30T01:15:00.000Z",
    commit: "abc123",
    dirty: false,
    version: "0.5.5",
  };

  it("returns null when no src directory exists", async () => {
    expect(await staleDistWarning(stamp, await tempRoot())).toBeNull();
  });

  it("returns null when src is older than the build", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, "src");
    await mkdir(sourceRoot);
    const file = join(sourceRoot, "index.ts");
    await writeFile(file, "export {};\n");
    const old = new Date("2026-07-01T00:00:00.000Z");
    await utimes(file, old, old);
    expect(await staleDistWarning(stamp, root)).toBeNull();
  });

  it("warns when src is newer than the build", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, "src");
    await mkdir(sourceRoot, { recursive: true });
    const file = join(sourceRoot, "index.ts");
    await writeFile(file, "export {};\n");
    const recent = new Date("2026-07-30T02:00:00.000Z");
    await utimes(file, recent, recent);
    expect(await staleDistWarning(stamp, root)).toBe(
      "SUPA_BUILD_STALE_DIST: compiled dist is older than src; run npm run build before trusting CLI behavior"
    );
  });

  it("returns null without a build timestamp", async () => {
    expect(await staleDistWarning({ ...stamp, builtAt: null }, await tempRoot())).toBeNull();
  });

  it("fails open when the source tree cannot be traversed", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, "src");
    await mkdir(sourceRoot);
    const { symlink } = await import("node:fs/promises");
    await symlink(join(root, "missing-target"), join(sourceRoot, "broken.ts"));
    expect(await staleDistWarning(stamp, root)).toBeNull();
  });
});
