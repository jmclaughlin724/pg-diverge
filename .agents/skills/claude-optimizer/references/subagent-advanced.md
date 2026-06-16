# Subagent Advanced Topics

Invocation channels, session-wide agent mode, resume mechanics, background execution, managed/plugin/CLI scopes, and other subagent behaviors beyond core frontmatter. Sibling to `subagent-configuration.md`.

## Invocation Escalation Ladder

Three channels, each stricter than the last about which subagent actually runs.

| Channel | Syntax | Guarantee |
| --- | --- | --- |
| Natural language | "Use the `code-reviewer` subagent to review…" | Claude _usually_ delegates; no hard guarantee |
| `@`-mention | `@"code-reviewer (agent)"` or `@agent-code-reviewer` | The named subagent runs; Claude still writes its task prompt |
| Session-wide | `claude --agent code-reviewer` or `"agent": "code-reviewer"` in `.claude/settings.json` | The _main thread itself_ takes on that subagent's system prompt, tools, and model |

**Plugin-provided subagents** use the scoped form: `@agent-<plugin-name>:<agent-name>` or `claude --agent <plugin-name>:<agent-name>`.

**CLI flag vs settings key:** If both `--agent <name>` and `"agent": "..."` in `.claude/settings.json` are present, the CLI flag wins. The choice persists across `/resume`.

**Session-wide semantic:** `--agent` _replaces_ the default Claude Code system prompt — same as `--system-prompt` — with the subagent's body. `CLAUDE.md` and project memory still load through the normal message flow. The agent name appears as `@<name>` in the startup header.

## `initialPrompt`

Auto-submits a first user turn only when the agent runs as the main session via `--agent` or the `"agent"` setting. Does _not_ fire when spawned as a subagent through the Agent tool. Commands (`/foo`) and skills are processed. Prepended to any user-provided prompt.

See `subagent-examples.md` for a worked example.

## `claude agents` CLI

Lists all configured subagents grouped by source without starting an interactive session. Shows which are **overridden** by higher-priority definitions — the cheapest way to audit duplicate `name:` fields across scopes.

```bash
claude agents
```

## `/agents` Interactive TUI

Inside a Claude Code session, `/agents` opens a tabbed manager:

- **Library** tab — view all subagents (built-in, user, project, plugin), create new ones with guided setup or **Generate with Claude**, edit/delete existing ones, see which are active when names collide.
- **Running** tab — shows live subagents in the current session; open or stop them.

Keyboard shortcuts in the creation flow: `s` or Enter saves the definition; `e` saves and opens the file in your editor.

## Disable a Specific Subagent

Block auto-invocation without deleting the definition:

```json
// .claude/settings.json (or settings.local.json)
{
  "permissions": {
    "deny": ["Agent(Explore)", "Agent(my-custom-agent)"]
  }
}
```

Or via CLI for a single session:

```bash
claude --disallowedTools "Agent(Explore)"
```

Works for built-in and custom subagents.

## Scope Priority (Authoritative)

Managed settings win over everything. This corrects an earlier priority table that omitted the managed scope.

| Priority | Location | Scope | Notes |
| --- | --- | --- | --- |
| 1 (highest) | Managed settings `.claude/agents/` | Org-wide | Deployed via managed settings directory; overrides project + user |
| 2 | `--agents` CLI flag | Session | JSON payload, not saved to disk |
| 3 | `.claude/agents/` | Project | VCS-shareable; found by walking up from cwd |
| 4 | `~/.claude/agents/` | User | Personal, across projects |
| 5 (lowest) | Plugin `agents/` | Plugin-scoped | Via installed plugins |

Directories added with `--add-dir` grant file access only — they are **not** scanned for subagents.

## CLI-Defined Subagents

Pass JSON via `--agents`. Exists only for the session; not saved to disk. Useful for quick testing and automation scripts:

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on quality and security.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

Accepts the same frontmatter fields as file-based subagents. `prompt` replaces the markdown body.

