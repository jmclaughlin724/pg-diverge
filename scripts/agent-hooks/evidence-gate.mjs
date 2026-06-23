import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { isSubagentInvocation } from "./skills.mjs";
import { currentTurnState } from "./state.mjs";
import { isCommandTool, toolCommand, toolName } from "./tool-payload.mjs";

const responseCorrectionEditTools = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "functions.apply_patch",
  "edit_file",
]);

export function preToolEvidenceGate(payload, state) {
  const pending = currentTurnState(state).corrections.filter((item) =>
    [
      "claim-without-evidence",
      "mechanism-claim-without-architecture",
      "tool-failure-without-retry",
    ].includes(item.id)
  );
  if (pending.length === 0) {
    return {};
  }
  if (isResponseCorrectionMutation(payload)) {
    if (isSubagentInvocation(payload)) {
      return {
        contextParts: [
          [
            "A response evidence correction is pending in the parent session:",
            ...pending.map((item) => `- ${item.message}`),
            "This subagent cannot resolve the parent's response-shape correction; report results to the orchestrator instead of relying on this edit. The gate is advisory inside subagents because PreToolUse fires here but the subagent cannot revise the parent's final response.",
          ].join("\n"),
        ],
      };
    }
    return {
      deny: [
        "Response evidence correction is still pending.",
        ...pending.map((item) => `- ${item.message}`),
        "Run or inspect the missing verification evidence before editing further.",
      ].join("\n"),
    };
  }
  return {};
}

function isResponseCorrectionMutation(payload) {
  const name = toolName(payload);
  if (responseCorrectionEditTools.has(name)) {
    return true;
  }
  if (!isCommandTool(name)) {
    return false;
  }
  return shellCommandMayMutate(toolCommand(payload));
}

function shellCommandMayMutate(command) {
  let segments = [];
  try {
    segments = commandSegmentObjects(command);
  } catch {
    return true;
  }
  return segments.some((segment) => {
    if (segment.operatorBefore === ">") {
      return true;
    }
    const name = commandName(segment.words);
    const args = commandArgs(segment.words);
    if (name === "tee") {
      return true;
    }
    if (name === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i."))) {
      return true;
    }
    if (["python", "python3"].includes(name) && args.includes("-c")) {
      return true;
    }
    if (["perl", "ruby"].includes(name) && args.includes("-e")) {
      return true;
    }
    return name === "node" && args.some((arg) => arg === "-e" || arg === "--eval");
  });
}
