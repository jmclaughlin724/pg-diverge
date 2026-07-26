const githubFailureStates = new Set([
  "action_required",
  "error",
  "failed",
  "failure",
  "startup_failure",
  "timed_out",
]);
const githubPendingStates = new Set(["in_progress", "pending", "queued", "requested", "waiting"]);
const githubNonFailureStates = new Set([
  "cancelled",
  "canceled",
  "completed",
  "neutral",
  "skipped",
  "success",
]);
const shellErrorPrefixes = ["bash:", "dash:", "fish:", "sh:", "zsh:"];
const windowsCommandNotFoundPhrases = [
  "is not recognized as an internal or external command",
  "is not recognized as the name of a cmdlet",
];

export function lower(value) {
  return String(value ?? "").toLowerCase();
}

export function finalMessage(payload) {
  return typeof payload?.last_assistant_message === "string" ? payload.last_assistant_message : "";
}

export function toolSucceeded(payload) {
  if (payload?.hook_event_name === "PostToolUseFailure") {
    return false;
  }
  const response = payload?.tool_response;
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
}

export function responseReportsFailure(payload) {
  const response = payload?.tool_response;
  const structured = structuredGithubFailure(response);
  if (structured !== undefined) {
    return structured;
  }
  return textGithubFailure(toolResponseText(payload));
}

export function shellCommandNotFound(payload) {
  const error = typeof payload?.error === "string" ? payload.error : "";
  const failureText = [error, toolResponseText(payload)].filter(Boolean).join("\n");
  return failureText.split("\n").some((line) => {
    const normalized = lower(line).trimStart();
    const shellName = normalized.slice(normalized.lastIndexOf("/") + 1);
    return (
      (shellErrorPrefixes.some((prefix) => shellName.startsWith(prefix)) &&
        normalized.includes("command not found")) ||
      windowsCommandNotFoundPhrases.some((phrase) => normalized.includes(phrase))
    );
  });
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
  const hard = findHardOutcome(value);
  if (hard !== undefined) {
    return hard;
  }
  return findSoftOutcome(value);
}

function toolResponseText(payload) {
  return collectText(payload?.tool_response).join("\n");
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
    if (githubFailureStates.has(normalized) || githubPendingStates.has(normalized)) {
      return true;
    }
    if (githubNonFailureStates.has(normalized)) {
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
          (index > 0 && githubFailureStates.has(field)) ||
          githubPendingStates.has(field) ||
          field === "fail"
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
    // Non-JSON command output has no structured response evidence.
  }
}

function findHardOutcome(value, depth = 0) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const exitCode = exitCodeFromExecutionStatus(value);
    if (exitCode !== undefined) {
      return exitCode === 0;
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  for (const key of ["exit_code", "exitCode", "exit_code_or_signal", "code"]) {
    if (typeof value[key] === "number") {
      return value[key] === 0;
    }
  }
  if (depth === 0) {
    for (const key of ["is_error", "isError"]) {
      if (typeof value[key] === "boolean") {
        return !value[key];
      }
    }
  }
  if (typeof value.interrupted === "boolean" && value.interrupted) {
    return false;
  }
  for (const child of childValues(value)) {
    const outcome = findHardOutcome(child, depth + 1);
    if (outcome !== undefined) {
      return outcome;
    }
  }
}

function findSoftOutcome(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return;
  }
  for (const key of ["success", "ok"]) {
    if (typeof value[key] === "boolean") {
      return value[key];
    }
  }
  for (const key of ["status", "outcome"]) {
    if (typeof value[key] === "string") {
      const result = statusOutcome(value[key]);
      if (result !== undefined) {
        return result;
      }
    }
  }
  for (const child of childValues(value)) {
    const outcome = findSoftOutcome(child);
    if (outcome !== undefined) {
      return outcome;
    }
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

function isIgnoredBetweenCodeAndNumber(char) {
  return (
    char === " " || char === "\n" || char === "\r" || char === "\t" || char === ":" || char === "="
  );
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}
