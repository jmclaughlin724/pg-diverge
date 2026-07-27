import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { recordToolEvidence } from "./command-evidence.mjs";
import { preToolEvidenceGate } from "./evidence-gate.mjs";
import { failClosedResult, runChecks, shapeHookResult, writeHookResult } from "./hook-output.mjs";
import { mergedTopicBranchContext } from "./merged-branch-state.mjs";
import {
  evaluateRepositoryBoundary,
  promptAuthorizesBranchMutation,
} from "./repository-boundary.mjs";
import { runResponseDetectors } from "./response-shape.mjs";
import { validateSessionStartPayload } from "./session-start-schema.mjs";
import {
  recordObservableSkillLoad,
  unresolvedPending,
  updatePromptSkills,
  updateToolSkills,
} from "./skills.mjs";
import {
  beginTurnState,
  clearCorrections,
  correctionsFor,
  currentTurnState,
  markCorrectionsBlocked,
  selectTurnState,
  sessionStartState,
  withSessionState,
} from "./state.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runAgentHookEvent(eventName, options = {}) {
  const runtime = options.runtime ?? hookRuntime();
  const hookPath = options.hookPath ?? process.argv[1] ?? "unknown";
  let shaped;
  try {
    const payload = readStdinJson(eventName, runtime);
    shaped = handleAgentHookEvent(eventName, payload, { hookPath, root, runtime });
  } catch (error) {
    shaped = shapeHookResult(
      eventName,
      failClosedResult(eventName, error, "hookInput", {
        hookPath,
        remediation: `Send one valid JSON object on stdin matching the ${eventName} hook schema.`,
        runtime,
      }),
      runtime
    );
  }
  writeHookResult(shaped);
  process.exit(shaped.exitCode);
}

export function handleAgentHookEvent(eventName, payload, options = {}) {
  const runtime = options.runtime ?? "claude";
  const hookPath = options.hookPath ?? "scripts/agent-hooks/runner.mjs";
  try {
    if (eventName === "WorktreeCreate") {
      return shapeHookResult(
        eventName,
        {
          block:
            "BLOCKED: worktree creation is prohibited for this repository. Continue in the active primary checkout.",
        },
        runtime
      );
    }
    return withSessionState(payload, (state) => {
      const context = { hookPath, root: options.root ?? root, runtime, state };
      let result = {};
      let clear = false;

      if (eventName === "SessionStart") {
        context.state = sessionStartState(payload, state);
        result = runChecks(eventName, payload, [standingContext, mergedTopicContext], context);
      } else if (eventName === "UserPromptSubmit") {
        beginTurnState(payload, state);
        result = runChecks(eventName, payload, [promptSkills], context);
      } else if (eventName === "PreToolUse") {
        selectTurnState(payload, state);
        result = runChecks(
          eventName,
          payload,
          [repositoryBoundary, toolSkills, evidenceGate, bashSafety],
          context
        );
      } else if (eventName === "PostToolUse" || eventName === "PostToolUseFailure") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [observableSkillLoad, toolEvidence], context);
      } else if (eventName === "SubagentStart") {
        selectTurnState(payload, state);
        clearCorrections(payload, state);
        result = runChecks(eventName, payload, [subagentContext], context);
      } else if (eventName === "Stop" || eventName === "SubagentStop") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [responseShape], context);
      } else if (eventName === "TaskCompleted") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [taskCompletionGate], context);
      } else if (eventName === "SessionEnd") {
        clear = true;
      }

      return {
        clear,
        state: context.state,
        value: shapeHookResult(eventName, result, runtime),
        write: eventName !== "SessionEnd",
      };
    });
  } catch (error) {
    return shapeHookResult(
      eventName,
      failClosedResult(eventName, error, "sessionState", {
        hookPath,
        remediation:
          "Inspect the reported session-state error, preserve the state file, and rerun the hook.",
        runtime,
      }),
      runtime
    );
  }
}

function standingContext() {
  return {
    contextParts: [
      "Agent hook layer active: load matched skills through observable Skill tool calls or SKILL.md reads, verify claims with tool evidence, and revise final responses when Stop feedback reports shape violations.",
    ],
  };
}

function mergedTopicContext(_payload, context) {
  return mergedTopicBranchContext(context.root);
}

function promptSkills(payload, context) {
  return updatePromptSkills(payload, context.state, context);
}

function toolSkills(payload, context) {
  return updateToolSkills(payload, context.state, context);
}

function evidenceGate(payload, context) {
  return preToolEvidenceGate(payload, context.state);
}

function repositoryBoundary(payload, context) {
  const result = evaluateRepositoryBoundary(payload, context);
  return result.action === "block" ? { deny: result.message } : {};
}

function bashSafety(payload, context) {
  const result = evaluateBashPolicy(payload, process.env, {
    blockAllWorktrees: true,
    branchMutationAuthorized: promptAuthorizesBranchMutation(
      currentTurnState(context.state).lastPrompt
    ),
    enforceActiveBranch: true,
  });
  return result.action === "block" ? { deny: result.message } : {};
}

function observableSkillLoad(payload, context) {
  return recordObservableSkillLoad(payload, context.state, context);
}

function toolEvidence(payload, context) {
  return recordToolEvidence(payload, context.state);
}

function subagentContext(_payload, context) {
  const pending = unresolvedPending(context.state);
  if (pending.length === 0) {
    return {
      contextParts: [
        "Subagent starts with isolated context. Preload relevant skills through subagent frontmatter `skills:` or explicitly load them in the subagent before governed work.",
      ],
    };
  }
  return {
    contextParts: [
      [
        "Subagent starts with isolated context and inherited loaded skills are not assumed.",
        ...pending.map((item) => `- Pending skill for parent task: ${item.name}: ${item.reason}`),
      ].join("\n"),
    ],
  };
}

function responseShape(payload, context) {
  if (payload?.stop_hook_active) {
    clearCorrections(payload, context.state);
    return {};
  }
  const detectorResult = runResponseDetectors(payload, context.state, context.runtime);
  if (!detectorResult.contextParts?.length) {
    return detectorResult;
  }
  const corrections = correctionsFor(payload, context.state);
  if (!corrections.some((correction) => !correction.blocked)) {
    return {};
  }
  const block = detectorResult.contextParts.join("\n\n");
  markCorrectionsBlocked(payload, context.state, block);
  return {
    block,
  };
}

function taskCompletionGate(payload, context) {
  const pending = unresolvedPending(context.state);
  const corrections = correctionsFor(payload, context.state).filter((item) => !item.blocked);
  if (pending.length === 0 && corrections.length === 0) {
    return {};
  }
  return {
    block: [
      "Task completion blocked by deterministic agent hook state.",
      ...pending.map((item) => `- Pending skill: ${item.name}: ${item.reason}`),
      ...corrections.map((item) => `- Pending response correction: ${item.message}`),
    ].join("\n"),
  };
}

function hookRuntime() {
  const normalized = String(process.argv[1] ?? "")
    .split(path.sep)
    .join("/");
  return normalized.includes("/.codex/hooks/") ? "codex" : "claude";
}

function readStdinJson(eventName, runtime) {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim().length === 0) {
    throw new Error("hook stdin was empty");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `hook stdin is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("hook stdin must contain one JSON object");
  }
  if (eventName === "SessionStart") {
    validateSessionStartPayload(payload, runtime);
  }
  return payload;
}
