#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateBashPolicy } from "./guards/bash-policy-checks.mjs";

export function evaluateGeneralGuardHook({ payload = {}, env = process.env } = {}) {
  if ((payload?.hook_event_name ?? "PreToolUse") !== "PreToolUse") {
    return {};
  }
  const toolName = String(payload?.tool_name ?? "");
  if (!["Bash", "exec_command", "functions.exec_command"].includes(toolName)) {
    return {};
  }
  const result = evaluateBashPolicy(payload, env);
  return result.action === "block" ? deny(result.message) : {};
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function runtimeErrorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return deny(
    [
      "Codex general guard failed closed.",
      "event=PreToolUse",
      "source=.codex/hooks/general-guard.mjs",
      `error=${message}`,
    ].join("\n")
  );
}

async function main() {
  try {
    const raw = readFileSync(0, "utf8");
    const payload = raw.trim() ? JSON.parse(raw) : {};
    process.stdout.write(`${JSON.stringify(evaluateGeneralGuardHook({ payload }))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(runtimeErrorResult(error))}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
