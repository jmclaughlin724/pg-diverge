import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const hasAgentHookSources = [
  "scripts/agent-hooks/command-evidence.mjs",
  "scripts/agent-hooks/hook-output.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/state.mjs",
].every((file) => existsSync(join(process.cwd(), file)));
let runChecks: any;
let shapeHookResult: any;
let handleAgentHookEvent: any;
let currentTurnState: any;
let readSessionState: any;

function optionalImport(specifier: string): Promise<any> {
  return import(specifier);
}

if (hasAgentHookSources) {
  ({ runChecks, shapeHookResult } = await optionalImport(
    "../../scripts/agent-hooks/hook-output.mjs"
  ));
  ({ handleAgentHookEvent } = await optionalImport("../../scripts/agent-hooks/runner.mjs"));
  ({ currentTurnState, readSessionState } = await optionalImport(
    "../../scripts/agent-hooks/state.mjs"
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
    ]) {
      expect(shapeHookResult(eventName, { contextParts: ["ctx"] }).output).toMatchObject({
        hookSpecificOutput: {
          additionalContext: "ctx",
          hookEventName: eventName,
        },
      });
    }
  });

  it("pins blocking and denial shapes by event", () => {
    expect(shapeHookResult("PreToolUse", { deny: "no" }).output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "no",
      },
    });
    expect(shapeHookResult("TaskCompleted", { block: "not done" })).toMatchObject({
      exitCode: 2,
      stderr: "not done",
    });
    expect(shapeHookResult("SessionEnd", {}).stdout).toBe("");
  });

  it("formats thrown checks as fail-closed hook feedback", () => {
    const result = runChecks("PreToolUse", {}, [
      function explodingCheck() {
        throw new Error("boom");
      },
    ]);
    const shaped = hookFeedback(shapeHookResult("PreToolUse", result).output);

    expect(shaped.permissionDecisionReason).toContain("Agent hook failed closed.");
    expect(shaped.permissionDecisionReason).toContain("check=explodingCheck");
    expect(shaped.permissionDecisionReason).toContain("error=boom");
  });

  it("keeps same-hook PreToolUse denial reasons from multiple checks", () => {
    const result = runChecks("PreToolUse", {}, [
      function firstCheck() {
        return { deny: "load required skill" };
      },
      function secondCheck() {
        return { block: "unsafe Bash command" };
      },
    ]);
    const shaped = hookFeedback(shapeHookResult("PreToolUse", result).output);

    expect(shaped.permissionDecisionReason).toContain("load required skill");
    expect(shaped.permissionDecisionReason).toContain("unsafe Bash command");
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
        tool_input: { file_path: "scripts/guards/agent-surface/check-agent-hooks.mjs" },
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

  it("blocks apply_patch edits while a required Claude skill is pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "apply-patch-pending" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "apply-patch-pending",
        tool_input: {
          command: "*** Begin Patch\n*** Update File: src/cli.ts\n@@\n export {}\n*** End Patch\n",
        },
        tool_name: "apply_patch",
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

  it("clears pending only after a Skill tool load or SKILL.md read", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "clear-session" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });
    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");

    handleAgentHookEvent(
      "PostToolUse",
      { session_id: "clear-session", tool_input: { skill: "code-atlas" }, tool_name: "Skill" },
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
  }, 15_000);

  it("allows the first observable Claude skill load before blocking governed work", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "load-first" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    const unrelatedRead = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "load-first",
        tool_input: {
          command: "sed -n '1,120p' README.md",
        },
        tool_name: "Bash",
      },
      { root, runtime: "claude" }
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
          command: "sed -n '1,120p' .claude/skills/code-atlas/SKILL.md",
        },
        tool_name: "Bash",
      },
      { root, runtime: "claude" }
    );

    expect(skillRead.output.hookSpecificOutput?.permissionDecision).toBeUndefined();

    const blocked = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "load-first",
        tool_input: { file_path: "src/cli.ts" },
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

  it("allows Code Atlas evidence acquisition while Claude skills are pending", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "use $code-atlas for scripts", session_id: "atlas-first" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    const atlasQuery = {
      session_id: "atlas-first",
      tool_input: {
        command:
          "npm run code-atlas:query -- pre-edit scripts/guards/agent-surface/check-agent-hooks.mjs --json",
      },
      tool_name: "Bash",
    };
    const allowed = handleAgentHookEvent("PreToolUse", atlasQuery, { root, runtime: "claude" });
    expect(allowed.output.hookSpecificOutput?.permissionDecision).toBeUndefined();

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...atlasQuery,
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");
    expect(currentTurnState(readSessionState(payload)).evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "code-atlas-query",
          outcome: "success",
          queryKind: "pre-edit",
          value: "scripts/guards/agent-surface/check-agent-hooks.mjs",
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
        tool_input: { skill: "code-atlas" },
        tool_name: "Skill",
      },
      { root, runtime: "claude" }
    );

    const allowed = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "quiet-loaded-skill",
        tool_input: { file_path: "scripts/guards/agent-surface/check-agent-hooks.mjs" },
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
      "optimizer",
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
      prompt: "$code-atlas $optimizer $adversarial-verification $task-creator $supaschema $update",
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
        "code-atlas",
        "optimizer",
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

  it("keeps Codex skill matches advisory across turn ids", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "use $code-atlas", session_id: "codex-turn", turn_id: "turn-a" },
      { root, runtime: "codex" }
    );
    expect(currentTurnState(readSessionState({ session_id: "codex-turn" })).pendingSkills).toEqual(
      {}
    );

    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "different turn", session_id: "codex-turn", turn_id: "turn-b" },
      { root, runtime: "codex" }
    );
    expect(currentTurnState(readSessionState({ session_id: "codex-turn" })).pendingSkills).toEqual(
      {}
    );
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
          command: "sed -n '1,120p' .agents/skills/code-atlas/SKILL.md",
        },
        tool_name: "Bash",
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
          command: "sed -n '1,120p' .agents\\skills\\code-atlas\\SKILL.md",
        },
        tool_name: "Bash",
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
          command: "echo .agents\\skills\\code-atlas\\SKILL.md && sed -n '1,20p' README.md",
        },
        tool_name: "Bash",
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toEqual({});
    expect(readSessionState(payload).invokedSkills).not.toHaveProperty("code-atlas");
  });

  it("advises the mirrored Codex skill for an apply_patch file trigger", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "edit the policy", session_id: "codex-apply-patch-advisory" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const result = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: "codex-apply-patch-advisory",
        tool_input: {
          command:
            "*** Begin Patch\n*** Update File: .claude/rules/12-skill-loading-enforcement.md\n*** End Patch",
        },
        tool_name: "apply_patch",
      },
      { root, runtime: "codex" }
    );

    expect(result.output.hookSpecificOutput?.additionalContext).toContain(
      "Skill optimizer applies to this tool use"
    );
    expect(currentTurnState(readSessionState(payload)).pendingSkills).toEqual({});
  });

  it("observes one nested Codex shell reader command loading multiple pending skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "$code-atlas $optimizer $update",
      session_id: "nested-multi-shell-load",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const loadPayload = {
      session_id: "nested-multi-shell-load",
      tool_input: {
        command: [
          "bash -lc \"sed -n '1,120p'",
          ".agents/skills/code-atlas/SKILL.md",
          ".agents/skills/optimizer/SKILL.md",
          '.agents/skills/update/SKILL.md"',
        ].join(" "),
      },
      tool_name: "Bash",
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
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("optimizer");
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("update");
    expect(state.invokedSkills).toHaveProperty("code-atlas");
    expect(state.invokedSkills).toHaveProperty("optimizer");
    expect(state.invokedSkills).toHaveProperty("update");

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
      prompt: "$optimizer $code-atlas",
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
            command: `sed -n '1,120p' ${join(root, ".agents/skills/optimizer/SKILL.md")}`,
          },
          tool_name: "Bash",
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
            command: `sed -n '1,120p' ${join(root, ".agents/skills/code-atlas/SKILL.md")}`,
          },
          tool_name: "Bash",
          turn_id: "turn-a",
        },
        root,
        stateDir
      ),
    ]);

    const state = readSessionState(payload);
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("optimizer");
    expect(currentTurnState(state).pendingSkills).not.toHaveProperty("code-atlas");
    expect(state.invokedSkills).toHaveProperty("optimizer");
    expect(state.invokedSkills).toHaveProperty("code-atlas");
  });
});

