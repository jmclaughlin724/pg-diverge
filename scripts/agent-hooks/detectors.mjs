import fs from "node:fs";
import { codeAtlasQueryEvidence } from "./atlas.mjs";
import { isSubagentInvocation } from "./skills.mjs";
import { addEvidence, currentTurnState, setCorrections } from "./state.mjs";

const verificationWords = ["verified", "tested", "passed", "green", "clean"];
const completionWords = ["completed", "finished", "done", "implemented", "fixed"];
const hedgeWords = ["maybe", "probably", "possibly", "likely", "might", "could", "seems"];
const deferralTerms = ["if you want", "would you like", "i can ", "i could ", "let me know"];
const menuTerms = ["option 1", "option a", "choose", "which approach", "pick one"];
const directTerms = ["execute", "implement", "fix", "update", "do it", "make the change"];

export function recordToolEvidence(payload, state) {
  const name = toolName(payload);
  const command = toolCommand(payload);
  const atlasEvidence = codeAtlasQueryEvidence(payload);
  if (!((isCommandTool(name) && command) || atlasEvidence)) {
    return {};
  }
  const success = toolSucceeded(payload);
  if (success === undefined) {
    return {};
  }
  if (atlasEvidence) {
    addEvidence(state, {
      ...atlasEvidence,
      outcome: success ? "success" : "failure",
      summary: success ? "Code Atlas query succeeded" : "Code Atlas query failed",
    });
  }
  if (!(isCommandTool(name) && command)) {
    return {};
  }
  addEvidence(state, {
    command,
    kind: success ? "verified-command" : "failed-command",
    outcome: success ? "success" : "failure",
    summary: success ? "verification command succeeded" : "tool command failed",
  });
  return {};
}

export function runResponseDetectors(payload, state) {
  const message = finalMessage(payload);
  const findings = [
    hedgeDensity(message),
    completionClaimWithOpenItems(message, payload, state),
    claimWithoutEvidence(message, state, transcriptEvidence(payload)),
    decisionMenuAfterDirective(message, state),
    deferralLanguage(message),
    toolFailureWithoutRetry(state),
  ].filter(Boolean);

  setCorrections(state, findings);
  if (findings.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Final response correction required.",
        ...findings.map((finding) => `- ${finding.message}`),
        "Revise the response using only verified evidence already present in the session, or run the missing verification before claiming completion.",
      ].join("\n"),
    ],
  };
}

export function preToolEvidenceGate(payload, state) {
  const pending = currentTurnState(state).corrections.filter((item) =>
    ["claim-without-evidence", "tool-failure-without-retry"].includes(item.id)
  );
  if (pending.length === 0 || toolName(payload) === "Bash") {
    return {};
  }
  if (
    ["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch", "edit_file"].includes(
      toolName(payload)
    )
  ) {
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

export function hedgeDensity(message) {
  const words = splitWords(message);
  if (words.length < 10) {
    return;
  }
  const count = hedgeWords.reduce((total, term) => total + countTerm(message, term), 0);
  return count >= 3
    ? {
        id: "hedge-density",
        message:
          "The final response uses dense hedging; replace uncertainty with verified facts or explicit unknowns.",
      }
    : undefined;
}

export function completionClaimWithOpenItems(message, payload, state) {
  const hasCompletion = completionWords.some((term) => lower(message).includes(term));
  const openTasks = Array.isArray(payload?.background_tasks) && payload.background_tasks.length > 0;
  const pendingSkills = Object.keys(currentTurnState(state).pendingSkills).some(
    (skill) => !state.invokedSkills[skill]
  );
  return hasCompletion && (openTasks || pendingSkills)
    ? {
        id: "completion-claim-with-open-items",
        message:
          "The response claims completion while open background tasks or pending skills remain.",
      }
    : undefined;
}

export function claimWithoutEvidence(message, state, transcript = []) {
  const claimsVerification = verificationWords.some((term) => lower(message).includes(term));
  const evidenceItems = [...currentTurnState(state).evidence, ...transcript];
  const evidence =
    evidenceItems.some(successfulCommandEvidence) ||
    (mentionsCodeAtlas(message) && evidenceItems.some(successfulAtlasEvidence));
  return claimsVerification && !evidence
    ? {
        id: "claim-without-evidence",
        message:
          "The response claims verification without a recorded successful verification command.",
      }
    : undefined;
}

export function decisionMenuAfterDirective(message, state) {
  const direct = directTerms.some((term) =>
    lower(currentTurnState(state).lastPrompt).includes(term)
  );
  const menu = menuTerms.some((term) => lower(message).includes(term));
  return direct && menu
    ? {
        id: "decision-menu-after-directive",
        message: "The response offered a decision menu after a direct implementation directive.",
      }
    : undefined;
}

export function deferralLanguage(message) {
  return deferralTerms.some((term) => lower(message).includes(term))
    ? {
        id: "deferral-language",
        message: "The response defers work instead of reporting concrete action or a blocker.",
      }
    : undefined;
}

export function toolFailureWithoutRetry(state) {
  const evidence = currentTurnState(state).evidence;
  const lastFailure = [...evidence].reverse().find(isActionableFailure);
  if (!lastFailure) {
    return;
  }
  const laterSuccess = evidence.some(
    (item) => successfulCommandEvidence(item) && item.at > lastFailure.at
  );
  return laterSuccess
    ? undefined
    : {
        id: "tool-failure-without-retry",
        message:
          "A verification command failed and no later successful verification evidence is recorded.",
      };
}

function isActionableFailure(item) {
  return item.kind === "failed-command" && item.outcome === "failure";
}

function transcriptEvidence(payload) {
  const file = typeof payload?.transcript_path === "string" ? payload.transcript_path : "";
  if (!file) {
    return [];
  }
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry?.type === "tool_result" && entry?.status === "success")
      .map((entry) => ({
        kind: "verified-command",
        summary: String(entry.tool_name ?? "tool_result"),
      }));
  } catch {
    return [];
  }
}