## Managed Subagents

Deployed by org admins via the managed settings directory (`.claude/agents/` inside managed settings). Same frontmatter format as project/user subagents. **Take precedence over project and user definitions with the same name** — important for compliance-enforced review or deployment agents.

## Plugin Subagent Restrictions

Plugin-provided subagents **do not support** the following frontmatter fields. They are silently ignored when loading:

- `hooks`
- `mcpServers`
- `permissionMode`

To use those fields, copy the agent into `.claude/agents/` or `~/.claude/agents/`. `permissions.allow` in `settings.json` / `settings.local.json` can grant session-wide equivalents, but not per-agent scoping.

## Resume Mechanics

Each subagent invocation creates a new instance with fresh context. To continue a prior subagent instead of starting over, Claude uses the `SendMessage` tool with the agent's ID as `to`. The subagent retains its full conversation history.

Constraints:

- `SendMessage` is gated on `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Without the flag, resume is unavailable.
- A stopped subagent that receives `SendMessage` **auto-resumes in the background** with no new `Agent` invocation.
- Transcripts persist independently of the main conversation's compaction state.

## Transcript Paths

```
~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl
```

- Main conversation compaction does not affect subagent transcripts.
- Transcripts persist within their session; resumable after restarting Claude Code.
- Retention: `cleanupPeriodDays` setting (default 30).

## Auto-Compaction

Subagents auto-compact using the same logic as the main conversation, default ~95% capacity. Override with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (integer percent).

Compaction events appear in transcripts:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": { "trigger": "auto", "preTokens": 167189 }
}
```

## Background Execution

Background subagents run concurrently with the main conversation.

Pre-approval flow:

1. Before launch, Claude Code prompts for _every_ permission the subagent will need.
2. Once running, the subagent inherits those approvals and **auto-denies** anything not pre-approved.
3. `AskUserQuestion` calls from a background subagent **fail**, but the agent continues.

Recovery: if a background subagent stops on missing permissions, relaunch the same task as a foreground subagent to get interactive prompts.

Controls:

- `background: true` frontmatter always runs the agent in the background.
- `Ctrl+B` sends a running foreground task to the background mid-run.
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` disables background tasks entirely.

## MCP Context Isolation

Defining an MCP server inline under a subagent's `mcpServers:` keeps its tool descriptions _out of the main conversation's context_. The subagent gets the tools; the parent does not. This is a concrete optimization for heavy MCP servers (Playwright, database MCPs) that would otherwise consume ~2-10KB of startup context in every session.

Inline servers support the same types as `.mcp.json`: `stdio`, `http`, `sse`, `ws`. String references share the parent session's connection; inline definitions connect on spawn and disconnect on finish.

## `/btw` as a Subagent Alternative

For quick questions about something already in the current conversation, `/btw` is cheaper than spawning a subagent:

- Sees full conversation context
- No tool access
- The answer is discarded rather than added to history

Use `/btw` when the question is conversational; use a subagent when it requires tool calls or produces output you want recorded.

## Permission Mode: `auto`

In addition to the five modes in `subagent-configuration.md`, Claude Code supports a sixth mode:

- **`auto`** — a background classifier reviews commands and protected-directory writes. The classifier evaluates each tool call with the session's block/allow rules before it runs.

Parent/child override precedence:

- If the parent uses `bypassPermissions`, child subagents inherit it and **cannot** override.
- If the parent uses `auto`, the subagent's `permissionMode` frontmatter is **ignored** — the classifier evaluates its tool calls with the parent's rules.
- `bypassPermissions` still prompts for writes to `.git`, `.claude`, `.vscode`, `.idea`, `.husky`, **except** `.claude/commands`, `.claude/agents`, and `.claude/skills`.

## Sources

- [Claude Code Sub-Agents](https://code.claude.com/docs/en/sub-agents)
- [Permission Modes](https://code.claude.com/docs/en/permission-modes)
- Parent reference: `subagent-configuration.md`
