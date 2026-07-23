import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { isSubagentInvocation } from "./skills.mjs";
import { correctionsFor } from "./state.mjs";

const responseCorrectionEditTools = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "functions.apply_patch",
  "edit_file",
]);
const evidenceCorrectionIds = new Set([
  "claim-without-evidence",
  "mechanism-claim-without-architecture",
  "tool-failure-without-retry",
]);

export function preToolEvidenceGate(payload, state) {
  const pending = correctionsFor(payload, state).filter(
    (item) => !item.blocked && evidenceCorrectionIds.has(item.id)
  );
  if (pending.length === 0 || !isResponseCorrectionMutation(payload)) {
    return {};
  }
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

function isResponseCorrectionMutation(payload) {
  const name = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (responseCorrectionEditTools.has(name)) {
    return true;
  }
  if (!["Bash", "functions.exec_command", "exec_command"].includes(name)) {
    return false;
  }
  const input = payload?.tool_input ?? {};
  const command = typeof input.command === "string" ? input.command : input.cmd;
  return shellCommandMayMutate(typeof command === "string" ? command : "");
}

function shellCommandMayMutate(command) {
  if (hasNonNullOutputRedirection(command)) {
    return true;
  }
  let segments = [];
  try {
    segments = commandSegmentObjects(command);
  } catch {
    return true;
  }
  return segments.some((segment) => {
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

function hasNonNullOutputRedirection(command) {
  let escaped = false;
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char !== ">") {
      continue;
    }
    const target = outputRedirectionTarget(command, index + 1);
    if (target.value !== "/dev/null") {
      return true;
    }
    index = target.endIndex;
  }
  return false;
}

function outputRedirectionTarget(command, startIndex) {
  let index = startIndex;
  while (command[index] === ">") {
    index += 1;
  }
  if (command[index] === "&" || command[index] === "|") {
    index += 1;
  }
  while (isShellWhitespace(command[index])) {
    index += 1;
  }

  let escaped = false;
  let quote = "";
  let value = "";
  for (; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        value += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (isShellWhitespace(char) || ";|&()<>".includes(char)) {
      break;
    }
    value += char;
  }
  return { endIndex: index - 1, value };
}

function isShellWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
