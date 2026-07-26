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

export function validateSessionStartPayload(payload, runtime) {
  const contract = sessionStartContracts[runtime] ?? sessionStartContracts.codex;
  requireNonEmptyString(payload, "session_id");
  requireNullableString(payload, "transcript_path");
  requireNonEmptyString(payload, "cwd");
  if (payload.hook_event_name !== "SessionStart") {
    throw new Error('hook input field "hook_event_name" must equal "SessionStart"');
  }
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