describe.skipIf(!hasAgentHookSources)("agent hook evidence and stop safety", () => {
  it("does not continue Codex Stop for completion prose or undocumented task fields", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "review with $upstream",
      session_id: "codex-stop-continuation",
      turn_id: "turn-1",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toEqual({});

    const result = handleAgentHookEvent(
      "Stop",
      {
        background_tasks: [{ id: "019f4d1a-3671-7f91-8f4c-cc527b4ed6d1" }],
        last_assistant_message: "**completed_actions**",
        session_id: "codex-stop-continuation",
        turn_id: "turn-1",
      },
      { root, runtime: "codex" }
    );

    expect(result.output).toEqual({});
    expect(result.stdout).toBe("");
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
        tool_input: { command: "npm run guard:agent" },
        tool_name: "Bash",
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
        tool_input: { command: "npm run check" },
        tool_name: "Bash",
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
        tool_input: { command: "gh pr view --json statusCheckRollup" },
        tool_name: "Bash",
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
        tool_input: { command: "gh pr view --json statusCheckRollup" },
        tool_name: "Bash",
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
        tool_input: { command: "gh pr view --json statusCheckRollup" },
        tool_name: "Bash",
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

  it("parses nested Codex exec output text before recording command evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the check", session_id: "exec-text-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-text-evidence",
        tool_input: { command: "npm run guard:agent" },
        tool_name: "Bash",
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

  it("recognizes verification evidence behind npx options", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the tests", session_id: "exec-npx-evidence" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "exec-npx-evidence",
        tool_input: { command: "npx --yes vitest run tests/agent-hooks/agent-hook-core.test.ts" },
        tool_name: "Bash",
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npx --yes vitest run tests/agent-hooks/agent-hook-core.test.ts",
        domains: ["test"],
        kind: "verified-command",
        outcome: "success",
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
        tool_input: { command: "sed -n '1,260p' src/cli.ts" },
        tool_name: "Bash",
        tool_response: {
          content: [{ text: "if (failed) {\n  process.exitCode = 2;\n}" }],
          exit_code: 0,
        },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
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
        tool_input: { command: "npm run guard:agent" },
        tool_name: "Bash",
        tool_response: {},
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });

  it("records Claude Bash success from the documented tool_response shape", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = { prompt: "run the guard", session_id: "claude-bash-shape" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "claude-bash-shape",
        tool_name: "Bash",
        tool_input: { command: "npm run guard" },
        tool_response: {
          stdout: "ALL_GUARDS_OK\n",
          stderr: "",
          interrupted: false,
          isImage: false,
        },
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run guard",
        domains: ["guard"],
        kind: "verified-command",
        outcome: "success",
      })
    );
  });

  it("records Codex documented Bash success end-to-end", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR = stateDir;
    const payload = {
      prompt: "run the test suite",
      session_id: "codex-bash-shape",
      turn_id: "turn-1",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "codex-bash-shape",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run test",
        domains: ["test"],
        kind: "verified-command",
        outcome: "success",
      })
    );
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
    - code atlas
    - code-atlas
    - code map
    - repo graph
    - graph proof
    - mcp-status
    - scripts
  file-triggers:
    - scripts/code-atlas/**
    - .mcp.json
    - fastmcp.json
    - services/agent-mcp/**
    - .claude/rules/10-code-atlas.md
    - .claude/rules/11-agent-mcp-fastmcp.md
    - scripts/guards/code-atlas/**
    - scripts/guards/fastmcp/**
    - scripts/guards/**
---

# Code Atlas
`
    ),
    writeSkill(
      root,
      "optimizer",
      `---
name: optimizer
description: Optimize Claude and Codex hooks, skills, and sync.
metadata:
  keywords:
    - agent surface
    - skill matcher
    - skill routing
    - hooks
    - claude hooks
    - codex hooks
    - sync ownership
    - generated mirrors
    - package boundary
    - fastmcp
    - code atlas
    - hook enforcer
  file-triggers:
    - .claude/skills/**
    - .claude/agents/**
    - .agents/prompts/**
    - skills/supaschema/**
    - agent-bundle/**
    - services/agent-mcp/**
    - scripts/code-atlas/**
    - scripts/guards/fastmcp/**
    - scripts/guards/code-atlas/**
    - .claude/hooks/**
    - .claude/rules/**
    - .codex/hooks/**
    - .codex/hooks.json
---

# Optimizer
`
    ),
    writeSkill(
      root,
      "fastmcp",
      `---
name: fastmcp
description: Maintain the local FastMCP server.
metadata:
  keywords:
    - fastmcp
    - mcp
    - repo mcp
    - agent mcp
    - supaschema mcp
  file-triggers:
    - services/agent-mcp/**
    - fastmcp.json
    - .mcp.json
    - .codex/config.toml
    - .claude/rules/11-agent-mcp-fastmcp.md
    - scripts/guards/fastmcp/**
    - scripts/code-atlas/**
---

# FastMCP
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

async function writeSkill(root: string, name: string, text: string): Promise<void> {
  await Promise.all([
    write(root, `.claude/skills/${name}/SKILL.md`, text),
    write(root, `.agents/skills/${name}/SKILL.md`, text),
  ]);
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}
