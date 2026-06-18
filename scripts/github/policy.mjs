import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const POLICY_PATH = ".github/repo-policy.json";

export function readPolicy() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), "utf8"));
}

export function argValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function hasFlag(args, name) {
  return args.includes(name);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
  return result;
}

export function git(args, options = {}) {
  return run("git", args, options).stdout.trim();
}

export function ghJson(args, options = {}) {
  const result = run("gh", args, options);
  return JSON.parse(result.stdout);
}

export function repoFullName(policy = readPolicy()) {
  if (policy.repositoryFullName) {
    return policy.repositoryFullName;
  }

  const envRepo = process.env.GITHUB_REPOSITORY;
  if (envRepo?.includes("/")) {
    return envRepo;
  }

  const remote = git(["config", "--get", "remote.origin.url"]);
  const httpsPrefix = "https://github.com/";
  const sshPrefix = "git@github.com:";
  let value = remote;
  if (value.startsWith(httpsPrefix)) {
    value = value.slice(httpsPrefix.length);
  } else if (value.startsWith(sshPrefix)) {
    value = value.slice(sshPrefix.length);
  }
  if (value.endsWith(".git")) {
    value = value.slice(0, -4);
  }
  if (!value.includes("/")) {
    throw new Error(`cannot derive GitHub repository from origin URL: ${remote}`);
  }
  return value;
}

export function currentBranch() {
  return git(["branch", "--show-current"]);
}

export function defaultBase(policy = readPolicy()) {
  return policy.pullRequests?.base ?? policy.repository?.default_branch ?? "main";
}

export function requiredContexts(policy = readPolicy(), branch = defaultBase(policy)) {
  return policy.branches?.[branch]?.required_status_checks?.contexts ?? [];
}

export function reportFailures(failures, okToken) {
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${okToken}\n`);
}

export function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function setDifference(left, right) {
  const rightSet = new Set(right);
  return sorted(left.filter((value) => !rightSet.has(value)));
}

export function asEnabled(value) {
  if (value && typeof value === "object" && "enabled" in value) {
    return value.enabled;
  }
  return Boolean(value);
}

export function parsePrNumber(value) {
  if (!value) {
    return;
  }
  const marker = "/pull/";
  if (value.includes(marker)) {
    const tail = value.slice(value.indexOf(marker) + marker.length);
    return tail.split("/")[0].split("#")[0].split("?")[0];
  }
  return value;
}

export function successfulCheck(item) {
  const status = item?.status;
  const conclusion = item?.conclusion;
  if (status && status !== "COMPLETED") {
    return false;
  }
  return conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED";
}
