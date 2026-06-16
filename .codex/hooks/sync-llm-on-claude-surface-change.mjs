#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const syncSurfaces = [
  ".claude/agents",
  ".claude/hooks",
  ".claude/rules",
  ".claude/skills",
];
const updateHeader = "*** Update File: ";
const deleteHeader = "*** Delete File: ";
const addHeader = "*** Add File: ";
const moveHeader = "*** Move to: ";
const statePath = ".tmp/sync-llm-on-claude-surface-change.json";
const runtime = hookRuntime();

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const hookEventName = eventName(payload);
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      "."
  );
  const currentDigest = claudeSurfaceDigest(projectDir);
  const previousDigest = readSyncedDigest(projectDir);
  const targets = editTargets(payload, projectDir);
  const explicitClaudeChange =
    targets.some((target) => isClaudeSyncSurface(projectDir, target)) ||
    commandMentionsClaudeSurface(payload);
  const changedSinceLastSync = previousDigest !== undefined && previousDigest !== currentDigest;
  const syncAvailable = hasSyncScript(projectDir);

  if (!syncAvailable) {
    emitNoop(hookEventName);
  }
  if (!explicitClaudeChange && !changedSinceLastSync) {
    writeSyncedDigest(projectDir, currentDigest);
    emitNoop();
  }

  const output = runSync(projectDir);
  writeSyncedDigest(projectDir, claudeSurfaceDigest(projectDir));
  emitSynced(output, hookEventName);
} catch (error) {
  emitFailure(error);
}

function editTargets(payload, projectDir) {
  return toolPayloads(payload).flatMap((toolPayload) => editTargetsForTool(toolPayload, projectDir));
}

function editTargetsForTool(toolPayload, projectDir) {
  const toolName = toolNameOf(toolPayload);
  const input = toolInputOf(toolPayload);
  if (toolName === "apply_patch") {
    return patchTargets(patchTextFromInput(input), projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [resolveTarget(projectDir, input.file_path)];
  }
  return [];
}

function toolPayloads(payload) {
  const payloads = [];
  const add = (candidate) => {
    if (!(candidate && typeof candidate === "object")) {
      return;
    }
    if (
      typeof candidate.tool_name === "string" ||
      typeof candidate.toolName === "string" ||
      typeof candidate.name === "string"
    ) {
      payloads.push(candidate);
    }
  };

  add(payload);
  for (const key of ["tool_calls", "tool_uses", "toolUses", "tools", "calls"]) {
    if (Array.isArray(payload?.[key])) {
      for (const item of payload[key]) {
        add(item);
      }
    }
  }

  return payloads;
}

function toolNameOf(toolPayload) {
  return typeof toolPayload?.tool_name === "string"
    ? toolPayload.tool_name
    : typeof toolPayload?.toolName === "string"
      ? toolPayload.toolName
      : typeof toolPayload?.name === "string"
        ? toolPayload.name
        : "";
}

function toolInputOf(toolPayload) {
  return toolPayload?.tool_input ?? toolPayload?.toolInput ?? toolPayload?.input ?? {};
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
  const targets = [];
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      targets.push(resolveTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      targets.push(resolveTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      targets.push(resolveTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      targets.push(resolveTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  return targets;
}

function commandMentionsClaudeSurface(payload) {
  return toolPayloads(payload).some((toolPayload) => {
    const input = toolInputOf(toolPayload);
    const command = typeof input.command === "string" ? input.command : "";
    return syncSurfaces.some((surface) => command.includes(`${surface}/`));
  });
}

function isClaudeSyncSurface(projectDir, target) {
  const relPath = relative(projectDir, target).split(sep).join("/");
  return (
    relPath !== "" &&
    !relPath.startsWith("../") &&
    syncSurfaces.some((surface) => relPath === surface || relPath.startsWith(`${surface}/`))
  );
}

function claudeSurfaceDigest(projectDir) {
  const hash = createHash("sha256");
  for (const surface of syncSurfaces) {
    const root = join(projectDir, surface);
    hash.update(`${surface}\0`);
    if (!existsSync(root)) {
      hash.update("missing\0");
      continue;
    }
    for (const file of listFiles(root)) {
      const absolute = join(root, file);
      hash.update(file);
      hash.update("\0");
      hash.update(readFileSync(absolute));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function listFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        out.push(relative(root, absolute).split(sep).join("/"));
      }
    }
  };
  visit(root);
  return out.sort();
}

function hasSyncScript(projectDir) {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    return packageJson?.name === "supaschema" && typeof packageJson?.scripts?.["sync:llm"] === "string";
  } catch {
    return false;
  }
}

function runSync(projectDir) {
  try {
    const npm = npmInvocation(["run", "sync:llm"]);
    return execFileSync(npm.command, npm.args, {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`npm run sync:llm failed: ${detail.trim()}`);
  }
}

function npmInvocation(args) {
  const execpath = process.env.npm_execpath;
  return execpath
    ? { command: process.execPath, args: [execpath, ...args] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function readSyncedDigest(projectDir) {
  try {
    const state = JSON.parse(readFileSync(join(projectDir, statePath), "utf8"));
    if (typeof state?.syncedDigest === "string") {
      return state.syncedDigest;
    }
    return typeof state?.digest === "string" ? state.digest : undefined;
  } catch {
    return;
  }
}

function writeSyncedDigest(projectDir, digest) {
  const file = join(projectDir, statePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ syncedDigest: digest })}\n`);
}

function resolveTarget(projectDir, targetPath) {
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(projectDir, targetPath);
}

function hookRuntime() {
  const normalized = fileURLToPath(import.meta.url).split(sep).join("/");
  return normalized.includes("/.codex/hooks/") || process.env.CODEX_PROJECT_DIR
    ? "codex"
    : "claude";
}

function eventName(payload) {
  if (typeof payload?.hook_event_name === "string" && payload.hook_event_name.length > 0) {
    return payload.hook_event_name;
  }
  return runtime === "codex" ? "Stop" : "PostToolBatch";
}

function emitNoop() {
  if (runtime === "codex") {
    process.stdout.write("{}\n");
  }
  process.exit(0);
}

function emitSynced(output, hookEventName) {
  const line = output
    .trim()
    .split("\n")
    .find((item) => item.startsWith("SYNC_LLM_OK"));
  if (runtime === "codex" && hookEventName === "Stop") {
    process.stdout.write("{}\n");
    process.exit(0);
  }
  emitContext(line ?? "SYNC_LLM_OK", hookEventName);
}

function emitFailure(error) {
  const reason = error instanceof Error ? error.message : String(error);
  if (runtime === "codex") {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    process.exit(0);
  }
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function emitContext(additionalContext, hookEventName) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        additionalContext,
        hookEventName,
      },
    })}\n`
  );
  process.exit(0);
}
