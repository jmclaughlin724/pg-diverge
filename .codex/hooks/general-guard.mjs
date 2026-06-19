#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateBashPolicy } from "./guards/bash-policy-checks.mjs";

export function evaluateGeneralGuardHook({
  payload = {},
  env = process.env,
} = {}) {
  if ((payload?.hook_event_name ?? "PreToolUse") !== "PreToolUse") {
    return {};
  }
  if (
    !["Bash", "exec_command", "functions.exec_command"].includes(
      String(payload?.tool_name ?? "")
    )
  ) {
    return {};
  }

  const result = evaluateBashPolicy(payload, env);
  if (result.action !== "block") {
    return {};
  }

  return deny(result.message);
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
  let payload = {};
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw.trim() ? JSON.parse(raw) : {};
    process.stdout.write(
      `${JSON.stringify(evaluateGeneralGuardHook({ payload }))}\n`
    );
  } catch (error) {
    process.stdout.write(`${JSON.stringify(runtimeErrorResult(error))}\n`);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return entry === modulePath;
  }
}

if (isMainModule()) {
  await main();
}
