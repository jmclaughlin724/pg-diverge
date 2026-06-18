import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/github/audit-settings.mjs");
const policy = JSON.parse(readFileSync(resolve(".github/repo-policy.json"), "utf8"));
const repo = policy.repositoryFullName;

function runAudit(options: { approved?: boolean; apply?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "supa-github-audit-"));
  const log = join(dir, "gh.log");
  installFakeGh(dir);
  const result = spawnSync(
    process.execPath,
    [script, ...(options.apply === true ? ["--apply-topics"] : [])],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY_TOPICS_APPROVED: options.approved === true ? "1" : undefined,
        PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
        SUPASCHEMA_FAKE_GH_LOG: log,
        SUPASCHEMA_FAKE_GH_POLICY: JSON.stringify(policy),
      },
    }
  );
  const calls = readCalls(log);
  return { calls, result };
}

function installFakeGh(dir: string): void {
  const fakeGh = join(dir, "gh.mjs");
  writeFileSync(fakeGh, fakeGhSource());
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh\nexec ${shQuote(process.execPath)} ${shQuote(fakeGh)} "$@"\n`,
    { mode: 0o755 }
  );
  writeFileSync(join(dir, "gh.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0gh.mjs" %*\r\n`);
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readCalls(file: string): unknown[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function fakeGhSource(): string {
  return `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const policy = JSON.parse(process.env.SUPASCHEMA_FAKE_GH_POLICY);
const log = process.env.SUPASCHEMA_FAKE_GH_LOG;
const args = process.argv.slice(2);
const endpoint = args[1];
const repo = policy.repositoryFullName;
const methodIndex = args.indexOf("-X");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];

function send(value) {
  process.stdout.write(JSON.stringify(value));
}

function loggedPut() {
  if (!log || !existsSync(log)) {
    return false;
  }
  return readFileSync(log, "utf8").includes('"method":"PUT"');
}

if (endpoint === \`repos/\${repo}\`) {
  send(policy.repository);
} else if (endpoint === \`repos/\${repo}/topics\` && method === "PUT") {
  const body = JSON.parse(readFileSync(0, "utf8"));
  appendFileSync(log, \`\${JSON.stringify({ body, endpoint, method })}\\n\`);
  send({ names: body.names });
} else if (endpoint === \`repos/\${repo}/topics\`) {
  send({
    names: loggedPut()
      ? policy.repositoryTopics
      : ["cli", "database", "idempotent-migrations", "migrations", "rls", "typescript"],
  });
} else if (endpoint === \`repos/\${repo}/actions/permissions\`) {
  send(policy.actions.permissions);
} else if (endpoint === \`repos/\${repo}/actions/permissions/workflow\`) {
  send(policy.actions.workflowPermissions);
} else if (endpoint === \`repos/\${repo}/actions/permissions/fork-pr-contributor-approval\`) {
  send(policy.actions.forkPullRequestContributorApproval);
} else if (endpoint === \`repos/\${repo}/branches/main/protection\`) {
  const main = policy.branches.main;
  send({
    allow_deletions: { enabled: main.allow_deletions },
    allow_force_pushes: { enabled: main.allow_force_pushes },
    enforce_admins: { enabled: main.enforce_admins },
    required_conversation_resolution: { enabled: main.required_conversation_resolution },
    required_linear_history: { enabled: main.required_linear_history },
    required_signatures: { enabled: main.required_signatures },
    required_pull_request_reviews: main.required_pull_request_reviews,
    required_status_checks: {
      checks: main.required_status_checks.contexts.map((context) => ({
        app_id: main.required_status_checks.app_id,
        context,
      })),
      contexts: main.required_status_checks.contexts,
      strict: main.required_status_checks.strict,
    },
  });
} else if (endpoint === \`repos/\${repo}/rulesets\`) {
  send(policy.rulesets.map((ruleset, index) => ({ id: index + 1, name: ruleset.name })));
} else if (endpoint === \`repos/\${repo}/rulesets/1\`) {
  send(policy.rulesets[0]);
} else {
  process.stderr.write(\`unhandled endpoint \${endpoint}\\n\`);
  process.exit(1);
}
`;
}

describe("GitHub settings audit", () => {
  it("refuses topic apply without approval", () => {
    const { calls, result } = runAudit({ apply: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--apply-topics requires GITHUB_REPOSITORY_TOPICS_APPROVED=1");
    expect(calls).toEqual([]);
  });

  it("replaces topics after explicit approval", () => {
    const { calls, result } = runAudit({ apply: true, approved: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GITHUB_SETTINGS_APPLY_OK");
    expect(calls).toEqual([
      {
        body: { names: policy.repositoryTopics },
        endpoint: `repos/${repo}/topics`,
        method: "PUT",
      },
    ]);
  });
});
