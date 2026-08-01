import fs from "node:fs";
import path from "node:path";
import { shapeHookResult, unexpectedFailureResult, writeHookResult } from "./hook-output.mjs";

export function runHookEntrypoint(eventName, handler, options = {}) {
  const runtime = options.runtime ?? hookRuntime();
  const hookPath = options.hookPath ?? process.argv[1] ?? "unknown";
  let shaped;
  try {
    const payload = readStdinJson();
    options.validatePayload?.(payload, runtime, eventName);
    shaped = handler(eventName, payload, {
      ...options,
      hookPath,
      runtime,
    });
  } catch (error) {
    shaped = shapeHookResult(
      eventName,
      unexpectedFailureResult(eventName, error, "hookInput", {
        hookPath,
        remediation: `Send one valid JSON object on stdin matching the ${eventName} hook schema.`,
        runtime,
      }),
      runtime
    );
  }
  writeHookResult(shaped);
  process.exit(shaped.exitCode);
}

function hookRuntime() {
  const normalized = String(process.argv[1] ?? "")
    .split(path.sep)
    .join("/");
  return normalized.includes("/.codex/hooks/") ? "codex" : "claude";
}

function readStdinJson() {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim().length === 0) {
    throw new Error("hook stdin was empty");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `hook stdin is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("hook stdin must contain one JSON object");
  }
  return payload;
}
