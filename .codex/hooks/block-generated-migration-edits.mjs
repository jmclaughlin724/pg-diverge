#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const lineageMarker = "-- supaschema: lineage ";
const editTools = new Set(["Edit", "MultiEdit", "Write", "edit_file", "apply_patch"]);
const updateHeader = "*** Update File: ";
const deleteHeader = "*** Delete File: ";
const addHeader = "*** Add File: ";
const moveHeader = "*** Move to: ";
const runtime = hookRuntime();
const redactSecrets = await loadRedactSecrets();

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      "."
  );
  const blocked = editTargets(payload, projectDir).find((path) => isGeneratedMigration(path));
  if (!blocked) {
    emitAllow();
  }
  emitDeny(blocked);
} catch (error) {
  emitFailOpen(error);
}

function editTargets(payload, projectDir) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = payload?.tool_input ?? {};
  if (toolName === "apply_patch") {
    return patchTargets(patchTextFromInput(input), projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [resolveTarget(projectDir, input.file_path)];
  }
  return [];
}

function patchTextFromInput(input) {
  if (typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.patch === "string") {
    return input.patch;
  }
  if (typeof input.input === "string") {
    return input.input;
  }
  return "";
}

function patchTargets(patchText, projectDir) {
  const updates = [];
  const deletes = [];
  const adds = new Set();
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      updates.push(resolveTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      deletes.push(resolveTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      adds.add(resolveTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      updates.push(resolveTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  const rewrites = deletes.filter((path) => adds.has(path));
  return [...updates, ...adds, ...rewrites];
}

function resolveTarget(projectDir, path) {
  return isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
}

function isGeneratedMigration(path) {
  if (!path.endsWith(".sql")) {
    return false;
  }
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  return existing.includes(lineageMarker);
}

function hookRuntime() {
  const normalized = fileURLToPath(import.meta.url).split(sep).join("/");
  if (normalized.includes("/.codex/hooks/") || process.env.CODEX_PROJECT_DIR) {
    return "codex";
  }
  return "claude";
}

function emitAllow() {
  if (runtime === "codex") {
    process.stdout.write("{}\n");
  }
  process.exit(0);
}

function emitDeny(blocked) {
  const reason =
    `${blocked} is a supaschema-generated migration (lineage marker present). ` +
    "Do not hand-edit it: change the declarative schema tree, delete this file if it is stale, " +
    "and regenerate with `supaschema diff`.";
  if (runtime === "codex") {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${reason} See .codex/rules/supaschema.rules.`,
        },
      })}\n`
    );
    process.exit(0);
  }
  process.stderr.write(`${reason} See .claude/rules/supaschema.md.\n`);
  process.exit(2);
}

function emitFailOpen(error) {
  if (runtime === "codex") {
    process.stdout.write(
      `${JSON.stringify({
        systemMessage: `block-generated-migration-edits hook error (fail-open): ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      })}\n`
    );
  }
  process.exit(0);
}

async function loadRedactSecrets() {
  try {
    const loaded = await import(new URL("../../dist/diagnostics.js", import.meta.url).href);
    if (typeof loaded.redactSecrets === "function") {
      return loaded.redactSecrets;
    }
  } catch {
    // Hooks are fail-open and may run before the generated dist exists in a source checkout.
  }
  return fallbackRedactSecrets;
}

function fallbackRedactSecrets(value) {
  return redactUrlCredentials(value)
    .replace(
      /\b(password|pass|pwd|token|secret|api[_-]?key|service[_-]?role[_-]?key)(\s*[:=]\s*)(["']?)[^"'\s,;)]+/giu,
      "$1$2$3[redacted]"
    )
    .replace(/\b(sb_secret_)[A-Za-z0-9_-]+/g, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
}

function isUserinfoEnd(char) {
  return (
    char === "@" || char === "/" || char === " " || char === "\t" || char === "\n" || char === "\r"
  );
}

function redactUrlCredentials(value) {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const marker = value.indexOf("://", index);
    if (marker === -1) {
      result += value.slice(index);
      break;
    }
    const afterScheme = marker + 3;
    result += value.slice(index, afterScheme);
    let cursor = afterScheme;
    let colon = -1;
    while (cursor < value.length && !isUserinfoEnd(value[cursor] ?? "")) {
      if (value[cursor] === ":" && colon === -1) {
        colon = cursor;
      }
      cursor += 1;
    }
    if (value[cursor] === "@" && colon > afterScheme && cursor > colon + 1) {
      result += `${value.slice(afterScheme, colon + 1)}[redacted]`;
      index = cursor;
    } else {
      index = afterScheme;
    }
  }
  return result;
}
