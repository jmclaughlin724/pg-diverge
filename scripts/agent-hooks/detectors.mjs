import fs from "node:fs";
import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { codeAtlasQueryEvidence } from "./atlas.mjs";
import { isSubagentInvocation } from "./skills.mjs";
import { addEvidence, currentTurnState, setCorrections } from "./state.mjs";

const verificationWords = ["verified", "tested", "passed", "green", "clean"];
const completionWords = ["completed", "finished", "done", "implemented", "fixed"];
const hedgeWords = ["maybe", "probably", "possibly", "likely", "might", "could", "seems"];
const deferralTerms = ["if you want", "would you like", "i can ", "i could ", "let me know"];
const menuTerms = ["option 1", "option a", "choose", "which approach", "pick one"];
const directTerms = ["execute", "implement", "fix", "update", "do it", "make the change"];
const diagnosticPromptTerms = [
  "why",
  "verify",
  "source",
  "correct",
  "expected",
  "supposed to",
  "redundant",
  "best practice",
  "upstream",
  "review",
  "architecture",
  "design",
  "working correctly",
  "enforce",
  "logic chain",
];
const mechanismClaimTerms = [
  "as designed",
  "documented",
  "expected",
  "correct",
  "running correctly",
  "supposed to be",
  "upstream says",
  "valid behavior",
  "working correctly",
];
const architectureDispositionTerms = [
  "$elegant",
  "architecture",
  "canonical",
  "end state",
  "entry point",
  "local design",
  "owner",
  "topology",
];
const verificationDispositionTerms = [
  "checked",
  "command",
  "evidence",
  "failed",
  "guard",
  "not run",
  "passed",
  "skipped",
  "source",
  "test",
  "verified",
];

export function recordToolEvidence(payload, state) {
  const name = toolName(payload);
  const command = toolCommand(payload);
  const atlasEvidence = codeAtlasQueryEvidence(payload);
  if (!((isCommandTool(name) && command) || atlasEvidence)) {
    return {};
  }
  const toolSuccess = toolSucceeded(payload);
  if (toolSuccess === undefined) {
    return {};
  }
  if (atlasEvidence) {
    addEvidence(state, {
      ...atlasEvidence,
      outcome: toolSuccess ? "success" : "failure",
      summary: toolSuccess ? "Code Atlas query succeeded" : "Code Atlas query failed",
    });
  }
  if (!(isCommandTool(name) && command)) {
    return {};
  }
  const domains = classifyCommandDomains(command);
  if (domains.length === 0) {
    return {};
  }
  const success = commandEvidenceSucceeded(toolSuccess, domains, payload);
  addEvidence(state, {
    command,
    domains,
    kind: success ? "verified-command" : "failed-command",
    outcome: success ? "success" : "failure",
    summary: success ? "verification command succeeded" : "verification command failed",
  });
  return {};
}