function toolSucceeded(payload) {
  const response =
    payload?.tool_response ?? payload?.tool_output ?? payload?.tool_result ?? payload?.response;
  const outcome = toolOutcome(response);
  if (outcome !== undefined) {
    return outcome;
  }

  if (
    response &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    typeof response.interrupted === "boolean"
  ) {
    return !response.interrupted;
  }
  return;
}

function isCommandTool(name) {
  return ["Bash", "functions.exec_command", "exec_command"].includes(name);
}

function toolCommand(payload) {
  const input = payload?.tool_input ?? {};
  for (const key of ["command", "cmd"]) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }
  return "";
}

function finalMessage(payload) {
  return typeof payload?.last_assistant_message === "string" ? payload.last_assistant_message : "";
}

function toolOutcome(value) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    return stringOutcome(value);
  }
  if (typeof value !== "object") {
    return;
  }
  const direct = directOutcome(value);
  if (direct !== undefined) {
    return direct;
  }
  for (const child of childValues(value)) {
    const outcome = toolOutcome(child);
    if (outcome !== undefined) {
      return outcome;
    }
  }
}

function directOutcome(value) {
  for (const key of ["exit_code", "exitCode", "exit_code_or_signal", "code"]) {
    if (typeof value?.[key] === "number") {
      return value[key] === 0;
    }
  }
  for (const key of ["success", "ok"]) {
    if (typeof value?.[key] === "boolean") {
      return value[key];
    }
  }
  if (typeof value?.is_error === "boolean") {
    return !value.is_error;
  }
  if (typeof value?.interrupted === "boolean" && value.interrupted) {
    return false;
  }
  if (typeof value?.status === "string") {
    return statusOutcome(value.status);
  }
  if (typeof value?.outcome === "string") {
    return statusOutcome(value.outcome);
  }
}

function statusOutcome(status) {
  const normalized = lower(status);
  if (["success", "ok", "completed", "complete"].includes(normalized)) {
    return true;
  }
  if (["error", "failed", "failure", "cancelled", "canceled"].includes(normalized)) {
    return false;
  }
}

function stringOutcome(text) {
  const exitCode = exitCodeFromText(text);
  if (exitCode !== undefined) {
    return exitCode === 0;
  }
  return statusOutcome(text.trim());
}

function exitCodeFromText(text) {
  const normalized = lower(text);
  let offset = 0;
  while (offset < normalized.length) {
    const index = normalized.indexOf("code", offset);
    if (index === -1) {
      return;
    }
    const parsed = integerAfter(normalized, index + "code".length);
    if (parsed !== undefined && textMentionsExit(normalized, index)) {
      return parsed;
    }
    offset = index + 1;
  }
}

function textMentionsExit(text, codeIndex) {
  const windowStart = Math.max(0, codeIndex - 24);
  const prefix = text.slice(windowStart, codeIndex);
  return prefix.includes("exit") || prefix.includes("exited");
}

function integerAfter(text, startIndex) {
  let index = startIndex;
  while (index < text.length && isIgnoredBetweenCodeAndNumber(text[index])) {
    index += 1;
  }
  let sign = 1;
  if (text[index] === "-") {
    sign = -1;
    index += 1;
  }
  let digits = "";
  while (index < text.length && isDigit(text[index])) {
    digits += text[index];
    index += 1;
  }
  return digits ? Number(digits) * sign : undefined;
}

function childValues(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return Object.values(value);
}

function toolName(payload) {
  return typeof payload?.tool_name === "string" ? payload.tool_name : "";
}

function countTerm(message, term) {
  return lower(message).split(term).length - 1;
}

function splitWords(message) {
  const words = [];
  let current = "";
  for (const char of lower(message)) {
    if (isWhitespace(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function successfulCommandEvidence(item) {
  return item.kind === "verified-command" || item.kind === "successful-command";
}

function successfulAtlasEvidence(item) {
  return item.kind === "code-atlas-query" && item.outcome === "success";
}

function mentionsCodeAtlas(message) {
  const normalized = lower(message);
  return (
    normalized.includes("code atlas") ||
    normalized.includes("code-atlas") ||
    normalized.includes("code_atlas")
  );
}

function isIgnoredBetweenCodeAndNumber(char) {
  return (
    char === " " || char === "\n" || char === "\r" || char === "\t" || char === ":" || char === "="
  );
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}
