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
import { beginTurnState, selectTurnState, withSessionState } from "./state.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runAgentHookEvent(eventName, options = {}) {
  runHookEntrypoint(eventName, handleAgentHookEvent, { root, ...options });
}

export function handleAgentHookEvent(eventName, payload, options = {}) {
  const runtime = options.runtime ?? "claude";
  const hookPath = options.hookPath ?? "scripts/agent-hooks/runner.mjs";
  const hookRoot = options.root ?? root;
  try {
    return withSessionState(payload, (state, metadata) => {
      const context = { hookPath, root: hookRoot, runtime, state };
      let result = {};

      if (eventName === "UserPromptSubmit") {
        beginTurnState(payload, state);
      } else if (eventName === "PreToolUse") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [bashSafety], context);
      } else if (eventName === "PostToolUse") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [toolEvidence], context);
      } else if (eventName === "PostToolUseFailure") {
        selectTurnState(payload, state);
        result = runChecks(eventName, payload, [toolEvidence], context);
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

function bashSafety(payload, context) {
  if (payload?.tool_name !== "Bash") {
    return {};
  }
  const result = evaluateBashPolicy(payload, process.env, { root: context.root });
  return result.action === "block" ? { deny: result.message } : {};
}

function toolEvidence(payload, context) {
  return recordToolEvidence(payload, context.state, {
    root: context.root,
    runtime: context.runtime,
  });
}

function verificationConflict(payload, context) {
  if (payload?.stop_hook_active) {
    return {};
  }
  const conflict = verificationClaimConflict(finalMessage(payload), context.state);
  return conflict ? { block: conflict.message } : {};
}
