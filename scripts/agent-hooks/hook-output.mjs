import path from "node:path";

const modelContextEvents = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
]);

const decisionBlockEvents = new Set(["UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"]);

const exitTwoBlockEvents = new Set(["TaskCompleted", "WorktreeCreate"]);
const maxDiagnosticValueLength = 800;
const sourceExtensions = [".cjs", ".js", ".mjs", ".ts"];

export function shapeHookResult(eventName, result = {}, runtime = "claude") {
  const output = {};
  const context = joinParts(result.contextParts);
  let exitCode = 0;
  let stderr = "";
  const supportsModelContext = modelContextEvents.has(eventName);

  if (context && supportsModelContext) {
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

const defaultRemediation = [
  "The check crashed; it did not deny this action. Hook enforcement is degraded and fail-closed.",
  "Fix the error at the reported source, then retry.",
  "While degraded, only Read, Edit, Write, and MultiEdit on scripts/agent-hooks, .claude/hooks, and .codex/hooks are permitted so the runtime can repair itself; every other tool call is denied.",
  "If those repairs are also unavailable, fix the file outside the hook path: run the command yourself with the `!` prefix, or edit it in an external editor.",
].join(" ");

const hookRuntimeDirectories = [
  path.join("scripts", "agent-hooks"),
  path.join(".claude", "hooks"),
  path.join(".codex", "hooks"),
];

const hookRepairToolNames = new Set(["Read", "Edit", "Write", "MultiEdit"]);

function hookRuntimeRepairTarget(payload, root) {
  if (!(hookRepairToolNames.has(payload?.tool_name) && typeof root === "string" && root)) {
    return;
  }
  const candidate = payload?.tool_input?.file_path;
  if (typeof candidate !== "string" || !candidate) {
    return;
  }
  const relative = path.relative(root, path.resolve(root, candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return;
  }
  const owned = hookRuntimeDirectories.some(
    (directory) => relative === directory || relative.startsWith(`${directory}${path.sep}`)
  );
  return owned ? relative : undefined;
}

export function failClosedResult(eventName, error, checkName = "unknown", details = {}) {
  const diagnostic = structuredError(eventName, checkName, error, details);
  const repairTarget =
    eventName === "PreToolUse" ? hookRuntimeRepairTarget(details.payload, details.root) : undefined;
  if (repairTarget === undefined) {
    return { block: diagnostic };
  }
  const degraded = [
    diagnostic,
    "",
    `Permitted as hook-runtime repair: ${diagnosticValue(repairTarget)}`,
    "Boundary enforcement is NOT running for this call. Repair the crash before resuming other work.",
  ].join("\n");
  return { contextParts: [degraded], systemMessage: degraded };
}

export function runChecks(eventName, payload, checks, context = {}) {
  const aggregate = {
    contextParts: [],
  };

  for (const check of checks) {
    try {
      mergeResult(aggregate, check(payload, context) ?? {});
    } catch (error) {
      return failClosedResult(eventName, error, check.name || "anonymous", {
        hookPath: context.hookPath,
        payload,
        root: context.root,
        runtime: context.runtime,
      });
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

export function structuredError(eventName, checkName, error, details = {}) {
  const message = diagnosticValue(error instanceof Error ? error.message : String(error));
  const hookPath = diagnosticValue(details.hookPath ?? "unknown");
  const remediation = diagnosticValue(details.remediation ?? defaultRemediation);
  return [
    "Agent hook failed closed.",
    `runtime=${diagnosticValue(details.runtime ?? "unknown")}`,
    `event=${eventName}`,
    `hook=${hookPath}`,
    `check=${checkName}`,
    `source=${sourceLocation(error)}`,
    `error=${message}`,
    `remediation=${remediation}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function writeHookResult(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`);
  }
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

function diagnosticValue(value) {
  let normalized = "";
  let previousWasWhitespace = false;
  for (const character of String(value)) {
    const isWhitespace = character.trim().length === 0;
    if (!isWhitespace) {
      normalized += character;
    } else if (!previousWasWhitespace) {
      normalized += " ";
    }
    previousWasWhitespace = isWhitespace;
  }
  return normalized.trim().slice(0, maxDiagnosticValueLength);
}

function sourceLocation(error) {
  const stack = error instanceof Error && error.stack ? error.stack : "";
  for (const line of stack.split("\n").slice(1)) {
    const candidate = stackLocation(line);
    if (candidate) {
      return diagnosticValue(candidate);
    }
  }
  return "unknown";
}

function stackLocation(line) {
  let candidate = line.trim();
  if (candidate.endsWith(")")) {
    candidate = candidate.slice(0, -1);
  }
  const columnSeparator = candidate.lastIndexOf(":");
  const lineSeparator = candidate.lastIndexOf(":", columnSeparator - 1);
  if (columnSeparator < 0 || lineSeparator < 0) {
    return;
  }
  const column = candidate.slice(columnSeparator + 1);
  const lineNumber = candidate.slice(lineSeparator + 1, columnSeparator);
  if (!(isDecimal(lineNumber) && isDecimal(column))) {
    return;
  }
  let source = candidate.slice(0, lineSeparator);
  const openParenthesis = source.lastIndexOf("(");
  if (openParenthesis >= 0) {
    source = source.slice(openParenthesis + 1);
  } else if (source.startsWith("at ")) {
    source = source.slice(3);
  }
  if (source.startsWith("file://")) {
    source = source.slice("file://".length);
  }
  if (!sourceExtensions.some((extension) => source.endsWith(extension))) {
    return;
  }
  return `${source}:${lineNumber}:${column}`;
}

function isDecimal(value) {
  return value.length > 0 && [...value].every((character) => character >= "0" && character <= "9");
}
