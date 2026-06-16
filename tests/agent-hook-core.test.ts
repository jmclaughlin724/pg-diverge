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
import { currentTurnState, readSessionState } from "../scripts/agent-hooks/state.mjs";

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
    expect(
      claimWithoutEvidence("Verified and clean.", {
        evidence: [{ kind: "code-atlas-query", outcome: "success" }],
      })
    ).toMatchObject({ id: "claim-without-evidence" });
    expect(
      claimWithoutEvidence("Verified Code Atlas scope.", {
        evidence: [{ kind: "code-atlas-query", outcome: "success" }],
      })
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
        evidence: [
          {
            at: "2026-06-15T00:00:00.000Z",
            kind: "failed-command",
            outcome: "failure",
          },
        ],
      })
    ).toMatchObject({ id: "tool-failure-without-retry" });
    expect(
      toolFailureWithoutRetry({
        evidence: [
          {
            at: "2026-06-15T00:00:00.000Z",
            kind: "failed-command",
            outcome: "failure",
          },
          { at: "2026-06-15T00:01:00.000Z", kind: "verified-command" },
        ],
      })
    ).toBeUndefined();
    expect(
      toolFailureWithoutRetry({
        evidence: [{ at: "2026-06-15T00:00:00.000Z", kind: "failed-command" }],
      })
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

async function seededHookRoot(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "supa-agent-hook-core-"));
  const stateDir = join(root, ".state");
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await writeSkill(
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
  );
  await write(root, ".agents/skills/code-atlas/SKILL.md", "# Code Atlas\n");
  return { root, stateDir };
}

async function writeSkill(root: string, name: string, text: string): Promise<void> {
  await write(root, `.claude/skills/${name}/SKILL.md`, text);
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}
