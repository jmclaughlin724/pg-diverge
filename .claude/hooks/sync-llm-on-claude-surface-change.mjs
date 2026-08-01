#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { editTargetStrings } from "../../scripts/agent-hooks/edit-targets.mjs";
import { isCanonicalAgentSurfaceSource } from "../../scripts/skills/agent-surface-manifest.mjs";

const hookPath = fileURLToPath(import.meta.url);
const projectDir = canonicalPath(resolve(dirname(hookPath), "..", ".."));
const runtime = hookRuntime(hookPath);

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (payload?.hook_event_name !== "PostToolUse") {
    emitNoop();
  }
  const toolCwd = canonicalPath(
    typeof payload?.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : projectDir
  );
  const targets = editTargetStrings(payload).map((target) => resolveTarget(toolCwd, target));

  if (!targets.some((target) => isSyncSource(projectDir, target))) {
    emitNoop();
  }
  if (!hasSyncScript(projectDir)) {
    emitNoop();
  }

  runSync(projectDir);
  emitNoop();
} catch (error) {
  emitFailure(error);
}

function isSyncSource(projectDir, target) {
  const relPath = relative(projectDir, target).split(sep).join("/");
  return relPath !== "" && !relPath.startsWith("../") && isCanonicalAgentSurfaceSource(relPath);
}

function hasSyncScript(projectDir) {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    return (
      packageJson?.name === "supaschema" && typeof packageJson?.scripts?.["sync:llm"] === "string"
    );
  } catch {
    return false;
  }
}

function runSync(projectDir) {
  try {
    const npm = npmInvocation(["run", "sync:llm"]);
    execFileSync(npm.command, npm.args, {
      cwd: projectDir,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    throw new Error(`npm run sync:llm failed: ${syncErrorDetail(error).trim()}`, {
      cause: error,
    });
  }
}

function syncErrorDetail(error) {
  if (error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string") {
    return error.stderr;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function npmInvocation(args) {
  const execpath = process.env.npm_execpath;
  if (execpath) {
    return { args: [execpath, ...args], command: process.execPath };
  }
  return process.platform === "win32"
    ? {
        args: ["/d", "/s", "/c", "npm.cmd", ...args],
        command: process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
      }
    : { args, command: "npm" };
}

function resolveTarget(projectDir, targetPath) {
  return canonicalPath(
    isAbsolute(targetPath) ? resolve(targetPath) : resolve(projectDir, targetPath)
  );
}

function canonicalPath(pathname) {
  const absolute = resolve(pathname);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(canonicalPath(parent), basename(absolute));
}

function hookRuntime(pathname) {
  const normalized = pathname.split(sep).join("/");
  return normalized.includes("/.codex/hooks/") ? "codex" : "claude";
}

function emitNoop() {
  if (runtime === "codex") {
    process.stdout.write("{}\n");
  }
  process.exit(0);
}

function emitFailure(error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ systemMessage: reason })}\n`);
  process.exit(0);
}
