import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "..", "scripts/release/preflight.mjs");
const tempDirs: string[] = [];
const releaseCommit = "0123456789abcdef0123456789abcdef01234567";

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
    `${JSON.stringify(
      {
        name: "supaschema",
        repository: { type: "git", url: "git+https://github.com/jmclaughlin724/supaschema.git" },
        version: packageVersion,
      },
      null,
      2
    )}\n`
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

function runPreflight(
  cwd: string,
  options: {
    githubEnv?: string;
    githubOutput?: string;
    githubReleaseExists?: boolean;
    githubSha?: string;
    githubTagTarget?: string;
    publishedVersions?: string[];
  } = {}
) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ENV: options.githubEnv,
      GITHUB_OUTPUT: options.githubOutput,
      GITHUB_REPOSITORY: "jmclaughlin724/supaschema",
      GITHUB_SHA: options.githubSha ?? releaseCommit,
      SUPASCHEMA_RELEASE_GITHUB_RELEASE_EXISTS: String(options.githubReleaseExists ?? false),
      SUPASCHEMA_RELEASE_GITHUB_TAG_TARGET: options.githubTagTarget ?? "",
      SUPASCHEMA_RELEASE_NPM_VIEW_JSON: JSON.stringify(options.publishedVersions ?? []),
    },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }
});

describe("release preflight", () => {
  it("accepts a matching package version that is not released", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, { publishedVersions: ["1.2.2"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RELEASE_PREFLIGHT_OK supaschema@1.2.3 will publish to npm and create v1.2.3"
    );
  });

  it("writes GitHub Actions release-state flags", () => {
    const cwd = makeProject({});
    const githubEnv = join(cwd, "github-env");
    const githubOutput = join(cwd, "github-output");

    const result = runPreflight(cwd, {
      githubEnv,
      githubOutput,
      publishedVersions: ["1.2.2"],
    });

    expect(result.status).toBe(0);
    for (const file of [githubEnv, githubOutput]) {
      const contents = readFileSync(file, "utf8");
      expect(contents).toContain("SUPASCHEMA_PACKAGE_NAME=supaschema");
      expect(contents).toContain("SUPASCHEMA_PACKAGE_VERSION=1.2.3");
      expect(contents).toContain("SUPASCHEMA_RELEASE_TAG=v1.2.3");
      expect(contents).toContain("SUPASCHEMA_RELEASE_SHOULD_PUBLISH_NPM=true");
      expect(contents).toContain("SUPASCHEMA_RELEASE_SHOULD_CREATE_GITHUB_RELEASE=true");
    }
  });

  it("repairs a missing GitHub release after npm publish", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, { publishedVersions: ["1.2.2", "1.2.3"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RELEASE_PREFLIGHT_OK supaschema@1.2.3 is on npm; v1.2.3 will be created"
    );
  });

  it("accepts an already complete npm and GitHub release", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, {
      githubReleaseExists: true,
      publishedVersions: ["1.2.2", "1.2.3"],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RELEASE_PREFLIGHT_OK supaschema@1.2.3 and v1.2.3 are already released"
    );
  });

  it("rejects a GitHub release that exists before npm publish", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, { githubReleaseExists: true, publishedVersions: ["1.2.2"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "v1.2.3 already exists on GitHub but supaschema@1.2.3 is not on npm"
    );
  });

  it("rejects an existing GitHub tag that points to the wrong commit", () => {
    const cwd = makeProject({});

    const result = runPreflight(cwd, {
      githubTagTarget: "1111111111111111111111111111111111111111",
      publishedVersions: ["1.2.2", "1.2.3"],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("v1.2.3 points to 1111111111111111111111111111111111111111");
  });

  it("rejects a top-level package-lock version mismatch", () => {
    const cwd = makeProject({ lockVersion: "1.2.2" });

    const result = runPreflight(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package-lock.json version 1.2.2 does not match");
  });

  it("rejects a package-lock root package version mismatch", () => {
    const cwd = makeProject({ rootVersion: "1.2.2" });

    const result = runPreflight(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package-lock.json root package version 1.2.2 does not match");
  });
});
