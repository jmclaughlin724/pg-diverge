import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claimWithoutEvidence,
  completionClaimWithOpenItems,
  decisionMenuAfterDirective,
  deferralLanguage,
  hedgeDensity,
  toolFailureWithoutRetry,
} from "../scripts/agent-hooks/detectors.mjs";
import { runChecks, shapeHookResult } from "../scripts/agent-hooks/payload.mjs";
import { handleAgentHookEvent } from "../scripts/agent-hooks/runner.mjs";
import { readSessionState } from "../scripts/agent-hooks/state.mjs";

describe("agent hook payload mapping", () => {
  it("pins model-context output shapes by event", () => {
    for (const eventName of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "SubagentStart",
      "Stop",
      "SubagentStop",
    ]) {
      expect(shapeHookResult(eventName, { contextParts: ["ctx"] }, "claude").output).toMatchObject({
        hookSpecificOutput: {
          additionalContext: "ctx",
          hookEventName: eventName,
        },
      });
    }
  });

  it("pins blocking and denial shapes by event", () => {
    expect(shapeHookResult("PreToolUse", { deny: "no" }, "claude").output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "no",
      },
    });
    expect(shapeHookResult("Stop", { block: "continue" }, "claude").output).toMatchObject({
      decision: "block",
      reason: "continue",
    });
    expect(shapeHookResult("TaskCompleted", { block: "not done" }, "claude")).toMatchObject({
      exitCode: 2,
      stderr: "not done",
    });
    expect(shapeHookResult("SessionEnd", {}, "claude").stdout).toBe("");
    expect(shapeHookResult("Stop", {}, "codex").stdout).toBe("{}\n");
  });

  it("formats thrown checks as fail-closed hook feedback", () => {
    const result = runChecks("PreToolUse", {}, [
      function explodingCheck() {
        throw new Error("boom");
      },
    ]);
    const shaped = shapeHookResult("PreToolUse", result, "claude").output as {
      hookSpecificOutput?: { permissionDecisionReason?: string };
    };

    expect(shaped.hookSpecificOutput?.permissionDecisionReason).toContain(
      "Agent hook failed closed."
    );
    expect(shaped.hookSpecificOutput?.permissionDecisionReason).toContain("check=explodingCheck");
    expect(shaped.hookSpecificOutput?.permissionDecisionReason).toContain("error=boom");
  });
});

describe("agent hook skill matcher state", () => {
  it("keeps leading-slash skill prompts pending until an observable load", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "/code-atlas map scripts", session_id: "slash-session" };

    const prompt = handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    expect(prompt.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        additionalContext: expect.stringContaining("Load code-atlas"),
      }),
    });
    expect(readSessionState(payload).pendingSkills).toHaveProperty("code-atlas");

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "slash-session",
        tool_input: { file_path: "scripts/guards/check-agent-hooks.mjs" },
        tool_name: "Edit",
      },
      { root, runtime: "claude" }
    );
    expect(blocked.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("observably loaded"),
      }),
    });
  });

  it("clears pending only after a Skill tool load or SKILL.md read", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "clear-session" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    expect(readSessionState(payload).pendingSkills).toHaveProperty("code-atlas");

    handleAgentHookEvent(
      "PostToolUse",
      { session_id: "clear-session", tool_input: { name: "code-atlas" }, tool_name: "Skill" },
      { root, runtime: "claude" }
    );
    expect(readSessionState(payload).pendingSkills).not.toHaveProperty("code-atlas");

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "clear-session",
        tool_input: { file_path: join(root, ".claude/skills/code-atlas/SKILL.md") },
        tool_name: "Read",
      },
      { root, runtime: "claude" }
    );
    expect(readSessionState(payload).pendingSkills).not.toHaveProperty("code-atlas");
  });

  it("does not clear mid-prompt skill tokens without an observable load", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "please use $code-atlas after checking scripts", session_id: "mid" };

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    expect(readSessionState(payload).pendingSkills).toHaveProperty("code-atlas");
    expect(readSessionState(payload).invokedSkills).not.toHaveProperty("code-atlas");
  });
});

describe("agent hook response detectors", () => {
  it("detects hedge density without flagging decisive verified text", () => {
    expect(
      hedgeDensity(
        "Maybe this probably could work and might likely pass once the possible missing setup is present."
      )
    ).toMatchObject({ id: "hedge-density" });
    expect(hedgeDensity("The guard passed with the recorded command output.")).toBeUndefined();
  });

  it("detects completion claims with open items", () => {
    expect(
      completionClaimWithOpenItems(
        "Done.",
        { background_tasks: [{ id: "t1" }] },
        { invokedSkills: {}, pendingSkills: {} }
      )
    ).toMatchObject({ id: "completion-claim-with-open-items" });
    expect(
      completionClaimWithOpenItems(
        "Done.",
        { background_tasks: [] },
        {
          invokedSkills: {},
          pendingSkills: {},
        }
      )
    ).toBeUndefined();
  });

  it("detects verification claims without evidence", () => {
    expect(claimWithoutEvidence("Verified and clean.", { evidence: [] }, [])).toMatchObject({
      id: "claim-without-evidence",
    });
    expect(
      claimWithoutEvidence("Verified and clean.", { evidence: [{ kind: "verified-command" }] }, [])
    ).toBeUndefined();
  });

  it("detects decision menus after direct directives", () => {
    expect(
      decisionMenuAfterDirective("Option 1 is safer, choose one.", { lastPrompt: "implement it" })
    ).toMatchObject({ id: "decision-menu-after-directive" });
    expect(
      decisionMenuAfterDirective("I implemented it.", { lastPrompt: "what are options?" })
    ).toBeUndefined();
  });

  it("detects deferral language and unresolved tool failures", () => {
    expect(deferralLanguage("If you want, I can run tests next.")).toMatchObject({
      id: "deferral-language",
    });
    expect(
      deferralLanguage("Tests failed; the next step is to fix src/config.ts.")
    ).toBeUndefined();
    expect(
      toolFailureWithoutRetry({
        evidence: [{ at: "2026-06-15T00:00:00.000Z", kind: "failed-command" }],
      })
    ).toMatchObject({ id: "tool-failure-without-retry" });
    expect(
      toolFailureWithoutRetry({
        evidence: [
          { at: "2026-06-15T00:00:00.000Z", kind: "failed-command" },
          { at: "2026-06-15T00:01:00.000Z", kind: "verified-command" },
        ],
      })
    ).toBeUndefined();
  });
});

async function seededHookRoot(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "supa-agent-hook-core-"));
  const stateDir = join(root, ".state");
  await write(
    root,
    ".claude/skills/code-atlas/SKILL.md",
    `---
name: code-atlas
description: Build and query the local Code Atlas.
metadata:
  keywords:
    - code-atlas
    - scripts
  file-triggers:
    - scripts/guards/**
---

# Code Atlas
`
  );
  return { root, stateDir };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}
