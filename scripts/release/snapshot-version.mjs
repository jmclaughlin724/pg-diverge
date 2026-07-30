#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function computeSnapshotVersion(baseVersion, sha) {
  const parts = baseVersion.split(".");
  const isStable =
    parts.length === 3 && parts.every((part) => part.length > 0 && [...part].every(isDigit));
  if (!isStable) {
    throw new Error(`snapshot versions require a stable X.Y.Z base version, found ${baseVersion}`);
  }
  const [major, minor, patch] = parts.map(Number);
  return `${major}.${minor}.${patch + 1}-dev.${sha}`;
}

export function stampVersion(packageJson, packageJsonPath, lockfilePath, version) {
  packageJson.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
  lockfile.version = version;
  if (lockfile.packages !== undefined && lockfile.packages[""] !== undefined) {
    lockfile.packages[""].version = version;
  }
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function main() {
  const ROOT = process.cwd();
  const packageJsonPath = join(ROOT, "package.json");
  const lockfilePath = join(ROOT, "package-lock.json");

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const version = computeSnapshotVersion(packageJson.version, sha);
  const spec = `${packageJson.name}@${version}`;

  let published = false;
  try {
    published =
      execFileSync("npm", ["view", spec, "version"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === version;
  } catch {
    published = false;
  }

  stampVersion(packageJson, packageJsonPath, lockfilePath, version);

  console.log(`version=${version}`);
  console.log(`published=${published}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
