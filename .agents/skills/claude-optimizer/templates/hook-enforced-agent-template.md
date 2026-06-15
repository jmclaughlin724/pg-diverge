# Codex Hook Playbook Template

Use this template when native Codex hooks are the right enforcement surface. Codex hooks belong in Codex-owned configuration, not in the retired Claude-to-Codex hook mirror.

## Decision Gate

Use a hook only when event-time behavior is required:

- Block or rewrite a tool call before execution.
- Approve or deny an approval request.
- Add context or block handling after a tool result.
- Continue work at stop time when completion criteria are unmet.

Prefer instructions for judgment, Codex rules for shell allow/prompt/deny policy, and hooks for event payload logic.

## hooks.json Shape

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .codex/hooks/validate-command.mjs",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Command Hook Contract

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.tool_input?.command ?? "";

if (/git\s+reset\s+--hard/.test(command)) {
  console.error("Blocked: destructive git reset is not allowed.");
  process.exit(2);
}

process.exit(0);
```

## Event Selection

- `PreToolUse`: prevent side effects before they happen.
- `PermissionRequest`: approve or deny approval prompts.
- `PostToolUse`: add context or block result handling after execution.
- `Stop` and `SubagentStop`: continue when completion criteria are still unmet.

## supaschema Rules

- `npm run sync:llm` mirrors `.claude/hooks/**` into `.codex/hooks/**`; make hook sources runtime-aware when Claude and Codex contracts differ.
- Claude hooks stay in `.claude/settings.json` and `.claude/hooks/**`.
- Native Codex hooks stay in `.codex/hooks.json` and `.codex/hooks/**`.
- Do not recreate the retired Claude-to-Codex hook manifest, sync script, or bridge runner.

## Checklist

- Hook solves an event-time problem that rules/instructions cannot.
- Matcher is narrow.
- Command is deterministic and fast.
- Exit behavior is documented.
- Focused hook test exists when the hook becomes durable repo behavior.
