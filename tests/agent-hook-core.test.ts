import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const hasAgentHookSources = [
  "scripts/agent-hooks/detectors.mjs",
  "scripts/agent-hooks/payload.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/state.mjs",
].every((file) => existsSync(join(process.cwd(), file)));
let claimWithoutEvidence: any;
let completionClaimWithOpenItems: any;
let decisionMenuAfterDirective: any;
let deferralLanguage: any;
let hedgeDensity: any;
let mechanismClaimWithoutArchitecture: any;
let toolFailureWithoutRetry: any;
let runChecks: any;
let shapeHookResult: any;
let handleAgentHookEvent: any;
let currentTurnState: any;
let normalizeState: any;
let readSessionState: any;

function optionalImport(specifier: string): Promise<any> {
  return import(specifier);
}

if (hasAgentHookSources) {
  ({
    claimWithoutEvidence,
    completionClaimWithOpenItems,
    decisionMenuAfterDirective,
    deferralLanguage,
    hedgeDensity,
    mechanismClaimWithoutArchitecture,
    toolFailureWithoutRetry,
  } = await optionalImport("../scripts/agent-hooks/detectors.mjs"));
  ({ runChecks, shapeHookResult } = await optionalImport("../scripts/agent-hooks/payload.mjs"));
  ({ handleAgentHookEvent } = await optionalImport("../scripts/agent-hooks/runner.mjs"));
  ({ currentTurnState, normalizeState, readSessionState } = await optionalImport(
    "../scripts/agent-hooks/state.mjs"
  ));
}

interface HookFeedback {
  permissionDecisionReason?: string;
}

function hookFeedback(value: unknown): HookFeedback {
  if (!(isRecord(value) && isRecord(value.hookSpecificOutput))) {
    return {};
  }
  return {
    permissionDecisionReason: stringValue(value.hookSpecificOutput.permissionDecisionReason),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

describe.skipIf(!hasAgentHookSources)("agent hook payload mapping", () => {
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
    const shaped = hookFeedback(shapeHookResult("PreToolUse", result, "claude").output);

    expect(shaped.permissionDecisionReason).toContain("Agent hook failed closed.");
    expect(shaped.permissionDecisionReason).toContain("check=explodingCheck");
    expect(shaped.permissionDecisionReason).toContain("error=boom");
  });
});

