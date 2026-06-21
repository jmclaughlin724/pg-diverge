const commandToolNames = ["Bash", "functions.exec_command", "exec_command"];

export function toolName(payload) {
  return typeof payload?.tool_name === "string" ? payload.tool_name : "";
}

export function toolCommand(payload) {
  const input = payload?.tool_input ?? {};
  for (const key of ["command", "cmd"]) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }
  return "";
}

export function isCommandTool(name) {
  return commandToolNames.includes(name);
}

export function toolResponse(payload) {
  return (
    payload?.tool_response ?? payload?.tool_output ?? payload?.tool_result ?? payload?.response
  );
}
