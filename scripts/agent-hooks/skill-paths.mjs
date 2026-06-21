import path from "node:path";

const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

export function payloadPaths(payload, root) {
  const input = payload?.tool_input ?? {};
  const out = [];
  for (const key of ["file_path", "notebook_path", "path", "target", "uri"]) {
    if (typeof input[key] === "string") {
      out.push(repoRelative(input[key], root));
    }
  }
  const patch = input.command ?? input.patch ?? input.input;
  if (typeof patch === "string") {
    out.push(...patchPaths(patch, root));
  }
  out.push(...deepPathStrings(input, root));
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
