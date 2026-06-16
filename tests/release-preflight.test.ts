import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "..", "scripts/release/preflight.mjs");
const tempDirs: string[] = [];

function makeProject(options: {
  packageVersion?: string;
  lockVersion?: string;
  rootVersion?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), "supaschema-release-preflight-"));
  tempDirs.push(dir);

  const packageVersion = options.packageVersion ?? "1.2.3";
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "supaschema", version: packageVersion }, null, 2)}\n`
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        name: "supaschema",
        packages: { "": { name: "supaschema", version: options.rootVersion ?? packageVersion } },
        version: options.lockVersion ?? packageVersion,
      },
      null,
      2
    )}\n`
  );

  return dir;
}

function runPreflight(cwd: string, publishedVersions: string[]) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPASCHEMA_RELEASE_NPM_VIEW_JSON: JSON.stringify(publishedVersions),
    },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }
});

describe("release preflight", () => {
  it("accepts a matching package version that is not published", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, ["1.2.2"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RELEASE_PREFLIGHT_OK supaschema@1.2.3 is unpublished");
  });

  it("rejects a package version that already exists on npm", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, ["1.2.2", "1.2.3"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("supaschema@1.2.3 already exists on npm");
  });

  it("rejects a top-level package-lock version mismatch", () => {
    const cwd = makeProject({ lockVersion: "1.2.2" });

    const result = runPreflight(cwd, []);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package-lock.json version 1.2.2 does not match");
  });

  it("rejects a package-lock root package version mismatch", () => {
    const cwd = makeProject({ rootVersion: "1.2.2" });

    const result = runPreflight(cwd, []);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package-lock.json root package version 1.2.2 does not match");
  });
});