describe.skipIf(!hasAgentHookSources)("agent hook skill matcher state", () => {
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
    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");

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
        permissionDecisionReason: expect.stringContaining("not an observable skill load"),
      }),
    });
  });

  it("blocks functions.apply_patch edits while a required skill is pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "apply-patch-pending" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "apply-patch-pending",
        tool_input: {
          patch: "*** Begin Patch\n*** Update File: src/cli.ts\n@@\n export {}\n*** End Patch\n",
        },
        tool_name: "functions.apply_patch",
      },
      { root, runtime: "codex" }
    );

    expect(blocked.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("not an observable skill load"),
      }),
    });
  });

  it("clears pending only after a Skill tool load or SKILL.md read", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "clear-session" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");

    handleAgentHookEvent(
      "PostToolUse",
      { session_id: "clear-session", tool_input: { name: "code-atlas" }, tool_name: "Skill" },
      { root, runtime: "claude" }
    );
    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );

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
    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
  });

  it("allows the first observable skill load before blocking governed work", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "load-first" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const unrelatedRead = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "load-first",
        tool_input: {
          cmd: "sed -n '1,120p' README.md",
        },
        tool_name: "functions.exec_command",
      },
      { root, runtime: "codex" }
    );

    expect(unrelatedRead.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("not an observable skill load"),
      }),
    });

    const skillRead = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "load-first",
        tool_input: {
          cmd: "sed -n '1,120p' .agents/skills/code-atlas/SKILL.md",
        },
        tool_name: "functions.exec_command",
      },
      { root, runtime: "codex" }
    );

    expect(skillRead.output.hookSpecificOutput?.permissionDecision).toBeUndefined();

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "load-first",
        tool_input: { file_path: "src/cli.ts" },
        tool_name: "Edit",
      },
      { root, runtime: "codex" }
    );

    expect(blocked.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("not an observable skill load"),
      }),
    });
  });

  it("allows Code Atlas evidence acquisition while skills are pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "atlas-first" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const atlasQuery = {
      session_id: "atlas-first",
      tool_input: {
        cmd: "npm run code-atlas:query -- pre-edit scripts/guards/check-agent-hooks.mjs --json",
      },
      tool_name: "functions.exec_command",
    };
    const allowed = handleAgentHookEvent("PreToolUse", atlasQuery, { root, runtime: "codex" });
    expect(allowed.output.hookSpecificOutput?.permissionDecision).toBeUndefined();

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...atlasQuery,
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");
    expect(currentTurnState(readSessionState(payload)).evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "code-atlas-query",
          outcome: "success",
          queryKind: "pre-edit",
          value: "scripts/guards/check-agent-hooks.mjs",
        }),
      ])
    );
  });

  it("does not emit advisory context for already loaded tool-triggered skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "quiet-loaded-skill" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "quiet-loaded-skill",
        tool_input: { name: "code-atlas" },
        tool_name: "Skill",
      },
      { root, runtime: "claude" }
    );

    const allowed = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "quiet-loaded-skill",
        tool_input: { file_path: "scripts/guards/check-agent-hooks.mjs" },
        tool_name: "Edit",
      },
      { root, runtime: "claude" }
    );

    expect(allowed.output.hookSpecificOutput).toBeUndefined();
    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
  });

  it("does not clear mid-prompt skill tokens without an observable load", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "please use $code-atlas after checking scripts", session_id: "mid" };

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");
    expect(readSessionState(payload).invokedSkills).not.toHaveProperty("code-atlas");
  });

  it("keeps generic hook prose from loading unrelated skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt:
        "there should not be this much noise around hooks enforcers, what else needs to be done to ensure the proper loading enforcement is applied without all the noise?",
      session_id: "generic-hook-prose",
    };

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    expect(Object.keys(currentTurnState(readSessionState(payload)).pendingSkills).sort()).toEqual([
      "claude-optimizer",
      "codex-optimizer",
    ]);
  });

  it("keeps low-signal prompt words from loading task and verification skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "use $task-creator to verify all assumptions",
      session_id: "task-token-only",
    };

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    expect(Object.keys(currentTurnState(readSessionState(payload)).pendingSkills)).toEqual([
      "task-creator",
    ]);
  });

  it("honors explicit low-signal skill names without treating the bare word as a trigger", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const explicit = { prompt: "make the fixes then $update", session_id: "explicit-update" };
    handleAgentHookEvent("UserPromptSubmit", explicit, { root, runtime: "claude" });
    expect(Object.keys(currentTurnState(readSessionState(explicit)).pendingSkills)).toEqual([
      "update",
    ]);

    const bare = {
      prompt: "please update the docs and verify the plan",
      session_id: "bare-update",
    };
    handleAgentHookEvent("UserPromptSubmit", bare, { root, runtime: "claude" });
    expect(currentTurnState(readSessionState(bare)).pendingSkills).toEqual({});
  });

  it("keeps every explicit skill token even when more than five skills are named", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt:
        "$code-atlas $claude-optimizer $codex-optimizer $adversarial-verification $task-creator $supaschema $update",
      session_id: "explicit-skill-list",
    };

    const result = handleAgentHookEvent("UserPromptSubmit", payload, {
      root,
      runtime: "claude",
    });
    const pending = Object.keys(currentTurnState(readSessionState(payload)).pendingSkills).sort();

    expect(pending).toEqual(
      [
        "adversarial-verification",
        "claude-optimizer",
        "code-atlas",
        "codex-optimizer",
        "supaschema",
        "task-creator",
        "update",
      ].sort()
    );
    expect(result.output.hookSpecificOutput?.additionalContext).toContain(
      "Run this observable skill load now:"
    );
    expect(result.output.hookSpecificOutput?.additionalContext).toContain(
      ".claude/skills/adversarial-verification/SKILL.md"
    );
  });

  it("does not treat command prose keywords as tool-scope skill signals", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "plain follow-up", session_id: "command-keyword-prose" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    const result = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "command-keyword-prose",
        tool_input: { command: "echo hook hooks PreToolUse PostToolUse" },
        tool_name: "Bash",
      },
      { root, runtime: "claude" }
    );

    expect(result.output.hookSpecificOutput).toBeUndefined();
  });

  it("keeps pending skill enforcement scoped to the active turn", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const first = { prompt: "use $code-atlas for scripts", session_id: "turn-scope" };
    handleAgentHookEvent("UserPromptSubmit", first, { root, runtime: "claude" });
    expect(currentTurnState(readSessionState(first)).pendingSkills).toHaveProperty("code-atlas");

    const second = { prompt: "plain follow-up", session_id: "turn-scope" };
    handleAgentHookEvent("UserPromptSubmit", second, { root, runtime: "claude" });

    const allowed = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "turn-scope",
        tool_input: { file_path: "README.md" },
        tool_name: "Read",
      },
      { root, runtime: "claude" }
    );
    expect(allowed.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(currentTurnState(readSessionState(second)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
  });

  it("uses Codex turn_id to isolate pending skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "use $code-atlas", session_id: "codex-turn", turn_id: "turn-a" },
      { root, runtime: "codex" }
    );
    expect(
      currentTurnState(readSessionState({ session_id: "codex-turn" })).pendingSkills
    ).toHaveProperty("code-atlas");

    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "different turn", session_id: "codex-turn", turn_id: "turn-b" },
      { root, runtime: "codex" }
    );
    expect(
      currentTurnState(readSessionState({ session_id: "codex-turn" })).pendingSkills
    ).not.toHaveProperty("code-atlas");
  });

  it("observes MCP SKILL.md reads as skill loads", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "mcp-load" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "mcp-load",
        tool_input: {
          action: "read",
          target: ".agents/skills/code-atlas/SKILL.md",
        },
        tool_name: "mcp__supaschema__repo_context_query",
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
    expect(readSessionState(payload).invokedSkills).toHaveProperty("code-atlas");
  });

  it("observes shell SKILL.md reads as skill loads in Codex", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "shell-load" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "shell-load",
        tool_input: {
          cmd: "sed -n '1,120p' .agents/skills/code-atlas/SKILL.md",
        },
        tool_name: "functions.exec_command",
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
    expect(readSessionState(payload).invokedSkills).toHaveProperty("code-atlas");
  });

  it("observes shell SKILL.md reads with Windows separators in Codex", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "shell-load-win-path" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "shell-load-win-path",
        tool_input: {
          cmd: "sed -n '1,120p' .agents\\skills\\code-atlas\\SKILL.md",
        },
        tool_name: "functions.exec_command",
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).not.toHaveProperty(
      "code-atlas"
    );
    expect(readSessionState(payload).invokedSkills).toHaveProperty("code-atlas");
  });

  it("ignores non-reader shell SKILL.md tokens when another segment reads a file", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "use $code-atlas for scripts",
      session_id: "shell-load-non-reader-token",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "shell-load-non-reader-token",
        tool_input: {
          cmd: "echo .agents\\skills\\code-atlas\\SKILL.md && sed -n '1,20p' README.md",
        },
        tool_name: "functions.exec_command",
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");
    expect(readSessionState(payload).invokedSkills).not.toHaveProperty("code-atlas");
  });

  it("observes one nested Codex shell reader command loading multiple pending skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "$code-atlas $claude-optimizer $codex-optimizer",
      session_id: "nested-multi-shell-load",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const loadPayload = {
      session_id: "nested-multi-shell-load",
      tool_input: {
        cmd: [
          "bash -lc \"sed -n '1,120p'",
          ".claude/skills/code-atlas/SKILL.md",
          ".claude/skills/claude-optimizer/SKILL.md",
          '.claude/skills/codex-optimizer/SKILL.md"',
        ].join(" "),
      },
      tool_name: "functions.exec_command",
    };
    const allowedLoad = handleAgentHookEvent("PreToolUse", loadPayload, {
      root,
      runtime: "codex",
    });
    expect(allowedLoad.output.hookSpecificOutput?.permissionDecision).toBeUndefined();

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...loadPayload,
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    const state = readSessionState(payload);
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("code-atlas");
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("claude-optimizer");
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("codex-optimizer");
    expect(state.invokedSkills).toHaveProperty("code-atlas");
    expect(state.invokedSkills).toHaveProperty("claude-optimizer");
    expect(state.invokedSkills).toHaveProperty("codex-optimizer");

    const edit = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "nested-multi-shell-load",
        tool_input: { file_path: "src/cli.ts" },
        tool_name: "Edit",
      },
      { root, runtime: "codex" }
    );
    expect(edit.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("serializes concurrent Codex PostToolUse skill loads for one session", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "$claude-optimizer $codex-optimizer",
      session_id: "parallel-skill-loads",
      turn_id: "turn-a",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    await Promise.all([
      runHookEventInChild(
        "PostToolUse",
        {
          session_id: "parallel-skill-loads",
          tool_input: {
            cmd: `sed -n '1,120p' ${join(root, ".claude/skills/claude-optimizer/SKILL.md")}`,
          },
          tool_name: "functions.exec_command",
          turn_id: "turn-a",
        },
        root,
        stateDir
      ),
      runHookEventInChild(
        "PostToolUse",
        {
          session_id: "parallel-skill-loads",
          tool_input: {
            cmd: `sed -n '1,120p' ${join(root, ".claude/skills/codex-optimizer/SKILL.md")}`,
          },
          tool_name: "functions.exec_command",
          turn_id: "turn-a",
        },
        root,
        stateDir
      ),
    ]);

    const state = readSessionState(payload);
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("claude-optimizer");
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("codex-optimizer");
    expect(state.invokedSkills).toHaveProperty("claude-optimizer");
    expect(state.invokedSkills).toHaveProperty("codex-optimizer");
  });
});

