#!/usr/bin/env node
import { ciFailureInboxContext } from "./ci-inbox-core.mjs";

const args = process.argv.slice(2);
const runtime = argValue(args, "--runtime") ?? "claude";
const eventName =
  argValue(args, "--event") ?? (runtime === "codex" ? "PreToolUse" : "UserPromptSubmit");
const context = ciFailureInboxContext({ eventName, runtime });

if (!context) {
  process.stdout.write(runtime === "codex" ? "{}\n" : "");
  process.exit(0);
}

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      additionalContext: context,
      hookEventName: eventName,
    },
  })}\n`
);

function argValue(values, name) {
  const index = values.indexOf(name);
  if (index === -1) {
    return;
  }
  const value = values[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
