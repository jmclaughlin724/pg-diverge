import fs from "node:fs";
import { shapeHookResult, unexpectedFailureResult, writeHookResult } from "./hook-output.mjs";
import { hookRuntime, hookRuntimeDisabled } from "./hook-runtime.mjs";

export function runHookEntrypoint(eventName, handler, options = {}) {
  const runtime = options.runtime ?? hookRuntime();
  const hookPath = options.hookPath ?? process.argv[1] ?? "unknown";
  let shaped = disabledHookResult(eventName, runtime);
  if (shaped === undefined) {
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
  }
  writeHookResult(shaped);
  process.exit(shaped.exitCode);
}

function disabledHookResult(eventName, runtime) {
  return hookRuntimeDisabled(runtime) ? shapeHookResult(eventName, {}, runtime) : undefined;
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
