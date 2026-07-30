#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  failClosedResult,
  shapeHookResult,
  writeHookResult,
} from "../../scripts/agent-hooks/hook-output.mjs";

const hookPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(hookPath), "..", "..");
const cli = join(root, "dist", "cli.js");

try {
  if (!existsSync(cli)) {
    const npm = npmInvocation(["run", "build", "--silent"]);
    const result = spawnSync(npm.command, npm.args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      throw new Error(`could not start npm build: ${result.error.message}`, {
        cause: result.error,
      });
    }
    if (result.status !== 0) {
      const detail = lastOutputLine(result.stderr, result.stdout);
      throw new Error(
        `npm run build --silent failed with status ${result.status ?? "unknown"}${
          detail ? `: ${detail}` : ""
        }`
      );
    }
  }

  await import(pathToFileURL(cli).href);
} catch (error) {
  const eventName = sourceHookEventName(process.argv.slice(2));
  const runtime = sourceHookRuntime(process.argv.slice(2));
  const shaped = shapeHookResult(
    eventName,
    failClosedResult(eventName, error, "sourceHookLauncher", {
      hookPath,
      remediation: "Run npm run build, inspect the reported launcher source, and rerun the hook.",
      runtime,
    }),
    runtime
  );
  writeHookResult(shaped);
  process.exitCode = shaped.exitCode;
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

function sourceHookEventName(args) {
  const hookIndex = args.indexOf("hook");
  return args[hookIndex + 1] === "generated-artifact-edit" ? "PreToolUse" : "PostToolUse";
}

function sourceHookRuntime(args) {
  const runtimeIndex = args.indexOf("--runtime");
  const explicit = args[runtimeIndex + 1];
  if (explicit === "claude" || explicit === "codex") {
    return explicit;
  }
  return hookPath.split("\\").join("/").includes("/.codex/hooks/") ? "codex" : "claude";
}

function lastOutputLine(...values) {
  return values
    .flatMap((value) =>
      String(value ?? "")
        .replaceAll("\r\n", "\n")
        .split("\n")
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 500);
}
