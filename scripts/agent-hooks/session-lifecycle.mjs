import { runHookEntrypoint } from "./hook-entrypoint.mjs";
import { shapeHookResult, shapeSessionStateFailure } from "./hook-output.mjs";
import { clearSessionState, refreshSessionState } from "./state.mjs";

const sessionStartContracts = {
  claude: {
    modelRequired: false,
    permissionModeRequired: false,
    permissionModes: new Set([
      "default",
      "acceptEdits",
      "plan",
      "dontAsk",
      "bypassPermissions",
      "auto",
    ]),
    sources: new Set(["startup", "resume", "clear", "compact", "fork"]),
  },
  codex: {
    modelRequired: true,
    permissionModeRequired: true,
    permissionModes: new Set(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]),
    sources: new Set(["startup", "resume", "clear", "compact"]),
  },
};

export function runSessionLifecycleEvent(eventName, options = {}) {
  runHookEntrypoint(eventName, handleSessionLifecycleEvent, {
    ...options,
    validatePayload: validateLifecyclePayload,
  });
}

export function handleSessionLifecycleEvent(eventName, payload, options = {}) {
  const runtime = options.runtime ?? "claude";
  const hookPath = options.hookPath ?? "scripts/agent-hooks/session-lifecycle.mjs";
  try {
    if (eventName === "SessionStart") {
      refreshSessionState(payload);
    } else if (eventName === "SessionEnd") {
      clearSessionState(payload);
    } else {
      throw new Error(`unsupported session lifecycle event: ${eventName}`);
    }
    return shapeHookResult(eventName, {}, runtime);
  } catch (error) {
    return shapeSessionStateFailure(eventName, error, { hookPath, runtime });
  }
}

function validateLifecyclePayload(payload, runtime, eventName) {
  requireNonEmptyString(payload, "session_id");
  requireNullableString(payload, "transcript_path");
  requireNonEmptyString(payload, "cwd");
  if (payload.hook_event_name !== eventName) {
    throw new Error(`hook input field "hook_event_name" must equal "${eventName}"`);
  }
  if (eventName !== "SessionStart") {
    return;
  }
  const contract = sessionStartContracts[runtime] ?? sessionStartContracts.codex;
  if (contract.modelRequired) {
    requireNonEmptyString(payload, "model");
  }
  requireEnum(
    payload,
    "permission_mode",
    contract.permissionModes,
    contract.permissionModeRequired
  );
  requireEnum(payload, "source", contract.sources, true);
}

function requireEnum(payload, field, allowed, required) {
  if (!required && payload[field] === undefined) {
    return;
  }
  if (!allowed.has(payload[field])) {
    throw new Error(`hook input field "${field}" has an unsupported value`);
  }
}

function requireNonEmptyString(payload, field) {
  if (typeof payload[field] !== "string" || payload[field].length === 0) {
    throw new Error(`hook input field "${field}" must be a non-empty string`);
  }
}

function requireNullableString(payload, field) {
  if (payload[field] !== null && typeof payload[field] !== "string") {
    throw new Error(`hook input field "${field}" must be a string or null`);
  }
}