export function runResponseDetectors(payload, state) {
  const message = finalMessage(payload);
  const findings = [
    hedgeDensity(message),
    completionClaimWithOpenItems(message, payload, state),
    claimWithoutEvidence(message, state, transcriptEvidence(payload)),
    mechanismClaimWithoutArchitecture(message, state),
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
    [
      "claim-without-evidence",
      "mechanism-claim-without-architecture",
      "tool-failure-without-retry",
    ].includes(item.id)
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
  if (!claimsVerification) {
    return;
  }
  const evidenceItems = [...currentTurnState(state).evidence, ...transcript];
  const requiredDomains = claimRequiredDomains(message, state);
  const missingDomains = requiredDomains.filter(
    (domain) => !hasSuccessfulDomainEvidence(evidenceItems, domain)
  );
  if (missingDomains.length > 0) {
    return {
      id: "claim-without-evidence",
      message: `The response claims verification without recorded successful evidence for: ${missingDomains.join(", ")}.`,
    };
  }
  const evidence =
    evidenceItems.some(successfulCommandEvidence) ||
    (mentionsCodeAtlas(message) && evidenceItems.some(successfulAtlasEvidence));
  if (!evidence) {
    return {
      id: "claim-without-evidence",
      message:
        "The response claims verification without a recorded successful verification command.",
    };
  }
  const unresolved = unresolvedFailures(evidenceItems);
  if (unresolved.length > 0) {
    return {
      id: "claim-without-evidence",
      message: `The response claims verification while failed evidence remains unresolved for: ${failureLabels(unresolved).join(", ")}.`,
    };
  }
}

export function mechanismClaimWithoutArchitecture(message, state) {
  const response = lower(message);
  const turn = currentTurnState(state);
  const prompt = lower(turn.lastPrompt);
  const diagnosticPrompt = diagnosticPromptTerms.some((term) => prompt.includes(term));
  const mechanismClaim = mechanismClaimTerms.some((term) => response.includes(term));
  if (!(diagnosticPrompt || mechanismClaim)) {
    return;
  }
  const hasArchitectureDisposition = architectureDispositionTerms.some((term) =>
    response.includes(term)
  );
  const hasVerificationDisposition = verificationDispositionTerms.some((term) =>
    response.includes(term)
  );
  if (hasArchitectureDisposition && hasVerificationDisposition) {
    return;
  }
  const missing = [];
  if (!hasArchitectureDisposition) {
    missing.push("architecture/end-state disposition");
  }
  if (!hasVerificationDisposition) {
    missing.push("verification disposition");
  }
  return {
    id: "mechanism-claim-without-architecture",
    message: `The response handles mechanism or correctness without ${missing.join(" and ")}.`,
  };
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
  const unresolved = unresolvedFailures(evidence);
  if (unresolved.length === 0) {
    return;
  }
  return {
    id: "tool-failure-without-retry",
    message: `A verification command failed and no later successful verification evidence for the same command or domain is recorded: ${failureLabels(unresolved).join(", ")}.`,
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
      .map((entry) => {
        const command = transcriptCommand(entry);
        const domains = classifyCommandDomains(command);
        return command && domains.length > 0
          ? {
              command,
              domains,
              kind: "verified-command",
              outcome: "success",
              summary: String(entry.tool_name ?? "tool_result"),
            }
          : undefined;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function transcriptCommand(entry) {
  if (typeof entry?.tool_input?.command === "string") {
    return entry.tool_input.command;
  }
  if (typeof entry?.tool_input?.cmd === "string") {
    return entry.tool_input.cmd;
  }
  return "";
}

function commandEvidenceSucceeded(toolSuccess, domains, payload) {
  if (!toolSuccess) {
    return false;
  }
  if (domains.includes("github-checks") && responseReportsFailure(payload)) {
    return false;
  }
  return true;
}

function claimRequiredDomains(message, state) {
  const text = lower(`${currentTurnState(state).lastPrompt}\n${message}`);
  const words = new Set(splitWords(text).map(cleanWord).filter(Boolean));
  const domains = new Set();
  if (
    words.has("github") ||
    text.includes("pull request") ||
    words.has("pr") ||
    words.has("ci") ||
    text.includes("statuscheck") ||
    text.includes("status check") ||
    text.includes("checkrollup") ||
    words.has("checks") ||
    (words.has("branch") && words.has("green")) ||
    (words.has("green") && (words.has("check") || words.has("checks")))
  ) {
    domains.add("github-checks");
  }
  if (words.has("guard") || words.has("guards") || text.includes("guard:")) {
    domains.add("guard");
  }
  if (words.has("test") || words.has("tests") || words.has("tested")) {
    domains.add("test");
  }
  if (text.includes("typecheck") || text.includes("type check")) {
    domains.add("typecheck");
  }
  if (words.has("lint") || words.has("linted")) {
    domains.add("lint");
  }
  if (words.has("docs")) {
    domains.add("docs");
  }
  if (words.has("package") || words.has("pack")) {
    domains.add("package");
  }
  return [...domains];
}

function hasSuccessfulDomainEvidence(evidenceItems, domain) {
  const lastFailure = [...evidenceItems]
    .reverse()
    .find((item) => isActionableFailure(item) && itemDomains(item).includes(domain));
  return evidenceItems.some(
    (item) =>
      successfulCommandEvidence(item) &&
      itemDomains(item).includes(domain) &&
      isLaterThanFailure(item, lastFailure)
  );
}

function unresolvedFailures(evidence) {
  return evidence
    .filter(isActionableFailure)
    .filter((failure) => !failureHasLaterSuccess(failure, evidence));
}

function failureHasLaterSuccess(failure, evidence) {
  return evidence.some(
    (item) =>
      successfulCommandEvidence(item) && item.at > failure.at && sameEvidenceScope(failure, item)
  );
}

function sameEvidenceScope(failure, success) {
  const failureDomains = itemDomains(failure);
  const successDomains = itemDomains(success);
  if (failureDomains.length > 0 && successDomains.length > 0) {
    return failureDomains.some((domain) => successDomains.includes(domain));
  }
  return Boolean(failure.command && success.command && failure.command === success.command);
}

function itemDomains(item) {
  return Array.isArray(item?.domains)
    ? item.domains.filter((domain) => typeof domain === "string")
    : [];
}

function isLaterThanFailure(item, failure) {
  return !failure || (item.at && failure.at && item.at > failure.at);
}

function failureLabels(failures) {
  return [...new Set(failures.map(failureLabel))];
}

function failureLabel(item) {
  const domains = itemDomains(item);
  if (domains.length > 0) {
    return domains.join("+");
  }
  return item.command ? `command:${item.command}` : "unknown";
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

function classifyCommandDomains(command) {
  const domains = new Set();
  let segments = [];
  try {
    segments = commandSegmentObjects(command);
  } catch {
    segments = [];
  }
  for (const segment of segments) {
    const tokens = segment.words ?? [];
    const name = commandName(tokens);
    const args = commandArgs(tokens);
    addSegmentDomains(domains, name, args);
  }
  return [...domains];
}

function addSegmentDomains(domains, name, args) {
  if (name === "gh") {
    addGithubDomains(domains, args);
    return;
  }
  if (name === "npm") {
    addNpmDomains(domains, args);
    return;
  }
  if (["vitest", "jest", "mocha", "node"].includes(name)) {
    addToolDomains(domains, name, args);
  }
}

function addGithubDomains(domains, args) {
  if (
    (args[0] === "pr" && ["checks", "status"].includes(args[1] ?? "")) ||
    (args[0] === "pr" &&
      args[1] === "view" &&
      args.some((arg) => arg.includes("statusCheckRollup"))) ||
    (args[0] === "run" && ["view", "watch", "list"].includes(args[1] ?? "")) ||
    (args[0] === "api" &&
      args.some(
        (arg) =>
          arg.includes("/actions/") || arg.includes("/check-runs") || arg.includes("/commits/")
      ))
  ) {
    domains.add("github-checks");
  }
}

function addNpmDomains(domains, args) {
  if (args[0] === "pack") {
    domains.add("package");
    return;
  }
  if (args[0] !== "run") {
    return;
  }
  const script = args.find((arg, index) => index > 0 && !arg.startsWith("-")) ?? "";
  if (!script) {
    return;
  }
  if (script === "guard" || script.startsWith("guard:")) {
    domains.add("guard");
  }
  if (script === "test" || script.includes("test") || script.includes("vitest")) {
    domains.add("test");
  }
  if (script.includes("typecheck")) {
    domains.add("typecheck");
  }
  if (script.includes("lint")) {
    domains.add("lint");
  }
  if (script.startsWith("docs:")) {
    domains.add("docs");
  }
  if (script.includes("package") || script.includes("pack")) {
    domains.add("package");
  }
  if (script.startsWith("sync:")) {
    domains.add("sync");
  }
  if (script === "build") {
    domains.add("build");
  }
  if (script.startsWith("code-atlas")) {
    domains.add("code-atlas");
  }
}

function addToolDomains(domains, name, args) {
  if (["vitest", "jest", "mocha"].includes(name)) {
    domains.add("test");
  }
  if (name === "node" && args.some((arg) => arg.includes("vitest"))) {
    domains.add("test");
  }
  if (name === "node" && args.some((arg) => arg.includes("scripts/guards/"))) {
    domains.add("guard");
  }
  if (name === "node" && args.some((arg) => arg.includes("scripts/skills/sync-llm.mjs"))) {
    domains.add("sync");
  }
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

function toolResponseText(payload) {
  const response =
    payload?.tool_response ?? payload?.tool_output ?? payload?.tool_result ?? payload?.response;
  return collectText(response).join("\n");
}

function collectText(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectText);
  }
  return Object.values(value).flatMap(collectText);
}

function responseReportsFailure(payload) {
  const response =
    payload?.tool_response ?? payload?.tool_output ?? payload?.tool_result ?? payload?.response;
  const structured = structuredGithubFailure(response);
  if (structured !== undefined) {
    return structured;
  }
  return textGithubFailure(toolResponseText(payload));
}

function structuredGithubFailure(value) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const parsed = jsonValue(value);
    return parsed === undefined ? undefined : structuredGithubFailure(parsed);
  }
  if (typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    return aggregateGithubFailure(value.map(structuredGithubFailure));
  }
  for (const key of ["statusCheckRollup", "checkRuns", "checks", "jobs"]) {
    if (Array.isArray(value[key])) {
      return aggregateGithubFailure(value[key].map(structuredGithubFailure));
    }
  }
  const status = githubStatusValue(value);
  if (status !== undefined) {
    return status;
  }
  return aggregateGithubFailure(Object.values(value).map(structuredGithubFailure));
}

function aggregateGithubFailure(results) {
  if (results.includes(true)) {
    return true;
  }
  return results.includes(false) ? false : undefined;
}

function githubStatusValue(value) {
  for (const key of ["conclusion", "state", "status"]) {
    if (typeof value?.[key] !== "string") {
      continue;
    }
    const normalized = lower(value[key]);
    if (
      ["action_required", "error", "failed", "failure", "startup_failure", "timed_out"].includes(
        normalized
      )
    ) {
      return true;
    }
    if (
      [
        "cancelled",
        "canceled",
        "completed",
        "neutral",
        "pending",
        "queued",
        "skipped",
        "success",
      ].includes(normalized)
    ) {
      return false;
    }
  }
}

function textGithubFailure(text) {
  for (const line of splitLines(text)) {
    const fields = line
      .split("\t")
      .map((field) => lower(field.trim()))
      .filter(Boolean);
    if (
      fields.some(
        (field, index) =>
          index > 0 &&
          [
            "fail",
            "failed",
            "failure",
            "error",
            "startup_failure",
            "timed_out",
            "action_required",
          ].includes(field)
      )
    ) {
      return true;
    }
  }
  return false;
}

function jsonValue(text) {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return;
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
  const exitCode = exitCodeFromExecutionStatus(text);
  if (exitCode !== undefined) {
    return exitCode === 0;
  }
  return statusOutcome(text.trim());
}

function exitCodeFromExecutionStatus(text) {
  for (const rawLine of splitLines(text)) {
    const parsed = exitCodeFromStatusLine(rawLine);
    if (parsed !== undefined) {
      return parsed;
    }
  }
}

function exitCodeFromStatusLine(line) {
  const normalized = lower(line.trim());
  if (!normalized || normalized.includes("exitcode")) {
    return;
  }
  if (normalized.startsWith("exit code")) {
    return integerAfter(normalized, "exit code".length);
  }
  if (normalized.startsWith("exited with code")) {
    return integerAfter(normalized, "exited with code".length);
  }
  const phrase = " exited with code";
  const index = normalized.indexOf(phrase);
  if (index > 0 && isExecutionStatusLabel(normalized.slice(0, index))) {
    return integerAfter(normalized, index + phrase.length);
  }
}

function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") {
      continue;
    }
    lines.push(trimTrailingCarriageReturn(text.slice(start, index)));
    start = index + 1;
  }
  lines.push(trimTrailingCarriageReturn(text.slice(start)));
  return lines;
}

function trimTrailingCarriageReturn(text) {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

function isExecutionStatusLabel(label) {
  if (!label || label.includes("exitcode")) {
    return false;
  }
  for (const char of label) {
    if (!isStatusLabelCharacter(char)) {
      return false;
    }
  }
  return true;
}

function isStatusLabelCharacter(char) {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "." ||
    char === "_" ||
    char === "-" ||
    char === ":"
  );
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

function cleanWord(value) {
  let start = 0;
  let end = value.length;
  while (start < end && !isWordCharacter(value[start])) {
    start += 1;
  }
  while (end > start && !isWordCharacter(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isWordCharacter(char) {
  return (
    (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "_" || char === "-"
  );
}

function successfulCommandEvidence(item) {
  return (
    (item.kind === "verified-command" || item.kind === "successful-command") &&
    item.outcome !== "failure"
  );
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
