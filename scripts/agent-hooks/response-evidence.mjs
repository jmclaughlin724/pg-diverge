export function finalMessage(payload) {
  return typeof payload?.last_assistant_message === "string" ? payload.last_assistant_message : "";
}

export function toolSucceeded(payload) {
  if (payload?.hook_event_name === "PostToolUseFailure") {
    return false;
  }
  const response = payload?.tool_response;
  if (!(response && typeof response === "object" && !Array.isArray(response))) {
    return;
  }
  for (const field of ["exit_code", "exitCode", "code"]) {
    if (typeof response[field] === "number") {
      return response[field] === 0;
    }
  }
  for (const field of ["is_error", "isError"]) {
    if (typeof response[field] === "boolean") {
      return !response[field];
    }
  }
  if (typeof response.interrupted === "boolean") {
    return !response.interrupted;
  }
  for (const field of ["success", "ok"]) {
    if (typeof response[field] === "boolean") {
      return response[field];
    }
  }
  for (const field of ["status", "outcome"]) {
    const outcome = structuredStatus(response[field]);
    if (outcome !== undefined) {
      return outcome;
    }
  }
}

function structuredStatus(value) {
  if (typeof value !== "string") {
    return;
  }
  switch (value.toLowerCase()) {
    case "complete":
    case "completed":
    case "ok":
    case "success":
      return true;
    case "canceled":
    case "cancelled":
    case "error":
    case "failed":
    case "failure":
      return false;
    default:
      return;
  }
}
