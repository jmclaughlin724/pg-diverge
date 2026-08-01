import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { recordToolEvidence } from "./command-evidence.mjs";
import { runHookEntrypoint } from "./hook-entrypoint.mjs";
import {
  mergeResult,
  runChecks,
  shapeHookResult,
  shapeSessionStateFailure,
} from "./hook-output.mjs";
import { verificationClaimConflict } from "./response-claims.mjs";
import { finalMessage } from "./response-evidence.mjs";
import {
  isObservableLoad,
  pendingSkillMessage,
  recordObservableSkillLoad,
  unresolvedPending,
  updateFileTriggeredSkills,
  updatePromptSkills,
} from "./skills.mjs";
import { beginTurnState, selectTurnState, withSessionState } from "./state.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runAgentHookEvent(eventName, options = {}) {
  runHookEntrypoint(eventName, handleAgentHookEvent, { root, ...options });
}

export function handleAgentHookEvent(eventName, payload, options = {}) {
  const runtime = options.runtime ?? "claude";
  const hookPath = options.hookPath ?? "scripts/agent-hooks/runner.mjs";
  try {
    return withSessionState(payload, (state, metadata) => {
      const context = { hookPath, root: options.root ?? root, runtime, state };
      let result = {};

      if (eventName === "UserPromptSubmit") {
        beginTurnState(payload, state);
        result = runChecks(eventName, payload, [promptSkills], context);
      } else if (eventName === "PreToolUse") {
        selectTurnState(payload, state);
        result = runChecks(
          eventName,
          payload,
          [fileTriggeredSkills, pendingSkillGate, bashSafety],
          context
        );
      } else if (eventName === "PostToolUse") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [observableSkillLoad, toolEvidence], context);
      } else if (eventName === "PostToolUseFailure") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [toolEvidence], context);
      } else if (eventName === "SubagentStart") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [subagentContext], context);
      } else if (eventName === "TaskCompleted") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [taskCompletionSkillGate], context);
      } else if (eventName === "Stop" || eventName === "SubagentStop") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [verificationConflict], context);
      }

      if (metadata.warning) {
        mergeResult(result, { systemMessage: metadata.warning });
      }
      return {
        state: context.state,
        value: shapeHookResult(eventName, result, runtime),
      };
    });
  } catch (error) {
    return shapeSessionStateFailure(eventName, error, { hookPath, runtime });
  }
}

function promptSkills(payload, context) {
  return updatePromptSkills(payload, context.state, context);
}

function fileTriggeredSkills(payload, context) {
  return updateFileTriggeredSkills(payload, context.state, context);
}

function pendingSkillGate(payload, context) {
  const message = pendingSkillMessage(context.state);
  if (!message || isObservableLoad(payload, context.root, context.runtime)) {
    return {};
  }
  return isSubagentPayload(payload) ? { contextParts: [message] } : { deny: message };
}

function bashSafety(payload, context) {
  if (payload?.tool_name !== "Bash") {
    return {};
  }
  const result = evaluateBashPolicy(payload, process.env, { root: context.root });
  return result.action === "block" ? { deny: result.message } : {};
}

function observableSkillLoad(payload, context) {
  return recordObservableSkillLoad(payload, context.state, context);
}

function toolEvidence(payload, context) {
  return recordToolEvidence(payload, context.state, {
    root: context.root,
    runtime: context.runtime,
  });
}

function subagentContext(_payload, context) {
  const pending = unresolvedPending(context.state);
  if (pending.length === 0) {
    return {};
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

function taskCompletionSkillGate(_payload, context) {
  const message = pendingSkillMessage(context.state);
  return context.runtime === "claude" && message ? { block: message } : {};
}

function verificationConflict(payload, context) {
  if (payload?.stop_hook_active) {
    return {};
  }
  const conflict = verificationClaimConflict(finalMessage(payload), context.state);
  return conflict ? { block: conflict.message } : {};
}

function isSubagentPayload(payload) {
  return typeof payload?.agent_id === "string" && payload.agent_id.length > 0;
}
