import { isSubagentInvocation } from "./skills.mjs";
import { currentTurnState } from "./state.mjs";
import { toolName } from "./tool-payload.mjs";

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
  if (pending.length === 0 || toolName(payload) === "Bash") {
    return {};
  }
  if (responseCorrectionEditTools.has(toolName(payload))) {
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
