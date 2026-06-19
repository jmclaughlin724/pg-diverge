import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { handleAgentHookEvent } from "../scripts/agent-hooks/runner.mjs";
import {
  ciFailureInboxContext,
  parseCiFailureReportComment,
  renderCiFailureReport,
} from "../scripts/github/ci-inbox-core.mjs";

const headSha = "0123456789abcdef0123456789abcdef01234567";

function report() {
  return {
    conclusion: "failure",
    headBranch: "codex/ci-failure-inbox",
    headSha,
    jobs: [
      {
        annotations: [{ message: "expected exit status 0, got 1", path: "tests/example.test.ts" }],
        conclusion: "failure",
        id: 123,
        logExcerpt: ["AssertionError: expected 1 to be 0"],
        name: "quality (22)",
        steps: [{ conclusion: "failure", name: "Guard suite" }],
        url: "https://github.com/jmclaughlin724/supaschema/actions/runs/1/job/2",
      },
    ],
    pullRequestNumber: 53,
    reportedAt: "2026-06-19T16:00:00.000Z",
    repository: "jmclaughlin724/supaschema",
    workflowName: "CI",
    workflowRunId: 1,
    workflowRunUrl: "https://github.com/jmclaughlin724/supaschema/actions/runs/1",
  };
}

function fakeEnv(stateDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SUPASCHEMA_CI_INBOX_BRANCH: "codex/ci-failure-inbox",
    SUPASCHEMA_CI_INBOX_FORCE: "1",
    SUPASCHEMA_CI_INBOX_HEAD_SHA: headSha,
    SUPASCHEMA_CI_INBOX_STATE_DIR: stateDir,
    SUPASCHEMA_FAKE_CI_INBOX_REPORT: JSON.stringify(report()),
    ...extra,
  };
}

describe("GitHub CI failure inbox", () => {
  it("round-trips a failure report through the PR marker comment", () => {
    const body = renderCiFailureReport(report());

    expect(body).toContain("<!-- supaschema:ci-failure-report -->");
    expect(body).toContain("quality (22)");
    expect(body).toContain("Guard suite");
    expect(parseCiFailureReportComment(body)).toMatchObject({
      headSha,
      jobs: [expect.objectContaining({ name: "quality (22)" })],
      workflowRunId: 1,
    });
  });

  it("emits a report once per runtime and head", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-state-"));
    const env = fakeEnv(stateDir);

    const first = ciFailureInboxContext({ env, now: 1000, runtime: "claude" });
    const second = ciFailureInboxContext({ env, now: 2000, runtime: "claude" });
    const codex = ciFailureInboxContext({ env, now: 3000, runtime: "codex" });

    expect(first).toContain("GitHub CI failure report");
    expect(first).toContain("quality (22)");
    expect(first).toContain("Guard suite");
    expect(second).toBeUndefined();
    expect(codex).toContain("GitHub CI failure report");
  });

  it("surfaces the inbox through the Claude prompt hook runner", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-claude-"));
    const original = { ...process.env };
    Object.assign(process.env, fakeEnv(stateDir));
    try {
      const result = handleAgentHookEvent(
        "UserPromptSubmit",
        { prompt: "continue", session_id: "ci-inbox-claude" },
        { root: process.cwd(), runtime: "claude" }
      );

      expect(result.output.hookSpecificOutput?.additionalContext).toContain(
        "GitHub CI failure report"
      );
    } finally {
      process.env = original;
    }
  });

  it("surfaces the inbox through the Codex repo-local hook without blocking", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-codex-"));
    const result = spawnSync(
      process.execPath,
      ["scripts/github/ci-inbox.mjs", "--runtime", "codex", "--event", "PreToolUse"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: fakeEnv(stateDir),
      }
    );
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output.hookSpecificOutput?.additionalContext).toContain("GitHub CI failure report");
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
});
