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
  if (process.env.SUPASCHEMA_FAKE_GH_POLICY) {
    return fakeGhJson(args, options);
  }
  const result = run("gh", args, options);
  return JSON.parse(result.stdout);
}

function fakeGhJson(args, options) {
  const policy = JSON.parse(process.env.SUPASCHEMA_FAKE_GH_POLICY);
  const log = process.env.SUPASCHEMA_FAKE_GH_LOG;
  const endpoint = args[1];
  const repo = policy.repositoryFullName;
  const methodIndex = args.indexOf("-X");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];

  if (endpoint === `repos/${repo}`) {
    return policy.repository;
  }
  if (endpoint === `repos/${repo}/topics` && method === "PUT") {
    const body = JSON.parse(options.input ?? "{}");
    if (log) {
      fs.appendFileSync(log, `${JSON.stringify({ body, endpoint, method })}\n`);
    }
    return { names: body.names };
  }
  if (endpoint === `repos/${repo}/topics`) {
    return {
      names:
        log && fs.existsSync(log) && fs.readFileSync(log, "utf8").includes('"method":"PUT"')
          ? policy.repositoryTopics
          : ["cli", "database", "idempotent-migrations", "migrations", "rls", "typescript"],
    };
  }
  if (endpoint === `repos/${repo}/actions/permissions`) {
    return policy.actions.permissions;
  }
  if (endpoint === `repos/${repo}/actions/permissions/workflow`) {
    return policy.actions.workflowPermissions;
  }
  if (endpoint === `repos/${repo}/actions/permissions/fork-pr-contributor-approval`) {
    return policy.actions.forkPullRequestContributorApproval;
  }
  if (endpoint === `repos/${repo}/branches/main/protection`) {
    const main = policy.branches.main;
    return {
      allow_deletions: { enabled: main.allow_deletions },
      allow_force_pushes: { enabled: main.allow_force_pushes },
      enforce_admins: { enabled: main.enforce_admins },
      required_conversation_resolution: { enabled: main.required_conversation_resolution },
      required_linear_history: { enabled: main.required_linear_history },
      required_pull_request_reviews: main.required_pull_request_reviews ?? null,
      required_signatures: { enabled: main.required_signatures },
      required_status_checks: main.required_status_checks
        ? {
            checks: main.required_status_checks.contexts.map((context) => ({
              app_id: main.required_status_checks.app_id,
              context,
            })),
            contexts: main.required_status_checks.contexts,
            strict: main.required_status_checks.strict,
          }
        : null,
    };
  }
  if (endpoint === `repos/${repo}/rulesets`) {
    return policy.rulesets.map((ruleset, index) => ({ id: index + 1, name: ruleset.name }));
  }
  if (endpoint === `repos/${repo}/rulesets/1`) {
    return policy.rulesets[0];
  }
  throw new Error(`unhandled fake gh endpoint ${endpoint}`);
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
