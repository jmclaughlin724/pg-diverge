import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HEX = "0123456789abcdef";

export function isSha40(ref) {
  return typeof ref === "string" && ref.length === 40 && [...ref].every((c) => HEX.includes(c));
}

export function* eachStep(doc) {
  for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      yield { job, jobId, step };
    }
  }
}

export function jobMatrix(doc, jobId, key) {
  return doc?.jobs?.[jobId]?.strategy?.matrix?.[key] ?? [];
}

export function matrixValues(doc, jobId, key) {
  const matrix = doc?.jobs?.[jobId]?.strategy?.matrix ?? {};
  if (Array.isArray(matrix[key])) {
    return matrix[key];
  }
  if (Array.isArray(matrix.include)) {
    return matrix.include.map((entry) => entry?.[key]).filter((value) => value !== undefined);
  }
  return [];
}

export function permissionsAreReadOnly(perms) {
  if (perms === undefined) {
    return false;
  }
  if (typeof perms === "string") {
    return perms === "read-all" || perms === "read";
  }
  if (typeof perms === "object") {
    return Object.values(perms).every((value) => value === "read" || value === "none");
  }
  return false;
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

export function stepActionName(step) {
  const uses = step?.uses;
  if (typeof uses !== "string" || uses.startsWith("./")) {
    return;
  }
  const at = uses.lastIndexOf("@");
  return at > 0 ? uses.slice(0, at) : uses;
}

export function stepIf(step) {
  return String(step?.if ?? "").trim();
}

export function stepName(step) {
  return String(step?.name ?? "");
}

export function stepRun(step) {
  return String(step?.run ?? "").trim();
}

export function stepRunBefore(steps, before, after) {
  const beforeIndex = steps.findIndex((step) => stepRun(step) === before);
  const afterIndex = steps.findIndex((step) => stepRun(step) === after);
  return beforeIndex !== -1 && afterIndex !== -1 && beforeIndex < afterIndex;
}

export function findNamedStep(steps, name) {
  return steps.find((step) => stepName(step) === name);
}

export function workflowFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--", ".github/workflows"], {
    cwd: root,
  }).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => path.basename(file))
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort();
}
