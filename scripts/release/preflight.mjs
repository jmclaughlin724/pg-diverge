#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractChangelogEntry } from "./changelog-notes.mjs";

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

function envBoolean(name) {
  const value = process.env[name];
  if (value === undefined) {
    return;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  fail(`${name} must be one of true, false, 1, or 0`);
}

function repositorySlug(packageJson) {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const repository =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;
  if (typeof repository === "string") {
    const slug = githubRepositoryFromUrl(repository);
    if (slug !== undefined) {
      return slug;
    }
  }

  fail("GITHUB_REPOSITORY or package.json repository.url is required for release preflight");
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

function githubReleaseExists(repo, tag) {
  const mocked = envBoolean("SUPASCHEMA_RELEASE_GITHUB_RELEASE_EXISTS");
  if (mocked !== undefined) {
    return mocked;
  }

  try {
    execFileSync("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (stderr.includes("release not found") || stderr.includes("Not Found")) {
      return false;
    }
    throw error;
  }
}

function githubTagTarget(tag) {
  if (process.env.SUPASCHEMA_RELEASE_GITHUB_TAG_TARGET !== undefined) {
    const value = process.env.SUPASCHEMA_RELEASE_GITHUB_TAG_TARGET;
    if (value.length === 0) {
      return;
    }
    return value;
  }

  try {
    const output = execFileSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}*`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
    const exact = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
    const selected = peeled ?? exact;
    return selected === undefined ? undefined : firstWhitespaceToken(selected);
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : undefined;
    const stderr = error?.stderr?.toString?.() ?? "";
    if (status === 2 || stderr.includes("not found") || stderr.length === 0) {
      return;
    }
    throw error;
  }
}

function githubRepositoryFromUrl(value) {
  const marker = "github.com";
  const markerIndex = value.lastIndexOf(marker);
  if (markerIndex === -1) {
    return;
  }
  let slug = value.slice(markerIndex + marker.length);
  if (slug.startsWith(":") || slug.startsWith("/")) {
    slug = slug.slice(1);
  }
  if (slug.endsWith(".git")) {
    slug = slug.slice(0, -4);
  }
  const parts = slug.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts.slice(1).join("/")}` : undefined;
}

function firstWhitespaceToken(value) {
  let token = "";
  for (const char of value.trim()) {
    if (isWhitespace(char)) {
      break;
    }
    token += char;
  }
  return token.length > 0 ? token : undefined;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function writeActionsValue(file, key, value) {
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

function exposeReleaseState(state) {
  const entries = {
    SUPASCHEMA_PACKAGE_NAME: state.name,
    SUPASCHEMA_PACKAGE_VERSION: state.version,
    SUPASCHEMA_RELEASE_ALREADY_COMPLETE: state.alreadyComplete,
    SUPASCHEMA_RELEASE_GITHUB_RELEASE_EXISTS: state.githubReleaseExists,
    SUPASCHEMA_RELEASE_NPM_PUBLISHED: state.npmPublished,
    SUPASCHEMA_RELEASE_SHOULD_CREATE_GITHUB_RELEASE: state.shouldCreateGithubRelease,
    SUPASCHEMA_RELEASE_SHOULD_PUBLISH_NPM: state.shouldPublishNpm,
    SUPASCHEMA_RELEASE_TAG: state.tag,
  };

  for (const [key, value] of Object.entries(entries)) {
    writeActionsValue(process.env.GITHUB_ENV, key, value);
    writeActionsValue(process.env.GITHUB_OUTPUT, key, value);
  }
}

const root = process.cwd();
const packageJson = readJson(join(root, "package.json"));
const packageLock = readJson(join(root, "package-lock.json"));
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const name = packageJson.name;
const version = packageJson.version;
const tag = `v${version}`;
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
try {
  extractChangelogEntry(changelog, version);
} catch (error) {
  fail(error.message);
}

const published = npmViewVersions(name);
const npmPublished = published.includes(version);
const repo = repositorySlug(packageJson);
const releaseExists = githubReleaseExists(repo, tag);
const tagTarget = githubTagTarget(tag);
const targetSha = process.env.GITHUB_SHA;

if (releaseExists && !npmPublished) {
  fail(
    `${tag} already exists on GitHub but ${name}@${version} is not on npm; fix the inconsistent release before rerunning`
  );
}

if (!releaseExists && tagTarget !== undefined) {
  if (!targetSha) {
    fail(`${tag} exists on GitHub but GITHUB_SHA is unavailable for target validation`);
  }
  if (tagTarget !== targetSha) {
    fail(`${tag} points to ${tagTarget}, not the release commit ${targetSha}`);
  }
}

const shouldPublishNpm = !npmPublished;
const shouldCreateGithubRelease = !releaseExists;
const alreadyComplete = npmPublished && releaseExists;

exposeReleaseState({
  alreadyComplete,
  githubReleaseExists: releaseExists,
  name,
  npmPublished,
  shouldCreateGithubRelease,
  shouldPublishNpm,
  tag,
  version,
});

if (alreadyComplete) {
  console.log(`RELEASE_PREFLIGHT_OK ${name}@${version} and ${tag} are already released`);
} else if (npmPublished) {
  console.log(`RELEASE_PREFLIGHT_OK ${name}@${version} is on npm; ${tag} will be created`);
} else {
  console.log(`RELEASE_PREFLIGHT_OK ${name}@${version} will publish to npm and create ${tag}`);
}