describe.skipIf(!hasAgentHookSources)("agent hook response detectors", () => {
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
        normalizedHookState()
      )
    ).toMatchObject({ id: "completion-claim-with-open-items" });
    expect(
      completionClaimWithOpenItems("Done.", { background_tasks: [] }, normalizedHookState())
    ).toBeUndefined();
  });

  it("detects verification claims without evidence", () => {
    expect(claimWithoutEvidence("Verified and clean.", normalizedHookState(), [])).toMatchObject({
      id: "claim-without-evidence",
    });
    expect(
      claimWithoutEvidence(
        "Verified and clean.",
        normalizedHookState({ evidence: [{ kind: "verified-command" }] }),
        []
      )
    ).toBeUndefined();
    expect(
      claimWithoutEvidence(
        "Verified and clean.",
        normalizedHookState({
          evidence: [{ kind: "code-atlas-query", outcome: "success" }],
        })
      )
    ).toMatchObject({ id: "claim-without-evidence" });
    expect(
      claimWithoutEvidence(
        "Verified Code Atlas scope.",
        normalizedHookState({
          evidence: [{ kind: "code-atlas-query", outcome: "success" }],
        })
      )
    ).toBeUndefined();
    expect(
      claimWithoutEvidence(
        "The GitHub checks are verified and green.",
        normalizedHookState({
          evidence: [{ domains: ["guard"], kind: "verified-command", outcome: "success" }],
        }),
        []
      )
    ).toMatchObject({ id: "claim-without-evidence" });
    expect(
      claimWithoutEvidence(
        "The GitHub checks are verified and green.",
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              domains: ["github-checks"],
              kind: "failed-command",
              outcome: "failure",
            },
            {
              at: "2026-06-15T00:01:00.000Z",
              domains: ["guard"],
              kind: "verified-command",
              outcome: "success",
            },
          ],
        }),
        []
      )
    ).toMatchObject({ id: "claim-without-evidence" });
    expect(
      claimWithoutEvidence(
        "The GitHub checks are verified and green.",
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              domains: ["github-checks"],
              kind: "failed-command",
              outcome: "failure",
            },
            {
              at: "2026-06-15T00:01:00.000Z",
              domains: ["github-checks"],
              kind: "verified-command",
              outcome: "success",
            },
          ],
        }),
        []
      )
    ).toBeUndefined();
  });

  it("detects mechanism-only diagnostic answers without end-state verification", () => {
    expect(
      mechanismClaimWithoutArchitecture(
        "This is expected behavior because Codex runs each matching hook.",
        normalizedHookState({
          lastPrompt: "verify from upstream Codex sources if this is running correctly",
        })
      )
    ).toMatchObject({ id: "mechanism-claim-without-architecture" });
    expect(
      mechanismClaimWithoutArchitecture(
        "Mechanism: Codex runs each matching hook. Architecture: the $elegant canonical owner keeps one Stop-time response-shape gate. Verification: checked upstream docs and ran npm run guard:agent.",
        normalizedHookState({
          lastPrompt: "verify from upstream Codex sources if this is running correctly",
        })
      )
    ).toBeUndefined();
  });

  it("blocks Claude Stop when response-shape corrections are pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "verify from upstream Claude sources if this is running correctly",
      session_id: "claude-stop-response-shape",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    const result = handleAgentHookEvent(
      "Stop",
      {
        last_assistant_message:
          "This is expected behavior because Claude runs the matching Stop hook.",
        session_id: "claude-stop-response-shape",
      },
      { root, runtime: "claude" }
    );

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("architecture/end-state disposition"),
    });
  });

  it("detects decision menus after direct directives", () => {
    expect(
      decisionMenuAfterDirective(
        "Option 1 is safer, choose one.",
        normalizedHookState({ lastPrompt: "implement it" })
      )
    ).toMatchObject({ id: "decision-menu-after-directive" });
    expect(
      decisionMenuAfterDirective(
        "I implemented it.",
        normalizedHookState({ lastPrompt: "what are options?" })
      )
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
      toolFailureWithoutRetry(
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              kind: "failed-command",
              outcome: "failure",
            },
          ],
        })
      )
    ).toMatchObject({ id: "tool-failure-without-retry" });
    expect(
      toolFailureWithoutRetry(
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              kind: "failed-command",
              outcome: "failure",
            },
            { at: "2026-06-15T00:01:00.000Z", kind: "verified-command" },
          ],
        })
      )
    ).toMatchObject({ id: "tool-failure-without-retry" });
    expect(
      toolFailureWithoutRetry(
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              domains: ["github-checks"],
              kind: "failed-command",
              outcome: "failure",
            },
            {
              at: "2026-06-15T00:01:00.000Z",
              domains: ["guard"],
              kind: "verified-command",
              outcome: "success",
            },
          ],
        })
      )
    ).toMatchObject({ id: "tool-failure-without-retry" });
    expect(
      toolFailureWithoutRetry(
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              domains: ["github-checks"],
              kind: "failed-command",
              outcome: "failure",
            },
            {
              at: "2026-06-15T00:01:00.000Z",
              domains: ["github-checks"],
              kind: "verified-command",
              outcome: "success",
            },
          ],
        })
      )
    ).toBeUndefined();
    expect(
      toolFailureWithoutRetry(
        normalizedHookState({
          evidence: [
            {
              at: "2026-06-15T00:00:00.000Z",
              kind: "failed-command",
            },
          ],
        })
      )
    ).toBeUndefined();
  });

  it("records Codex exec command evidence under the detector success kind", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the check", session_id: "exec-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-evidence",
        tool_input: { cmd: "npm run guard:agent" },
        tool_name: "functions.exec_command",
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run guard:agent",
        kind: "verified-command",
      })
    );
  });

  it("records npm run check as composite local verification evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the umbrella check", session_id: "exec-npm-check-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-npm-check-evidence",
        tool_input: { cmd: "npm run check" },
        tool_name: "functions.exec_command",
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run check",
        domains: ["build", "lint", "test", "typecheck"],
        kind: "verified-command",
        outcome: "success",
      })
    );
  });

  it("records completed GitHub check commands with failing output as failed evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "prove live GitHub checks", session_id: "exec-github-failure" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-github-failure",
        tool_input: { cmd: "gh pr view --json statusCheckRollup" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [
            {
              text: '{"statusCheckRollup":[{"conclusion":"FAILURE","name":"quality (22)"}]}',
            },
          ],
          exit_code: 0,
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "gh pr view --json statusCheckRollup",
        domains: ["github-checks"],
        kind: "failed-command",
        outcome: "failure",
      })
    );
  });

  it("does not treat successful GitHub checks as failed because a workflow name contains failure", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "prove live GitHub checks", session_id: "exec-github-success-name" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-github-success-name",
        tool_input: { cmd: "gh pr view --json statusCheckRollup" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [
            {
              text: JSON.stringify({
                statusCheckRollup: [
                  {
                    conclusion: "SUCCESS",
                    name: "CI Failure Report",
                    status: "COMPLETED",
                  },
                ],
              }),
            },
          ],
          exit_code: 0,
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "gh pr view --json statusCheckRollup",
        domains: ["github-checks"],
        kind: "verified-command",
        outcome: "success",
      })
    );
  });

  it("records pending GitHub check commands as unresolved evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "prove live GitHub checks", session_id: "exec-github-pending" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-github-pending",
        tool_input: { cmd: "gh pr view --json statusCheckRollup" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [
            {
              text: JSON.stringify({
                statusCheckRollup: [
                  {
                    name: "quality (22)",
                    status: "QUEUED",
                  },
                ],
              }),
            },
          ],
          exit_code: 0,
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "gh pr view --json statusCheckRollup",
        domains: ["github-checks"],
        kind: "failed-command",
        outcome: "failure",
      })
    );
  });

  it("blocks functions.apply_patch edits while response corrections are pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "verify from upstream Codex sources if this is running correctly",
      session_id: "codex-correction-apply-patch",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });
    handleAgentHookEvent(
      "Stop",
      {
        last_assistant_message:
          "This is expected behavior because Codex runs the matching Stop hook.",
        session_id: "codex-correction-apply-patch",
      },
      { root, runtime: "codex" }
    );

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "codex-correction-apply-patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Update File: src/cli.ts\n@@\n export {}\n*** End Patch\n",
        },
        tool_name: "functions.apply_patch",
      },
      { root, runtime: "codex" }
    );

    expect(blocked.output).toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("Response evidence correction"),
      }),
    });
  });

  it("parses nested Codex exec output text before recording command evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the check", session_id: "exec-text-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-text-evidence",
        tool_input: { cmd: "npm run guard:agent" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [{ text: "Process exited with code 0\nAGENT_HOOKS_OK" }],
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run guard:agent",
        kind: "verified-command",
      })
    );
  });

  it("does not record inventory source reads as verification evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "review these hooks", session_id: "source-read-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "source-read-evidence",
        tool_input: { cmd: "sed -n '1,260p' src/cli.ts" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [{ text: "if (failed) {\n  process.exitCode = 2;\n}" }],
          exit_code: 0,
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });

  it("does not block Stop on source-read text that mentions process.exitCode", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "review these hooks", session_id: "source-read-stop" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    for (const cmd of ["sed -n '1,260p' src/cli.ts", "sed -n '1,260p' src/cli-tools.ts"]) {
      handleAgentHookEvent(
        "PostToolUse",
        {
          session_id: "source-read-stop",
          tool_input: { cmd },
          tool_name: "functions.exec_command",
          tool_response: {
            content: [{ text: "process.exitCode = 2" }],
            exit_code: 0,
          },
        },
        { root, runtime: "codex" }
      );
    }

    const result = handleAgentHookEvent(
      "Stop",
      {
        last_assistant_message:
          "Architecture: the $elegant owner is the shared response-evidence detector. Verification: implementation checks are not run.",
        session_id: "source-read-stop",
      },
      { root, runtime: "codex" }
    );

    expect(result.output.decision).toBeUndefined();
    expect(JSON.stringify(result.output)).not.toContain("sed -n");
  });

  it("does not use transcript inventory reads as verification evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const transcriptPath = join(root, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        status: "success",
        tool_input: { cmd: "sed -n '1,260p' src/cli.ts" },
        tool_name: "functions.exec_command",
        type: "tool_result",
      })}\n`
    );

    const result = handleAgentHookEvent(
      "Stop",
      {
        last_assistant_message: "Verified and clean.",
        session_id: "transcript-source-read",
        transcript_path: transcriptPath,
      },
      { root, runtime: "codex" }
    );

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("response claims verification"),
    });
  });

  it("treats transcript GitHub check failures as unresolved evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const transcriptPath = join(root, "transcript-github-failure.jsonl");
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        status: "success",
        tool_input: { cmd: "gh pr view --json statusCheckRollup" },
        tool_name: "functions.exec_command",
        tool_response: {
          content: [
            {
              text: JSON.stringify({
                statusCheckRollup: [{ conclusion: "FAILURE", name: "check-os (windows-latest)" }],
              }),
            },
          ],
          exit_code: 0,
        },
        type: "tool_result",
      })}\n`
    );

    const result = handleAgentHookEvent(
      "Stop",
      {
        last_assistant_message: "GitHub checks are green and verified.",
        session_id: "transcript-github-failure",
        transcript_path: transcriptPath,
      },
      { root, runtime: "codex" }
    );

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("failed evidence remains unresolved"),
    });
  });

  it("does not create failed evidence when command outcome is unavailable", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the check", session_id: "exec-unknown-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-unknown-evidence",
        tool_input: { cmd: "npm run guard:agent" },
        tool_name: "functions.exec_command",
        tool_response: {},
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });
});

