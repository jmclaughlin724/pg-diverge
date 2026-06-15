# Hooks Reference

Reference for Claude Code hooks — user-defined shell commands, LLM prompts, or agents that execute at specific lifecycle points.

> **Source:** [Official Hooks Reference](https://code.claude.com/docs/en/hooks) and [Hooks Guide](https://code.claude.com/docs/en/hooks-guide) (verified 2026-06-15).

## Hook Lifecycle

| Event | When It Fires | Can Block? |
| --- | --- | --- |
| `Setup` | Runs on `--init-only`, or `--init`/`--maintenance` in print mode | No |
| `SessionStart` | Session begins or resumes | No |
| `UserPromptSubmit` | User submits prompt, before processing | Yes |
| `UserPromptExpansion` | A command expands into a prompt, before Claude sees it | Yes |
| `PreToolUse` | Before a tool call executes | Yes |
| `PermissionRequest` | When a permission dialog appears | Yes |
| `PermissionDenied` | After auto mode denies a tool call (return `{ "retry": true }` to allow a retry) | No |
| `PostToolUse` | After a tool call succeeds | No |
| `PostToolUseFailure` | After a tool call fails | No |
| `PostToolBatch` | After a parallel tool batch resolves, before the next model call | Yes |
| `Notification` | When Claude sends a notification | No |
| `MessageDisplay` | While assistant message text is displayed | No |
| `SubagentStart` | When a subagent is spawned | No |
| `SubagentStop` | When a subagent finishes | Yes |
| `TeammateIdle` | Agent team teammate going idle | Yes (inverted — see below) |
| `TaskCreated` | Task being created on the team task list | Yes |
| `TaskCompleted` | Task being marked completed | Yes |
| `Stop` | When Claude finishes responding | Yes |
| `StopFailure` | Turn ends due to an API error (output ignored) | No |
| `InstructionsLoaded` | CLAUDE.md/rules file loaded | No |
| `ConfigChange` | Settings or skill file changes | Yes |
| `CwdChanged` | Working directory changes (e.g. `cd`) | No |
| `FileChanged` | A watched file changes on disk | No |
| `WorktreeCreate` | Worktree being created | Yes |
| `WorktreeRemove` | Worktree being removed | No |
| `PreCompact` | Before context compaction | No |
| `PostCompact` | After context compaction | No |
| `Elicitation` | MCP server requests structured input | Yes |
| `ElicitationResult` | User responds to MCP elicitation | Yes |
| `SessionEnd` | When session terminates | No |

## Configuration Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/validate-bash.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Configuration Locations

| Location                        | Scope          | Shareable |
| ------------------------------- | -------------- | --------- |
| `~/.claude/settings.json`       | All projects   | No        |
| `.claude/settings.json`         | Single project | Yes (VCS) |
| `.claude/settings.local.json`   | Single project | No        |
| Skill or agent YAML frontmatter | While active   | Yes       |

## Hook Types

### Command (`type: "command"`)

| Field           | Required | Description                        |
| --------------- | -------- | ---------------------------------- |
| `command`       | Yes      | Shell command to execute           |
| `timeout`       | No       | Seconds (default: 600)             |
| `async`         | No       | Run in background (default: false) |
| `once`          | No       | Run once per session (skills only) |
| `statusMessage` | No       | Custom spinner message             |

### HTTP (`type: "http"`)

JSON POST to a URL endpoint. Available for a subset of events.

| Field     | Required | Description                          |
| --------- | -------- | ------------------------------------ |
| `url`     | Yes      | Endpoint URL                         |
| `headers` | No       | HTTP headers (supports `${ENV_VAR}`) |
| `timeout` | No       | Seconds (default: 600)               |

Requires `allowedHttpHookUrls` in settings to whitelist URLs. Use `httpHookAllowedEnvVars` to control which env vars can appear in header interpolation.

### Prompt (`type: "prompt"`)

Single-turn LLM yes/no evaluation. Response: `{ "ok": true }` or `{ "ok": false, "reason": "..." }`.

### Agent (`type: "agent"`)

Multi-turn subagent with tool access (Read, Grep, Glob). Same response schema as prompt hooks.

## Matcher Patterns

| Event | Matches Against | Examples |
| --- | --- | --- |
| `PreToolUse`, `PostToolUse`, etc. | Tool name | `Bash`, `Edit\|Write`, `mcp__github__.*` |
| `PermissionDenied` | Tool name | `Bash`, `Edit\|Write`, `mcp__github__.*` |
| `Setup` | Init/maintenance phase | `init`, `maintenance` |
| `SessionStart` | How started | `startup`, `resume`, `clear`, `compact` |
| `UserPromptExpansion` | Command name (empty = every slash command) | `commit`, `review` |
| `SubagentStart`, `SubagentStop` | Agent type | `Bash`, `Explore`, custom names |
| `PreCompact`, `PostCompact` | Compaction type | `manual`, `auto` |
| `ConfigChange` | Config scope | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `Elicitation`, `ElicitationResult` | MCP server name | `my-mcp-server` |
| `StopFailure` | Error type | `rate_limit`, `authentication_failed`, `server_error` |
| `FileChanged` | Literal filenames | `.envrc\|.env` |
| `TeammateIdle`, `TaskCreated`, `TaskCompleted` | Not supported | Always fires |
| `WorktreeCreate`, `WorktreeRemove` | Not supported | Always fires |
| `PostToolBatch`, `MessageDisplay`, `CwdChanged` | Not supported | Always fires |
| `InstructionsLoaded` | Not supported | Always fires |
| `Notification` | Notification type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `SessionEnd` | How ended | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |
| `UserPromptSubmit`, `Stop` | Not supported | Always fires |

## Input and Output

Every hook receives via stdin: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, and `effort` (object). `effort.level` is one of `low`, `medium`, `high`, `xhigh`, or `max` — the active session effort level exposed to every hook event.

### Exit Codes

| Exit Code | Meaning        | Effect                                   |
| --------- | -------------- | ---------------------------------------- |
| 0         | Success        | Proceed. stdout parsed for JSON          |
| 2         | Blocking error | Block the action. stderr shown to Claude |
| Other     | Non-blocking   | Continue. stderr logged in verbose mode  |

### Decision Control

| Events | Pattern | Key Fields |
| --- | --- | --- |
| `UserPromptSubmit`, `Stop`, etc. | Top-level `decision` | `decision: "block"`, `reason` |
| `PreToolUse` | `hookSpecificOutput` | `permissionDecision` (allow/deny) |
| `PermissionRequest` | `hookSpecificOutput` | `decision.behavior` (allow/deny) |
| `PermissionDenied` | `hookSpecificOutput` | `retry: true` lets the model retry the denied tool call |

## Hooks in Skills and Agents

Defined in YAML frontmatter, scoped to component lifecycle. For agents, `Stop` hooks auto-convert to `SubagentStop`.

```yaml
---
name: secure-operations
hooks:
  EventName: # One of 30 hook events
    - matcher: "regex" # Optional filter
      hooks:
        - type: command|http|prompt|agent
          command: "..." # command type
          url: "..." # http type
          prompt: "..." # prompt/agent types
          timeout: 60 # seconds (optional)
---
```

**Example:**

```yaml
---
name: secure-operations
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
  Stop:
    - hooks:
        - type: prompt
          prompt: "Check if all security validations passed: $ARGUMENTS"
---
```

## Environment Variables

| Variable | Available In | Description |
| --- | --- | --- |
| `$CLAUDE_PROJECT_DIR` | All hooks | Project root directory |
| `$CLAUDE_EFFORT` | All hooks | Active session effort level (`low`/`medium`/`high`/`xhigh`/`max`); same value as `effort.level` |
| `$CLAUDE_ENV_FILE` | SessionStart | File path to persist env vars |
| `$CLAUDE_CODE_REMOTE` | All hooks | `"true"` in remote web environments |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | SessionEnd | Timeout for SessionEnd hooks (default: 1.5s) |

## Best Practices

**Security:** Quote shell variables, validate inputs, check for path traversal, use absolute paths.

**Performance:** Keep hooks fast, use `timeout`, use `async: true` for long tasks, use `once: true` for one-time setup.

**Reliability:** Test manually with piped JSON, check `stop_hook_active` in Stop hooks to prevent loops, use `claude --debug`.

**Generated surface sync:** For deterministic mirrors after `.claude/**` changes, prefer `PostToolBatch` over `PostToolUse`. `PostToolBatch` runs once after a parallel tool batch resolves and before the next model call, so it coalesces multi-file edits without per-tool races. Do not use `async: true` for generated-surface sync that must complete before the model observes the mirrored files.

**Response contract:** When a hook returns `hookSpecificOutput`, verify every field name against this reference before deploying. Unrecognized fields cause silent "hook error" — the hook exits 0 but the output is dropped. Use `updatedInput` (not `modifiedInput`), `permissionDecision` (not `decision`), and match the exact nesting documented under Decision Control and Input Modification.

### Common Patterns

| Pattern | Event | Type | Use Case |
| --- | --- | --- | --- |
| Auto-format after edits | `PostToolUse` | command | `formatter --write` |
| Block destructive commands | `PreToolUse` | command | Deny `rm -rf`, `DROP TABLE` |
| Verify task completion | `Stop` | prompt | LLM evaluates if tasks done |
| Sync generated mirrors | `PostToolBatch` | command | Refresh `.agents/**` or `.codex/**` after `.claude/**` writes |
| Skill enforcement | `UserPromptSubmit` | command | Prepend `/skill` commands |
| Log commands for audit | `PostToolUse` | command | Append to log file (async) |

## Prompt-Based Hooks (`type: prompt`)

Single-turn LLM yes/no decision. The hook sends context to a lightweight model that returns `{ "ok": true }` or `{ "ok": false, "reason": "..." }`. No tool access — pure evaluation.

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: prompt
          prompt: "Is this bash command safe and repo-scoped?"
          model: haiku
```

Use prompt hooks for fast gate checks where the decision is binary (approve/reject) and no file exploration is needed.

## Agent-Based Hooks (`type: agent`)

Multi-turn subagent with tool access (Read, Grep, Glob). The agent can explore the codebase, run multiple tool calls, and reason across turns before returning its decision. Same response schema as prompt hooks.

```yaml
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: "Review changes and verify tests pass before allowing completion."
```

Use agent hooks when verification requires reading files, searching code, or multi-step reasoning that a single prompt cannot accomplish.

## SubagentStart / SubagentStop Events

- **SubagentStart**: Fires when a subagent spawns. Use to inject context, set environment variables, or log agent creation. Cannot block.
- **SubagentStop**: Fires when a subagent completes. Use to prevent premature stop, verify output quality, or enforce completion criteria. Can block (exit 2 forces the agent to continue).

Matcher for both events matches against agent type/name (e.g., `Bash`, `Explore`, or custom agent names defined in YAML).

Note: When an agent defines a `Stop` hook, it automatically converts to `SubagentStop` when that agent runs as a subagent.

## Agent Team Hooks

Three hook events fire inside an agent team. Exit code 2 behaves the same way (block + send feedback) for the two task hooks, but **`TeammateIdle` inverts the convention** — exit 2 keeps the teammate _working_ instead of idling. Getting this backwards turns a quality gate into an infinite loop.

| Event | Fires when | Exit 2 effect |
| --- | --- | --- |
| `TeammateIdle` | Teammate is about to go idle | Teammate **keeps working** and receives stderr as feedback |
| `TaskCreated` | A task is being created on the shared task list | Prevents creation; stderr returned as feedback |
| `TaskCompleted` | A task is being marked complete | Prevents completion; stderr returned as feedback |

None of the three support matchers — they always fire. The feedback written to stderr is routed back to the lead or the teammate that triggered the event.

Common use:

- `TeammateIdle` — require the teammate to re-verify tests, update the task list, or confirm its hypothesis before being allowed to idle.
- `TaskCreated` — enforce task naming rules or block out-of-scope task creation.
- `TaskCompleted` — enforce a DoD (tests green, diff posted, no `TODO`) before a task counts as done.

## Enhanced Matcher Patterns

| Pattern | Matches | Example |
| --- | --- | --- |
| Simple string | Exact tool name | `Bash` |
| Pipe-separated | Any of the listed tools | `Edit\|Write` |
| Regex | Tool names matching pattern | `mcp__supabase_main__.*` |
| MCP tool matching | Any MCP server tool | `mcp__github__.*` |
| Spawn matching | Agent type for SubagentStart/SubagentStop | `Explore`, custom agent names |

MCP tool names follow the pattern `mcp__{server}__{tool}`, so `mcp__supabase_main__.*` matches all Supabase MCP tools.

## Decision Types

Hook exit codes and output fields control the decision:

| Decision | How to Signal | Effect |
| --- | --- | --- |
| allow | Exit 0 | Proceed with the action |
| deny | Exit 2 | Block the action; stderr shown to Claude |
| ask | Escalate to user via `decision` | Prompt the user for manual approval |

For `PreToolUse`, use `hookSpecificOutput.permissionDecision` with values `allow`, `deny`, or `ask`. For `PermissionRequest`, use `hookSpecificOutput.decision.behavior`.

## Input Modification

`PreToolUse` hooks can modify tool input before execution by returning `updatedInput` in `hookSpecificOutput`. The hook receives the original tool input via stdin and can return transformed input in stdout.

Include `hookEventName` and `permissionDecision` alongside `updatedInput`. Claude Code validates `hookSpecificOutput` with a strict Zod schema — missing `hookEventName` causes silent validation failure where the hook exits 0 but the output is dropped.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "command": "echo 'modified command'"
    }
  }
}
```

`updatedInput` replaces the entire tool input object. Preserve all original fields you want to keep, not just the ones you are modifying. Use jq object update to replace a single field while keeping the rest:

```bash
printf '%s' "$INPUT" | jq --arg v "$MODIFIED" '
  {
    hookSpecificOutput: {
      hookEventName: .hook_event_name,
      permissionDecision: "allow",
      updatedInput: (.tool_input | .field_to_change = $v)
    }
  }
'
```

The field name is `updatedInput`, not `modifiedInput`. Using the wrong field name causes a silent "hook error" — the hook exits 0 but Claude Code cannot interpret the response, so the input modification is dropped.

This enables patterns like command rewriting, path normalization, prompt injection, or argument modification without blocking the tool call.

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Automate Workflows with Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
