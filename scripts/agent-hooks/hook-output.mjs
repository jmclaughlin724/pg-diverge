const modelContextEvents = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "Stop",
  "SubagentStop",
]);

const decisionBlockEvents = new Set(["UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"]);

const exitTwoBlockEvents = new Set(["TaskCompleted", "PermissionDenied"]);

export function shapeHookResult(eventName, result = {}, runtime = "claude") {
  const output = {};
  const context = joinParts(result.contextParts);
  let exitCode = 0;
  let stderr = "";

  if (context && modelContextEvents.has(eventName)) {
    output.hookSpecificOutput = {
      ...(output.hookSpecificOutput ?? {}),
      additionalContext: context,
      hookEventName: eventName,
    };
  }

  if (result.systemMessage) {
    output.systemMessage = result.systemMessage;
  }

  const preToolPermissionReason =
    eventName === "PreToolUse" ? joinMessages(result.deny, result.block) : result.deny;

  if (preToolPermissionReason) {
    output.hookSpecificOutput = {
      ...(output.hookSpecificOutput ?? {}),
      hookEventName: eventName,
      permissionDecision: "deny",
      permissionDecisionReason: preToolPermissionReason,
    };
  }

  if (result.block && eventName !== "PreToolUse") {
    if (exitTwoBlockEvents.has(eventName)) {
      exitCode = 2;
      stderr = result.block;
    } else if (decisionBlockEvents.has(eventName)) {
      output.decision = "block";
      output.reason = result.block;
    } else {
      output.systemMessage = result.block;
    }
  }

  if (runtime === "codex" && (eventName === "Stop" || eventName === "SubagentStop")) {
    return shaped(output, exitCode, stderr, true);
  }

  return shaped(output, exitCode, stderr, false);
}

export function failClosedResult(eventName, error, checkName = "unknown") {
  return {
    block: structuredError(eventName, checkName, error),
  };
}

export function runChecks(eventName, payload, checks, context = {}) {
  const aggregate = {
    contextParts: [],
  };

  for (const check of checks) {
    try {
      mergeResult(aggregate, check(payload, context) ?? {});
    } catch (error) {
      return failClosedResult(eventName, error, check.name || "anonymous");
    }
  }

  return aggregate;
}

export function mergeResult(target, addition) {
  if (Array.isArray(addition.contextParts)) {
    target.contextParts.push(...addition.contextParts.filter(Boolean));
  }
  for (const key of ["block", "deny", "systemMessage"]) {
    if (addition[key]) {
      target[key] = joinMessages(target[key], addition[key]);
    }
  }
  return target;
}

export function structuredError(eventName, checkName, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "";
  const source =
    stack
      .split("\n")
      .find((line) => line.includes(".mjs"))
      ?.trim() ?? "unknown";
  return [
    "Agent hook failed closed.",
    `event=${eventName}`,
    `check=${checkName}`,
    `source=${source}`,
    `error=${message}`,
    stack ? `stack=${stack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function shaped(output, exitCode, stderr, forceJson) {
  const hasOutput = Object.keys(output).length > 0;
  return {
    exitCode,
    output,
    stderr,
    stdout: hasOutput || forceJson ? `${JSON.stringify(output)}\n` : "",
  };
}

function joinParts(parts) {
  return (parts ?? []).filter(Boolean).join("\n\n---\n\n");
}

function joinMessages(...messages) {
  return [...new Set(messages.filter(Boolean))].join("\n\n");
}