let sharedSkillRoot: Promise<string> | undefined;

async function seededHookRoot(): Promise<{ root: string; stateDir: string }> {
  const root = await seededSkillRoot();
  const stateDir = await mkdtemp(join(tmpdir(), "supa-agent-hook-state-"));
  return { root, stateDir };
}

function seededSkillRoot(): Promise<string> {
  sharedSkillRoot ??= createSeededSkillRoot();
  return sharedSkillRoot;
}

async function createSeededSkillRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-agent-hook-core-"));
  await Promise.all([
    writeSkill(
      root,
      "code-atlas",
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
    ),
    writeSkill(
      root,
      "claude-optimizer",
      `---
name: claude-optimizer
description: Optimize Claude Code hooks and rules.
metadata:
  keywords:
    - hooks
    - claude hooks
    - hook enforcer
  file-triggers:
    - .claude/hooks/**
    - .claude/rules/**
---

# Claude Optimizer
`
    ),
    writeSkill(
      root,
      "codex-optimizer",
      `---
name: codex-optimizer
description: Optimize Codex hooks and generated mirrors.
metadata:
  keywords:
    - hooks
    - codex hooks
    - hook enforcer
  file-triggers:
    - .codex/hooks/**
    - .codex/hooks.json
---

# Codex Optimizer
`
    ),
    writeSkill(
      root,
      "adversarial-verification",
      `---
name: adversarial-verification
description: Use when verifying implementation work without superficial approval.
metadata:
  keywords:
    - adversarial
    - verification
---

# Adversarial Verification
`
    ),
    writeSkill(
      root,
      "task-creator",
      `---
name: task-creator
description: Create validated task lists and implementation plans.
metadata:
  keywords:
    - task
    - plan
---

# Task Creator
`
    ),
    writeSkill(
      root,
      "supaschema",
      `---
name: supaschema
description: Generate, check, and verify supaschema migrations.
metadata:
  keywords:
    - verify
    - migration
---

# Supaschema
`
    ),
    writeSkill(
      root,
      "update",
      `---
name: update
description: Audit and update repo documentation and generated mirrors.
metadata:
  keywords:
    - update
    - repo documentation
---

# Update
`
    ),
    write(root, ".agents/skills/code-atlas/SKILL.md", "# Code Atlas\n"),
  ]);
  return root;
}

async function runHookEventInChild(
  eventName: string,
  payload: Record<string, unknown>,
  root: string,
  stateDir: string
): Promise<void> {
  const script = [
    "import { handleAgentHookEvent } from './scripts/agent-hooks/runner.mjs';",
    "const result = handleAgentHookEvent(process.argv[1], JSON.parse(process.argv[2]), { root: process.argv[3], runtime: 'codex' });",
    "if (result.stdout) process.stdout.write(result.stdout);",
    "if (result.stderr) process.stderr.write(result.stderr);",
    "process.exit(result.exitCode);",
  ].join("\n");
  await new Promise<void>((resolvePromise, reject) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script, eventName, JSON.stringify(payload), root],
      { env: { ...process.env, SUPASCHEMA_AGENT_HOOK_STATE_DIR: stateDir } },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${stderr}${stdout}`));
          return;
        }
        resolvePromise();
      }
    );
  });
}

function normalizedHookState(turn: Record<string, unknown> = {}) {
  return normalizeState({
    currentTurnId: "turn-0",
    turns: {
      "turn-0": turn,
    },
  });
}

async function writeSkill(root: string, name: string, text: string): Promise<void> {
  await write(root, `.claude/skills/${name}/SKILL.md`, text);
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}
