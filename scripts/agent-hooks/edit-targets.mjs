export function editTargetStrings(payload) {
  const input = payload?.tool_input ?? {};
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (toolName === "apply_patch") {
    const source = typeof input.command === "string" ? input.command : "";
    return parseApplyPatch(source).flatMap((operation) =>
      operation.moveTo ? [operation.path, operation.moveTo] : [operation.path]
    );
  }
  if (toolName === "NotebookEdit") {
    return typeof input.notebook_path === "string" ? [input.notebook_path] : [];
  }
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "Write") {
    return typeof input.file_path === "string" ? [input.file_path] : [];
  }
  return [];
}

export function governedToolTargetStrings(payload) {
  const editTargets = editTargetStrings(payload);
  if (editTargets.length > 0) {
    return editTargets;
  }
  const input = payload?.tool_input ?? {};
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (toolName === "Read") {
    return typeof input.file_path === "string" ? [input.file_path] : [];
  }
  if (toolName === "Glob" || toolName === "Grep") {
    return typeof input.path === "string" ? [input.path] : [];
  }
  return [];
}

export function parseApplyPatch(source) {
  const lines = String(source ?? "").split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim().length === 0) {
    last -= 1;
  }
  if (first < 0 || lines[first] !== "*** Begin Patch" || lines[last] !== "*** End Patch") {
    return [];
  }
  const operations = [];
  let current;
  for (let index = first + 1; index < last; index += 1) {
    const directive = patchDirective(lines[index]);
    if (!directive) {
      continue;
    }
    if (directive.kind === "move") {
      if (current?.kind !== "update") {
        return [];
      }
      current.moveTo = directive.path;
      continue;
    }
    current = directive;
    operations.push(current);
  }
  return operations;
}

function patchDirective(line) {
  const add = directivePath(line, "*** Add File: ");
  if (add) {
    return { kind: "add", path: add };
  }
  const update = directivePath(line, "*** Update File: ");
  if (update) {
    return { kind: "update", path: update };
  }
  const remove = directivePath(line, "*** Delete File: ");
  if (remove) {
    return { kind: "delete", path: remove };
  }
  const move = directivePath(line, "*** Move to: ");
  return move ? { kind: "move", path: move } : undefined;
}

function directivePath(line, prefix) {
  if (!line.startsWith(prefix)) {
    return "";
  }
  return line.slice(prefix.length).trim();
}
