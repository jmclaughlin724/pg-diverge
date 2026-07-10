import path from "node:path";

const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

export function payloadPaths(payload, root) {
  const input = payload?.tool_input ?? {};
  const out = [];
  const name = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (
    ["Edit", "MultiEdit", "Read", "Write"].includes(name) &&
    typeof input.file_path === "string"
  ) {
    out.push(repoRelative(input.file_path, root));
  }
  if (name === "NotebookEdit" && typeof input.notebook_path === "string") {
    out.push(repoRelative(input.notebook_path, root));
  }
  if (name === "apply_patch" && typeof input.command === "string") {
    out.push(...patchPaths(input.command, root));
  }
  if (name.startsWith("mcp__")) {
    out.push(...deepPathStrings(input, root));
  }
  return unique(out.filter(Boolean));
}

export function pathMatches(trigger, candidate) {
  if (trigger.endsWith("/**")) {
    return candidate.startsWith(trigger.slice(0, -3));
  }
  return trigger === candidate;
}

export function skillFromSkillPath(value, root) {
  const normalized = repoRelative(value, root);
  const parts = normalized.split("/");
  const index = parts.lastIndexOf("skills");
  if (index === -1 || parts.at(-1) !== "SKILL.md") {
    return;
  }
  return parts[index + 1];
}

function repoRelative(value, root) {
  const normalized = value.split(path.sep).join("/");
  if (!path.isAbsolute(value)) {
    return normalized;
  }
  return path.relative(root, value).split(path.sep).join("/");
}

export function unique(values) {
  return [...new Set(values)];
}

export function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function patchPaths(text, root) {
  const out = [];
  for (const line of text.split("\n")) {
    for (const prefix of patchPrefixes) {
      if (line.startsWith(prefix)) {
        out.push(repoRelative(line.slice(prefix.length).trim(), root));
      }
    }
  }
  return out;
}

function deepPathStrings(value, root) {
  const out = [];
  const visit = (item, key = "") => {
    if (typeof item === "string") {
      if (key.includes("path") || key === "target" || key === "uri" || item.endsWith("SKILL.md")) {
        out.push(repoRelative(item, root));
      }
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) {
        visit(entry, key);
      }
      return;
    }
    for (const [nextKey, nextValue] of Object.entries(item)) {
      visit(nextValue, nextKey.toLowerCase());
    }
  };
  visit(value);
  return out;
}
