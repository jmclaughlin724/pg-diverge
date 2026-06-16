#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  console.error(`RELEASE_PREFLIGHT_FAILED ${message}`);
  process.exit(1);
}

function normalizeVersions(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string");
  }
  if (typeof raw === "string") {
    return raw.length === 0 ? [] : [raw];
  }
  return [];
}

function npmViewVersions(packageName) {
  if (process.env.SUPASCHEMA_RELEASE_NPM_VIEW_JSON) {
    return normalizeVersions(JSON.parse(process.env.SUPASCHEMA_RELEASE_NPM_VIEW_JSON));
  }

  try {
    const output = execFileSync("npm", ["view", packageName, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return normalizeVersions(JSON.parse(output.trim() || "[]"));
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (stderr.includes("E404") || stderr.includes("404 Not Found")) {
      return [];
    }
    throw error;
  }
}

const root = process.cwd();
const packageJson = readJson(join(root, "package.json"));
const packageLock = readJson(join(root, "package-lock.json"));

const name = packageJson.name;
const version = packageJson.version;
if (typeof name !== "string" || name.length === 0) {
  fail("package.json must include a package name before release");
}
if (typeof version !== "string" || version.length === 0) {
  fail("package.json must include a package version before release");
}

if (packageLock.version !== version) {
  fail(`package-lock.json version ${packageLock.version} does not match package.json ${version}`);
}
if (packageLock.packages?.[""]?.version !== version) {
  fail(
    `package-lock.json root package version ${packageLock.packages?.[""]?.version} does not match package.json ${version}`
  );
}

const published = npmViewVersions(name);
if (published.includes(version)) {
  fail(`${name}@${version} already exists on npm; bump the version before merging to main`);
}

console.log(`RELEASE_PREFLIGHT_OK ${name}@${version} is unpublished`);
