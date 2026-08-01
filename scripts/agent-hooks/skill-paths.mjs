import path from "node:path";
import { minimatch } from "minimatch";
import { governedToolTargetStrings } from "./edit-targets.mjs";

export function payloadPaths(payload, root) {
  return unique(
    governedToolTargetStrings(payload)
      .map((value) => repoRelative(value, root))
      .filter(Boolean)
  );
}

export function pathMatches(trigger, candidate) {
  return minimatch(normalizePath(candidate), normalizePath(trigger), {
    dot: true,
    magicalBraces: true,
    nocase: false,
    nonegate: true,
  });
}

function normalizePath(value) {
  return String(value).split("\\").join("/");
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
