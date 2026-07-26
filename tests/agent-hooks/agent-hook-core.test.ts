import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const hasAgentHookSources = [
  "scripts/agent-hooks/command-evidence.mjs",
  "scripts/agent-hooks/evidence-gate.mjs",
  "scripts/agent-hooks/hook-output.mjs",
  "scripts/agent-hooks/response-claims.mjs",
  "scripts/agent-hooks/response-shape.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/state.mjs",
].every((file) => existsSync(join(process.cwd(), file)));
let runChecks: any;
let shapeHookResult: any;
let handleAgentHookEvent: any;
let deferralLanguage: any;
let hedgeDensity: any;
let preToolEvidenceGate: any;
let claimedVerificationDomains: any;
let correctionsFor: any;
let currentTurnState: any;
let normalizeState: any;
let readSessionState: any;
let sessionStatePath: any;
let setCorrections: any;
let transcriptEvidence: any;

function optionalImport(specifier: string): Promise<any> {
  return import(specifier);
}

if (hasAgentHookSources) {
  ({ runChecks, shapeHookResult } = await optionalImport(
    "../../scripts/agent-hooks/hook-output.mjs"
  ));
  ({ handleAgentHookEvent } = await optionalImport("../../scripts/agent-hooks/runner.mjs"));
  ({ deferralLanguage, hedgeDensity } = await optionalImport(
    "../../scripts/agent-hooks/response-shape.mjs"
  ));
  ({ preToolEvidenceGate } = await optionalImport("../../scripts/agent-hooks/evidence-gate.mjs"));
  ({ claimedVerificationDomains } = await optionalImport(
    "../../scripts/agent-hooks/response-claims.mjs"
  ));
  ({ transcriptEvidence } = await optionalImport("../../scripts/agent-hooks/command-evidence.mjs"));
  ({
    correctionsFor,
    currentTurnState,
    normalizeState,
    readSessionState,
    sessionStatePath,
    setCorrections,
  } = await optionalImport("../../scripts/agent-hooks/state.mjs"));
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
      "PostToolUseFailure",
      "SubagentStart",
    ]) {
      expect(shapeHookResult(eventName, { contextParts: ["ctx"] }).output).toMatchObject({
        hookSpecificOutput: {
          additionalContext: "ctx",
          hookEventName: eventName,
        },
      });
    }
    expect(shapeHookResult("Stop", { contextParts: ["ctx"] }).output).toEqual({});
    expect(shapeHookResult("SubagentStop", { contextParts: ["ctx"] }).output).toEqual({});
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
    expect(shapeHookResult("Stop", { block: "revise" }).output).toMatchObject({
      decision: "block",
      reason: "revise",
    });
    expect(shapeHookResult("Stop", {}, "codex").stdout).toBe("{}\n");
    expect(shapeHookResult("SessionEnd", {}).stdout).toBe("");
  });

  it("formats thrown checks as fail-closed hook feedback", () => {
    const result = runChecks(
      "PreToolUse",
      {},
      [
        function explodingCheck() {
          throw new Error("boom");
        },
      ],
      {
        hookPath: "/workspace/.codex/hooks/context-pre-tool-use.mjs",
        runtime: "codex",
      }
    );
    const shaped = hookFeedback(shapeHookResult("PreToolUse", result).output);

    expect(shaped.permissionDecisionReason).toContain("Agent hook failed closed.");
    expect(shaped.permissionDecisionReason).toContain("runtime=codex");
    expect(shaped.permissionDecisionReason).toContain(
      "hook=/workspace/.codex/hooks/context-pre-tool-use.mjs"
    );
    expect(shaped.permissionDecisionReason).toContain("check=explodingCheck");
    expect(shaped.permissionDecisionReason).toContain("source=");
    expect(shaped.permissionDecisionReason).toContain("agent-hook-core.test.ts:");
    expect(shaped.permissionDecisionReason).toContain("error=boom");
    expect(shaped.permissionDecisionReason).toContain("remediation=");
    expect(shaped.permissionDecisionReason).not.toContain("stack=");
  });

  it("fails closed without overwriting corrupted session state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-agent-hook-corrupt-state-"));
    process.env.STATE_DIR = stateDir;
    const payload = { session_id: "corrupt-session" };
    const file = sessionStatePath(payload);
    await writeFile(file, "{not-json");

    const result = handleAgentHookEvent("SessionStart", payload, {
      hookPath: "/workspace/.codex/hooks/context-session-start.mjs",
      runtime: "codex",
    });

    expect(result.output.systemMessage).toContain("Agent hook failed closed.");
    expect(result.output.systemMessage).toContain("check=sessionState");
    expect(result.output.systemMessage).toContain("runtime=codex");
    expect(result.output.systemMessage).toContain("error=could not read hook state");
    expect(result.output.systemMessage).toContain("invalid JSON");
    expect(await readFile(file, "utf8")).toBe("{not-json");
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
    const payload = { prompt: "please use $code-atlas after checking scripts", session_id: "mid" };

    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    expect(currentTurnState(readSessionState(payload)).pendingSkills).toHaveProperty("code-atlas");
    expect(readSessionState(payload).invokedSkills).not.toHaveProperty("code-atlas");
  });

  it("keeps generic hook prose from loading unrelated skills", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
  it("associates success with the verification head rather than topical modifiers", () => {
    expect(claimedVerificationDomains("Package tests passed.")).toEqual(["test"]);
    expect(claimedVerificationDomains("Package build succeeded.")).toEqual(["build"]);
    expect(claimedVerificationDomains("Package check passed.")).toEqual(["package"]);
    expect(claimedVerificationDomains("Project tests passed.")).toEqual(["test"]);
    expect(claimedVerificationDomains("Repository guard passed.")).toEqual(["guard"]);
    expect(claimedVerificationDomains("Sync check passed.")).toEqual(["sync"]);
    expect(claimedVerificationDomains("GitHub status checks passed.")).toEqual(["github-checks"]);
    expect(claimedVerificationDomains("CI checks passed.")).toEqual(["github-checks"]);
    expect(claimedVerificationDomains("The check passed.")).toEqual([]);
    expect(claimedVerificationDomains("Scoped git diff --check — passed.")).toEqual([]);
    expect(claimedVerificationDomains("Tests and guard passed.").sort()).toEqual(["guard", "test"]);
  });

  it("recognizes verification compounds without scanning across topical prose", () => {
    const subjects = [
      ["Test suite", "test"],
      ["Test run", "test"],
      ["Guard command", "guard"],
      ["Typecheck step", "typecheck"],
      ["Lint task", "lint"],
      ["Build job", "build"],
    ];
    for (const [subject, domain] of subjects) {
      for (const outcome of ["passed", "succeeded", "is green", "was successful"]) {
        expect(claimedVerificationDomains(`${subject} ${outcome}.`)).toEqual([domain]);
      }
    }
    expect(claimedVerificationDomains("Package test suite completed successfully.")).toEqual([
      "test",
    ]);
    expect(claimedVerificationDomains("The guard was completed successfully.")).toEqual(["guard"]);
    for (const message of [
      "Guard complete.",
      "Guard completes.",
      "Guard completed.",
      "I completed package docs successfully.",
      "The report about package tests was successful.",
      "Research regarding docs and package succeeded.",
      "A review concerning package docs passed.",
      "A study around docs and package was successful.",
      "The completed research report about external package docs was successful.",
      "The project report covering external package docs succeeded.",
    ]) {
      expect(claimedVerificationDomains(message)).toEqual([]);
    }
  });

  it("continues Codex Stop once for a completion claim with open work", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("open background tasks or pending skills remain"),
    });
    expect(result.stdout).toContain('"decision":"block"');

    const repeated = handleAgentHookEvent(
      "Stop",
      {
        background_tasks: [{ id: "019f4d1a-3671-7f91-8f4c-cc527b4ed6d1" }],
        last_assistant_message: "**completed_actions**",
        session_id: "codex-stop-continuation",
        stop_hook_active: true,
        turn_id: "turn-1",
      },
      { root, runtime: "codex" }
    );

    expect(repeated.output).toEqual({});
    expect(repeated.stdout).toBe("{}\n");
    expect(correctionsFor(payload, readSessionState(payload))).toEqual([]);
  });

  it("does not treat a completed external-repository research report as verification", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      session_id: "research-report-mentions",
      turn_id: "turn-1",
    };

    const result = handleAgentHookEvent(
      "Stop",
      {
        ...payload,
        last_assistant_message: [
          "Read-only research of the external repository docs and package layout is complete.",
          "No verification commands were run.",
        ].join(" "),
      },
      { root, runtime: "codex" }
    );

    expect(result.output).toEqual({});
    expect(correctionsFor(payload, readSessionState(payload))).toEqual([]);
  });

  it("requires positive evidence only when the runtime producer path is observable", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const message = "The tests pass and the guard passed.";
    const claudePayload = {
      last_assistant_message: message,
      session_id: "explicit-verification-claims-claude",
      turn_id: "turn-1",
    };
    const codexPayload = {
      last_assistant_message: message,
      session_id: "explicit-verification-claims-codex",
      turn_id: "turn-1",
    };

    const claudeResult = handleAgentHookEvent("Stop", claudePayload, {
      root,
      runtime: "claude",
    });
    const codexResult = handleAgentHookEvent("Stop", codexPayload, {
      root,
      runtime: "codex",
    });

    expect(claudeResult.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("no successful evidence was recorded for: test, guard"),
    });
    expect(codexResult.output).toEqual({});
  });

  it("blocks Codex verification claims contradicted by recorded failure evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      session_id: "codex-recorded-verification-failure",
      turn_id: "turn-1",
    };
    handleAgentHookEvent(
      "PostToolUse",
      {
        ...payload,
        tool_input: { command: "npm test -- failing-fixture" },
        tool_name: "Bash",
        tool_response: { exit_code: 1 },
      },
      { root, runtime: "codex" }
    );

    const result = handleAgentHookEvent(
      "Stop",
      { ...payload, last_assistant_message: "The tests passed." },
      { root, runtime: "codex" }
    );

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("failed evidence remains unresolved for: test"),
    });
  });

  it("emits an identical cross-turn subagent correction once per runtime", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;

    for (const runtime of ["claude", "codex"]) {
      const payload = {
        agent_id: `worker-${runtime}`,
        last_assistant_message:
          "Maybe probably possibly the package report could differ after the final review today.",
        session_id: `cross-turn-correction-${runtime}`,
        turn_id: "turn-1",
      };
      const first = handleAgentHookEvent("SubagentStop", payload, { root, runtime });
      const second = handleAgentHookEvent(
        "SubagentStop",
        { ...payload, turn_id: "turn-2" },
        { root, runtime }
      );
      const third = handleAgentHookEvent(
        "SubagentStop",
        { ...payload, turn_id: "turn-3" },
        { root, runtime }
      );

      expect(first.output).toMatchObject({
        decision: "block",
        reason: expect.stringContaining("dense hedging"),
      });
      expect(second.output).toEqual({});
      expect(third.output).toEqual({});
      expect(second.stdout).toBe(runtime === "codex" ? "{}\n" : "");
      expect(third.stdout).toBe(runtime === "codex" ? "{}\n" : "");
    }
  });

  it("does not count historical could statements as dense hedging", () => {
    const historicalFailureSummary = [
      "Malformed hook input could silently misfire.",
      "Claude and Codex SessionStart contracts could not safely share one schema.",
      "Partial canonical mutations could escape synchronization.",
    ].join(" ");

    expect(hedgeDensity(historicalFailureSummary)).toBeUndefined();
  });

  it("does not classify an optional feature disposition as deferred work", () => {
    const optionalFeatureDisposition =
      "If you want a searchable hook-history ledger, that is a separate observability feature. It is not required for upstream parity.";

    expect(deferralLanguage(optionalFeatureDisposition)).toBeUndefined();
  });

  it("does not repeat an emitted signature when a revised response adds a new correction", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      last_assistant_message: "The package was successful.",
      session_id: "mixed-correction-signatures",
      turn_id: "turn-1",
    };

    handleAgentHookEvent("Stop", payload, { root, runtime: "claude" });
    const revised = handleAgentHookEvent(
      "Stop",
      {
        ...payload,
        last_assistant_message:
          "The package was successful. Maybe probably possibly the report could differ.",
        turn_id: "turn-2",
      },
      { root, runtime: "claude" }
    );
    const repeated = handleAgentHookEvent(
      "Stop",
      {
        ...payload,
        last_assistant_message:
          "The package was successful. Maybe probably possibly the report could differ.",
        turn_id: "turn-3",
      },
      { root, runtime: "claude" }
    );

    expect(revised.output.reason).toContain("dense hedging");
    expect(revised.output.reason).not.toContain("no successful evidence was recorded for: package");
    expect(repeated.output).toEqual({});
  });

  it("clears a correction when the revised response disclaims verification", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      agent_id: "disclaimer-worker",
      last_assistant_message: "The package was successful.",
      session_id: "correction-disclaimer",
      turn_id: "turn-1",
    };

    const first = handleAgentHookEvent("SubagentStop", payload, { root, runtime: "claude" });
    const revised = handleAgentHookEvent(
      "SubagentStop",
      {
        ...payload,
        last_assistant_message:
          "Package verification was not run; this is a read-only research report.",
        turn_id: "turn-2",
      },
      { root, runtime: "claude" }
    );

    expect(first.output).toMatchObject({ decision: "block" });
    expect(revised.output).toEqual({});
    expect(correctionsFor(payload, readSessionState(payload))).toEqual([]);
  });

  it("preserves a main correction across the generated continuation prompt", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const firstPayload = {
      last_assistant_message: "The package was successful.",
      session_id: "main-correction-continuation",
      turn_id: "turn-1",
    };
    const first = handleAgentHookEvent("Stop", firstPayload, { root, runtime: "claude" });
    const reason = stringValue(first.output.reason);

    handleAgentHookEvent(
      "UserPromptSubmit",
      {
        prompt: reason,
        session_id: firstPayload.session_id,
        turn_id: "turn-2",
      },
      { root, runtime: "claude" }
    );
    const repeated = handleAgentHookEvent(
      "Stop",
      { ...firstPayload, turn_id: "turn-2" },
      { root, runtime: "claude" }
    );

    expect(reason).toContain("no successful evidence was recorded for: package");
    expect(repeated.output).toEqual({});
  });

  it("clears correction lanes at their actor lifecycle boundaries", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const session = { session_id: "correction-lifecycle", turn_id: "turn-1" };
    const claim = { ...session, last_assistant_message: "The package was successful." };

    handleAgentHookEvent("Stop", claim, { root, runtime: "claude" });
    handleAgentHookEvent("SubagentStop", { ...claim, agent_id: "worker-1" }, { root });
    handleAgentHookEvent("SubagentStop", { ...claim, agent_id: "worker-2" }, { root });

    handleAgentHookEvent(
      "UserPromptSubmit",
      { ...session, prompt: "a new user request", turn_id: "turn-2" },
      { root, runtime: "claude" }
    );
    let state = readSessionState(session);
    expect(correctionsFor({}, state)).toEqual([]);
    expect(correctionsFor({ agent_id: "worker-1" }, state)).toHaveLength(1);
    expect(correctionsFor({ agent_id: "worker-2" }, state)).toHaveLength(1);

    handleAgentHookEvent(
      "SubagentStart",
      { ...session, agent_id: "worker-1", turn_id: "turn-2" },
      { root, runtime: "claude" }
    );
    state = readSessionState(session);
    expect(correctionsFor({ agent_id: "worker-1" }, state)).toEqual([]);
    expect(correctionsFor({ agent_id: "worker-2" }, state)).toHaveLength(1);
  });

  it("drops legacy corrections and bounds the actor ledger", () => {
    const correction = {
      id: "claim-without-evidence",
      message: "Missing verification evidence.",
    };
    const state = normalizeState({
      currentTurnId: "turn-1",
      turns: { "turn-1": { corrections: [correction] } },
    });

    expect(correctionsFor({}, state)).toEqual([]);
    for (let index = 0; index < 25; index += 1) {
      setCorrections({ agent_id: `worker-${index}` }, state, [correction]);
    }
    expect(Object.keys(state.responseCorrections)).toHaveLength(20);
    expect(state.responseCorrections).not.toHaveProperty("agent:worker-0");
    expect(state.responseCorrections).toHaveProperty("agent:worker-24");
  });

  it("isolates subagent corrections and permits only null-device redirection", () => {
    const correction = {
      id: "claim-without-evidence",
      message: "Missing package verification evidence.",
    };
    const isolatedState = normalizeState({});
    setCorrections({ agent_id: "worker-1" }, isolatedState, [correction]);

    expect(
      preToolEvidenceGate(
        {
          tool_input: { command: "echo report > artifact.txt" },
          tool_name: "Bash",
        },
        isolatedState
      )
    ).toEqual({});

    const mainState = normalizeState({});
    const readOnly = {
      tool_input: {
        command: "ls example 2>/dev/null && cat example 2>/dev/null | head",
      },
      tool_name: "Bash",
    };
    setCorrections(readOnly, mainState, [correction]);

    expect(preToolEvidenceGate(readOnly, mainState)).toEqual({});
    for (const command of [
      "echo report &>/dev/null",
      "echo report >& /dev/null",
      "echo report >| /dev/null",
    ]) {
      expect(
        preToolEvidenceGate(
          {
            tool_input: { command },
            tool_name: "Bash",
          },
          mainState
        )
      ).toEqual({});
    }
    for (const command of [
      "echo report > artifact.txt",
      "echo report >> artifact.txt",
      "echo report &> artifact.txt",
      "echo report 2> artifact.txt",
      "echo report >& artifact.txt",
      "echo report >| artifact.txt",
      "echo report 2>&1",
    ]) {
      expect(
        preToolEvidenceGate(
          {
            tool_input: { command },
            tool_name: "Bash",
          },
          mainState
        ).deny
      ).toContain("Response evidence correction is still pending");
    }
    expect(
      preToolEvidenceGate(
        {
          tool_input: { command: "echo 'report > artifact.txt'" },
          tool_name: "Bash",
        },
        mainState
      )
    ).toEqual({});
  });

  it("continues Codex SubagentStop when closeout defers requested work", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      prompt: "implement the fix",
      session_id: "codex-subagent-stop-continuation",
      turn_id: "turn-1",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    const result = handleAgentHookEvent(
      "SubagentStop",
      {
        last_assistant_message: "If you want, I can implement the fix.",
        session_id: payload.session_id,
        turn_id: payload.turn_id,
      },
      { root, runtime: "codex" }
    );

    expect(result.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("defers work"),
    });
  });

  it("records Codex exec command evidence under the detector success kind", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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

  it("normalizes every observed shell command payload shape", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = { prompt: "run the checks", session_id: "shell-payload-evidence" };
    const shapes = [
      ["Bash", "command"],
      ["Bash", "cmd"],
      ["exec_command", "command"],
      ["exec_command", "cmd"],
      ["functions.exec_command", "command"],
      ["functions.exec_command", "cmd"],
    ];
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    for (const [index, [toolName, commandField]] of shapes.entries()) {
      const command = `npm run guard:agent -- --shape=${index}`;
      handleAgentHookEvent(
        "PostToolUse",
        {
          session_id: payload.session_id,
          tool_input: { [commandField]: command },
          tool_name: toolName,
          tool_response: { exit_code: 0 },
        },
        { root, runtime: "codex" }
      );

      expect(currentTurnState(readSessionState(payload)).evidence.at(-1)).toMatchObject({
        command,
        domains: ["guard"],
        kind: "verified-command",
        outcome: "success",
      });
    }
    expect(currentTurnState(readSessionState(payload)).evidence).toHaveLength(shapes.length);

    const atlasCommand =
      "node scripts/code-atlas/query.mjs pre-edit scripts/agent-hooks/command-evidence.mjs";
    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: payload.session_id,
        tool_input: { cmd: atlasCommand },
        tool_name: "exec_command",
        tool_response: { exit_code: 0 },
      },
      { root, runtime: "codex" }
    );
    expect(currentTurnState(readSessionState(payload)).evidence.at(-1)).toMatchObject({
      command: atlasCommand,
      kind: "code-atlas-query",
      outcome: "success",
      queryKind: "pre-edit",
      value: "scripts/agent-hooks/command-evidence.mjs",
    });
  });

  it.each([
    ["isError", false, "success"],
    ["isError", true, "failure"],
    ["is_error", false, "success"],
    ["is_error", true, "failure"],
  ])("records the local Atlas tool from top-level %s=%s", async (key, value, outcome) => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = { session_id: `local-${key}-${value}`, turn_id: "turn-1" };

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...payload,
        tool_input: {
          kind: "pre-edit",
          value: "scripts/agent-hooks/command-evidence.mjs",
        },
        tool_name: "mcp__supaschema__code_atlas_query",
        tool_response: { [key]: value },
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        kind: "code-atlas-query",
        outcome,
        queryKind: "pre-edit",
      })
    );
  });

  it("does not infer a local Atlas outcome from nested isError", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = { session_id: "nested-local-outcome", turn_id: "turn-1" };

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...payload,
        tool_input: { kind: "impact", value: "scripts/agent-hooks/command-evidence.mjs" },
        tool_name: "mcp__supaschema__code_atlas_query",
        tool_response: { data: { isError: false } },
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });

  it.each([
    "describe_snapshot_schema",
    "filter_review_findings",
    "get_coverage_overlay",
    "get_function_dependencies",
    "get_impact_of_change",
    "get_regression_scope",
    "get_review_context",
    "pre_edit_brief",
    "query_snapshot",
    "run_review",
    "set_review_guidelines",
    "update_ai_finding_status",
    "clear_findings",
    "configure_ai_provider",
    "generate_review",
    "unknown_direct_tool",
  ])("does not record removed direct CodeAtlas tool %s", async (tool) => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = { session_id: `removed-live-${tool}`, turn_id: "turn-1" };

    handleAgentHookEvent(
      "PostToolUse",
      {
        ...payload,
        tool_input: {},
        tool_name: `mcp__codeatlas__${tool}`,
        tool_response: { isError: false },
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });

  it("requires local Atlas evidence for a Code Atlas passed claim", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const livePayload = { session_id: "missing-atlas-claim", turn_id: "turn-1" };

    const liveClaim = handleAgentHookEvent(
      "Stop",
      { ...livePayload, last_assistant_message: "Code Atlas passed." },
      { root, runtime: "claude" }
    );
    expect(liveClaim.output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("no successful evidence was recorded for: code-atlas"),
    });

    const localPayload = { session_id: "local-atlas-claim", turn_id: "turn-1" };
    handleAgentHookEvent(
      "PostToolUse",
      {
        ...localPayload,
        tool_input: { kind: "pre-edit", value: "scripts/agent-hooks/command-evidence.mjs" },
        tool_name: "mcp__supaschema__code_atlas_query",
        tool_response: { isError: false },
      },
      { root, runtime: "claude" }
    );

    const localClaim = handleAgentHookEvent(
      "Stop",
      { ...localPayload, last_assistant_message: "Code Atlas passed." },
      { root, runtime: "claude" }
    );
    expect(localClaim.output).toEqual({});
  });

  it("reads exec command aliases from transcript evidence", async () => {
    const transcriptDir = await mkdtemp(join(tmpdir(), "supa-agent-hook-transcript-"));
    const transcriptPath = join(transcriptDir, "transcript.jsonl");
    const entries = [
      {
        timestamp: "2026-07-21T12:00:00.000Z",
        tool_input: { cmd: "npm run guard:agent" },
        tool_name: "exec_command",
        tool_response: { exit_code: 0 },
        type: "tool_result",
      },
      {
        payload: {
          arguments: JSON.stringify({ cmd: "npm run typecheck" }),
          call_id: "exec-command-call",
          name: "functions.exec_command",
          type: "function_call",
        },
        timestamp: "2026-07-21T12:00:01.000Z",
      },
      {
        payload: {
          call_id: "exec-command-call",
          output: "Process exited with code 0",
          type: "function_call_output",
        },
        timestamp: "2026-07-21T12:00:02.000Z",
      },
    ];
    await writeFile(
      transcriptPath,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
    );

    expect(transcriptEvidence({ transcript_path: transcriptPath })).toEqual([
      expect.objectContaining({
        command: "npm run guard:agent",
        domains: ["guard"],
        outcome: "success",
      }),
      expect.objectContaining({
        command: "npm run typecheck",
        domains: ["typecheck"],
        outcome: "success",
      }),
    ]);
  });

  it("records npm run check as composite local verification evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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

  it("records Claude PostToolUseFailure commands as failed evidence without a tool response", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = {
      prompt: "run the hook guard",
      session_id: "claude-post-tool-failure-evidence",
    };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    handleAgentHookEvent(
      "PostToolUseFailure",
      {
        hook_event_name: "PostToolUseFailure",
        session_id: "claude-post-tool-failure-evidence",
        tool_input: { command: "npm run guard:agent" },
        tool_name: "Bash",
      },
      { root, runtime: "claude" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
      expect.objectContaining({
        command: "npm run guard:agent",
        domains: ["guard"],
        kind: "failed-command",
        outcome: "failure",
      })
    );
  });

  it("records completed GitHub check commands with failing output as failed evidence", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
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

  it("requires shell command-not-found incidents to lead the final response after a retry", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;

    for (const runtime of ["claude", "codex"]) {
      const payload = {
        prompt: "fix the reporting failure",
        session_id: `shell-command-not-found-${runtime}`,
        turn_id: "turn-1",
      };
      handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime });

      handleAgentHookEvent(
        runtime === "claude" ? "PostToolUseFailure" : "PostToolUse",
        {
          ...payload,
          hook_event_name: runtime === "claude" ? "PostToolUseFailure" : "PostToolUse",
          tool_input: {
            command: 'rg -n "`next.config.ts`" tools/soleaux',
          },
          tool_name: "Bash",
          ...(runtime === "claude"
            ? {
                error: "zsh:1: command not found: next.config.ts",
                is_interrupt: false,
              }
            : {
                tool_response: {
                  content: [{ text: "zsh:1: command not found: next.config.ts" }],
                  exit_code: 127,
                },
              }),
        },
        { root, runtime }
      );
      handleAgentHookEvent(
        "PostToolUse",
        {
          ...payload,
          tool_input: {
            command: "rg -n -F 'next.config.ts' tools/soleaux",
          },
          tool_name: "Bash",
          tool_response: {
            content: [{ text: "tools/soleaux/src/soleaux/frameworks/nextjs.py:1" }],
            exit_code: 0,
          },
        },
        { root, runtime }
      );

      expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
        expect.objectContaining({
          incident: "shell-command-not-found",
          kind: "tool-incident",
          outcome: "failure",
        })
      );

      const buried = handleAgentHookEvent(
        "Stop",
        {
          ...payload,
          last_assistant_message: [
            "The reporting fix is complete.",
            "One malformed read-only search attempted to execute next.config.ts; it failed without mutation.",
          ].join("\n\n"),
        },
        { root, runtime }
      );
      expect(buried.output).toMatchObject({
        decision: "block",
        reason: expect.stringContaining("Begin the final response with `Tool incident:`"),
      });

      const leading = handleAgentHookEvent(
        "Stop",
        {
          ...payload,
          last_assistant_message: [
            "Tool incident: zsh attempted to execute next.config.ts and returned command not found.",
            "Post-command hashes verified no mutation, and the search was rerun safely.",
            "The reporting fix is complete.",
          ].join("\n\n"),
        },
        { root, runtime }
      );
      expect(leading.output).toEqual({});
    }
  });

  it("records native Windows command-not-found diagnostics", async () => {
    const cases = [
      {
        message: "'next.config.ts' is not recognized as an internal or external command",
        runtime: "claude",
      },
      {
        message:
          "next.config.ts : The term 'next.config.ts' is not recognized as the name of a cmdlet, function, script file, or operable program.",
        runtime: "codex",
      },
    ];

    for (const { message, runtime } of cases) {
      const { root, stateDir } = await seededHookRoot();
      process.env.STATE_DIR = stateDir;
      const payload = {
        prompt: "fix the reporting failure",
        session_id: `windows-command-not-found-${runtime}`,
      };
      handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime });
      handleAgentHookEvent(
        runtime === "claude" ? "PostToolUseFailure" : "PostToolUse",
        {
          ...payload,
          hook_event_name: runtime === "claude" ? "PostToolUseFailure" : "PostToolUse",
          tool_input: { command: "next.config.ts" },
          tool_name: "Bash",
          ...(runtime === "claude"
            ? { error: message, is_interrupt: false }
            : { tool_response: { content: [{ text: message }], exit_code: 1 } }),
        },
        { root, runtime }
      );

      expect(currentTurnState(readSessionState(payload)).evidence).toContainEqual(
        expect.objectContaining({
          incident: "shell-command-not-found",
          kind: "tool-incident",
          outcome: "failure",
        })
      );
    }
  });

  it("does not promote an ordinary failed source read to a tool incident", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
    const payload = { prompt: "review these hooks", session_id: "failed-source-read" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "codex" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "failed-source-read",
        tool_input: { command: "rg -n -F 'missing literal' scripts/agent-hooks" },
        tool_name: "Bash",
        tool_response: { exit_code: 1 },
      },
      { root, runtime: "codex" }
    );

    expect(currentTurnState(readSessionState(payload)).evidence).toEqual([]);
  });

  it("does not create failed evidence when command outcome is unavailable", async () => {
    const { root, stateDir } = await seededHookRoot();
    process.env.STATE_DIR = stateDir;
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
    process.env.STATE_DIR = stateDir;
    const payload = { prompt: "run the guard", session_id: "claude-bash-shape" };
    handleAgentHookEvent("UserPromptSubmit", payload, { root, runtime: "claude" });

    handleAgentHookEvent(
      "PostToolUse",
      {
        session_id: "claude-bash-shape",
        tool_input: { command: "npm run guard" },
        tool_name: "Bash",
        tool_response: {
          interrupted: false,
          isImage: false,
          stderr: "",
          stdout: "ALL_GUARDS_OK\n",
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
    process.env.STATE_DIR = stateDir;
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
        tool_input: { command: "npm run test" },
        tool_name: "Bash",
        tool_response: { exit_code: 0 },
        turn_id: "turn-1",
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
      { env: { ...process.env, STATE_DIR: stateDir } },
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
