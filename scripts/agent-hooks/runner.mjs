import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { recordToolEvidence } from "./command-evidence.mjs";
import { preToolEvidenceGate } from "./evidence-gate.mjs";
import { failClosedResult, runChecks, shapeHookResult } from "./hook-output.mjs";
import { runResponseDetectors } from "./response-shape.mjs";
import {
  recordObservableSkillLoad,
  unresolvedPending,
  updatePromptSkills,
  updateToolSkills,
} from "./skills.mjs";
import {
  beginTurnState,
  currentTurnState,
  selectTurnState,
  sessionStartState,
  withSessionState,
} from "./state.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runAgentHookEvent(eventName, options = {}) {
  const payload = readStdinJson();
  const runtime = options.runtime ?? hookRuntime();
  const shaped = handleAgentHookEvent(eventName, payload, { root, runtime });
  if (shaped.stdout) {
    process.stdout.write(shaped.stdout);
  }
  if (shaped.stderr) {
    process.stderr.write(`${shaped.stderr}\n`);
  }
  process.exit(shaped.exitCode);
}

export function handleAgentHookEvent(eventName, payload, options = {}) {
  const runtime = options.runtime ?? "claude";
  try {
    return withSessionState(payload, (state) => {
      const context = { root: options.root ?? root, runtime, state };
      let result = {};
      let clear = false;

      if (eventName === "SessionStart") {
        context.state = sessionStartState(payload, state);
        result = runChecks(eventName, payload, [standingContext], context);
      } else if (eventName === "UserPromptSubmit") {
        beginTurnState(payload, state);
        result = runChecks(eventName, payload, [promptSkills], context);
      } else if (eventName === "PreToolUse") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [toolSkills, evidenceGate, bashSafety], context);
      } else if (eventName === "PostToolUse") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [observableSkillLoad, toolEvidence], context);
      } else if (eventName === "SubagentStart") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [subagentContext], context);
      } else if (eventName === "Stop" || eventName === "SubagentStop") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [responseShape], context);
      } else if (eventName === "TaskCompleted") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [taskCompletionGate], context);
      } else if (eventName === "PermissionDenied") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [permissionDeniedContext], context);
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
    return shapeHookResult(eventName, failClosedResult(eventName, error, "sessionState"), runtime);
  }
}

function standingContext() {
  return {
    contextParts: [
      "Agent hook layer active: load matched skills through observable Skill tool calls or SKILL.md reads, verify claims with tool evidence, and revise final responses when Stop feedback reports shape violations.",
    ],
  };
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

function bashSafety(payload) {
  const result = evaluateBashPolicy(payload);
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
  const detectorResult = runResponseDetectors(payload, context.state);
  if (!detectorResult.contextParts?.length) {
    return detectorResult;
  }
  if (payload?.stop_hook_active) {
    return detectorResult;
  }
  return {
    block: detectorResult.contextParts.join("\n\n"),
  };
}

function taskCompletionGate(_payload, context) {
  const pending = unresolvedPending(context.state);
  const corrections = currentTurnState(context.state).corrections;
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

function permissionDeniedContext(payload) {
  const reason = payload?.denial_reason ?? payload?.tool_response?.reason ?? "permission denied";
  return {
    block: `Permission denial observed. Re-plan without retrying the same denied action. reason=${reason}`,
  };
}

function hookRuntime() {
  const normalized = String(process.argv[1] ?? "")
    .split(path.sep)
    .join("/");
  return normalized.includes("/.codex/hooks/") || process.env.CODEX_PROJECT_DIR
    ? "codex"
    : "claude";
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
