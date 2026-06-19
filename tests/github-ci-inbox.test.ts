import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ciFailureInboxContext,
  parseCiFailureReportComment,
  renderCiFailureReport,
  reportFromWorkflowRunEvent,
  syncCiFailureComment,
} from "../scripts/github/ci-inbox-core.mjs";

const headSha = "0123456789abcdef0123456789abcdef01234567";
const hasAgentHookRunner = existsSync(join(process.cwd(), "scripts/agent-hooks/runner.mjs"));

function optionalImport(specifier: string): Promise<any> {
  return import(specifier);
}

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

function markerComment(value: unknown, login = "github-actions[bot]", id = 1) {
  return { body: renderCiFailureReport(value), id, user: { login } };
}

function workflowRunEvent(conclusion: string) {
  return {
    repository: { full_name: "jmclaughlin724/supaschema" },
    workflow_run: {
      conclusion,
      head_branch: "codex/ci-failure-inbox",
      head_sha: headSha,
      html_url: "https://github.com/jmclaughlin724/supaschema/actions/runs/1",
      id: 1,
      name: "CI",
      pull_requests: [{ number: 53 }],
    },
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

function fakeLivePrEnv(stateDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GITHUB_REPOSITORY: "jmclaughlin724/supaschema",
    SUPASCHEMA_CI_INBOX_BRANCH: "codex/ci-failure-inbox",
    SUPASCHEMA_CI_INBOX_FORCE: "1",
    SUPASCHEMA_CI_INBOX_HEAD_SHA: headSha,
    SUPASCHEMA_CI_INBOX_STATE_DIR: stateDir,
    SUPASCHEMA_FAKE_CI_INBOX_COMMENTS: "[]",
    SUPASCHEMA_FAKE_CI_INBOX_PR: JSON.stringify({
      headRefName: "codex/ci-failure-inbox",
      headRefOid: headSha,
      number: 53,
      statusCheckRollup: [
        {
          conclusion: "FAILURE",
          detailsUrl: "https://github.com/jmclaughlin724/supaschema/actions/runs/99/job/100",
          name: "quality (22)",
          status: "COMPLETED",
          workflowName: "CI",
        },
      ],
      url: "https://github.com/jmclaughlin724/supaschema/pull/53",
    }),
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

  it("falls back to live PR check failures when the marker comment is missing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-live-pr-"));
    const context = ciFailureInboxContext({
      env: fakeLivePrEnv(stateDir),
      now: 1000,
      runtime: "codex",
    });

    expect(context).toContain("GitHub CI failure report");
    expect(context).toContain("GitHub checks");
    expect(context).toContain("quality (22)");
  });

  it("falls back to live PR checks when the marker comment is stale", () => {
    const stale = {
      ...report(),
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      jobs: [{ ...report().jobs[0], name: "stale quality" }],
      workflowRunId: 9,
    };
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-stale-pr-"));
    const context = ciFailureInboxContext({
      env: fakeLivePrEnv(stateDir, {
        SUPASCHEMA_FAKE_CI_INBOX_COMMENTS: JSON.stringify([markerComment(stale)]),
      }),
      now: 1000,
      runtime: "codex",
    });

    expect(context).toContain("quality (22)");
    expect(context).not.toContain("stale quality");
  });

  it("ignores untrusted marker comments before falling back to live PR checks", () => {
    const forged = {
      ...report(),
      jobs: [{ ...report().jobs[0], name: "forged quality" }],
      workflowRunId: 10,
    };
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-untrusted-pr-"));
    const context = ciFailureInboxContext({
      env: fakeLivePrEnv(stateDir, {
        SUPASCHEMA_FAKE_CI_INBOX_COMMENTS: JSON.stringify([markerComment(forged, "octocat")]),
      }),
      now: 1000,
      runtime: "codex",
    });

    expect(context).toContain("quality (22)");
    expect(context).not.toContain("forged quality");
  });

  it("surfaces current-head failure reports when job details are unavailable", () => {
    const noDetails = {
      ...report(),
      conclusion: "startup_failure",
      jobs: [],
      workflowRunId: 11,
    };
    const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-no-details-"));
    const context = ciFailureInboxContext({
      env: fakeLivePrEnv(stateDir, {
        SUPASCHEMA_FAKE_CI_INBOX_COMMENTS: JSON.stringify([markerComment(noDetails)]),
      }),
      now: 1000,
      runtime: "codex",
    });

    expect(context).toContain("GitHub CI failure report");
    expect(context).toContain("no failed job details were available");
  });

  it("skips stale workflow-run reports before mutating the marker comment", () => {
    const calls: string[][] = [];
    const result = syncCiFailureComment(
      { ...report(), headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      {
        comments: [markerComment(report())],
        currentHeadSha: headSha,
        ghJson: (args: string[]) => {
          calls.push(args);
          return {};
        },
      }
    );

    expect(result).toEqual({ action: "skipped-stale-head" });
    expect(calls).toEqual([]);
  });

  it("deletes the current-head marker comment after a successful workflow rerun", () => {
    const calls: string[][] = [];
    const success = reportFromWorkflowRunEvent(workflowRunEvent("success"));
    const result = syncCiFailureComment(success, {
      comments: [markerComment(report(), "github-actions[bot]", 77)],
      currentHeadSha: headSha,
      ghJson: (args: string[]) => {
        calls.push(args);
        return {};
      },
    });

    expect(result).toEqual({ action: "deleted", commentId: 77 });
    const deleteCall = calls[0] ?? [];
    expect(deleteCall).toContain("DELETE");
    expect(deleteCall).toContain("repos/jmclaughlin724/supaschema/issues/comments/77");
  });

  it.skipIf(!hasAgentHookRunner)(
    "surfaces the inbox through the Claude prompt hook runner",
    async () => {
      const { handleAgentHookEvent } = await optionalImport("../scripts/agent-hooks/runner.mjs");
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
    }
  );

  it("surfaces the inbox through the standalone Codex CI hook without blocking", () => {
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

  it.skipIf(!hasAgentHookRunner)(
    "surfaces the inbox through the consolidated Codex PreToolUse runner without blocking",
    async () => {
      const { handleAgentHookEvent } = await optionalImport("../scripts/agent-hooks/runner.mjs");
      const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-codex-runner-"));
      const original = { ...process.env };
      Object.assign(process.env, fakeEnv(stateDir));
      try {
        const result = handleAgentHookEvent(
          "PreToolUse",
          {
            hook_event_name: "PreToolUse",
            session_id: "ci-inbox-codex-runner",
            tool_input: { command: "git status --short" },
            tool_name: "Bash",
            turn_id: "t1",
          },
          { root: process.cwd(), runtime: "codex" }
        );
        const output = JSON.parse(result.stdout);

        expect(output.hookSpecificOutput?.additionalContext).toContain("GitHub CI failure report");
        expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      } finally {
        process.env = original;
      }
    }
  );

  it.skipIf(!hasAgentHookRunner)(
    "blocks Codex green claims while live PR checks are failing without a marker comment",
    async () => {
      const { handleAgentHookEvent } = await optionalImport("../scripts/agent-hooks/runner.mjs");
      const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-codex-stop-"));
      const original = { ...process.env };
      Object.assign(process.env, fakeLivePrEnv(stateDir));
      try {
        const result = handleAgentHookEvent(
          "Stop",
          {
            last_assistant_message: "The GitHub checks are verified and green.",
            session_id: "ci-inbox-codex-stop",
            turn_id: "t1",
          },
          { root: process.cwd(), runtime: "codex" }
        );
        const output = JSON.parse(result.stdout);

        expect(output.decision).toBe("block");
        expect(output.reason).toContain("github-checks");
      } finally {
        process.env = original;
      }
    }
  );

  it.skipIf(!hasAgentHookRunner)(
    "allows Codex closeout that reports live PR checks as a blocker",
    async () => {
      const { handleAgentHookEvent } = await optionalImport("../scripts/agent-hooks/runner.mjs");
      const stateDir = mkdtempSync(join(tmpdir(), "supa-ci-inbox-codex-blocker-"));
      const original = { ...process.env };
      Object.assign(process.env, fakeLivePrEnv(stateDir));
      try {
        const result = handleAgentHookEvent(
          "Stop",
          {
            last_assistant_message:
              "GitHub checks are failing: quality (22). Remaining blocker: fix the failing CI job.",
            session_id: "ci-inbox-codex-blocker",
            turn_id: "t1",
          },
          { root: process.cwd(), runtime: "codex" }
        );
        const output = JSON.parse(result.stdout);

        expect(output.decision).toBeUndefined();
        expect(output.hookSpecificOutput?.additionalContext).toContain("quality (22)");
      } finally {
        process.env = original;
      }
    }
  );
});
