# Agent System Prompt Patterns

10 proven patterns for writing effective agent system prompts, derived from official Anthropic documentation and verified codebase patterns.

## Pattern 1: Role + Domain

Define a narrow expert identity: `You are a [role] specializing in [narrow domain].`

Narrow roles produce focused, expert behavior. Broad roles ("helpful assistant") cause attention spread.

## Pattern 2: Mission + Boundaries

```markdown
### You do:

- [Primary responsibility 1-3]

### You do NOT:

- [Explicit exclusion 1-3]
```

Explicit boundaries prevent scope creep. The "do NOT" list is especially important.

## Pattern 3: Tool-Usage

```markdown
Use these in order:

1. **Read** - Load relevant files before making suggestions
2. **Grep** - Search for patterns across the codebase
3. **Bash** - Execute commands for verification

**Rule:** Always gather context before answering. Never guess about code structure.
```

## Pattern 4: Action-Default

**Proactive agents:** `<default_to_action>` — implement changes rather than suggesting.

**Cautious agents:** `<do_not_act_before_instructions>` — analyze before recommending.

## Pattern 5: Guardrail

```markdown
**STOP and ask before:**

- Deleting files, destructive git commands, modifying production config

**NEVER do:**

- Access secrets, push directly to main
```

## Pattern 6: Style + Attitude

| Role        | Recommended Attitude                             |
| ----------- | ------------------------------------------------ |
| Reviewer    | Critical, thorough, assumes nothing              |
| Debugger    | Methodical, evidence-based, hypothesis-driven    |
| Architect   | Thoughtful, considers trade-offs, asks questions |
| Implementer | Action-oriented, pragmatic, ships quickly        |

## Pattern 7: Process/Output-Shape

```markdown
## Process

1. **Restate** - Summarize the task
2. **Gather** - Find relevant code/context
3. **Analyze** - Identify issues
4. **Execute** - Make changes
5. **Verify** - Confirm success
6. **Report** - Summarize results

## Output Format

**Summary:** [overview] **Changes Made:** - [File:line] - [Change] **Verification:** - [Command]: [Result] **Concerns:** - [Issues or follow-ups]
```

## Pattern 8: Permission/Delegation

```markdown
## Delegation

- **security-auditor** - For vulnerability analysis
- **database-admin** - For schema changes

Use `spawn_agent` with a clear, focused prompt and explicit ownership.
```

## Pattern 9: Narrow Tools + Context

```markdown
**Focus on:** `src/`, `tests/`, files matching error stack trace **Ignore:** `node_modules/`, `dist/`, `.next/`

Read only what's needed.
```

## Pattern 10: Self-Critique

```markdown
Before claiming completion:

- Re-read changes, confirm type-checking, check for side effects

If uncertain:

- Say "I'm not sure" rather than guessing
- Flag assumptions explicitly
```

---

## Agent Hooks

Agents define lifecycle hooks in YAML frontmatter, scoped to the agent's lifetime.

| Event         | When Fired                           | Can Block? |
| ------------- | ------------------------------------ | ---------- |
| `PreToolUse`  | Before agent executes a tool         | Yes        |
| `PostToolUse` | After a tool completes               | No         |
| `Stop`        | When agent finishes (→ SubagentStop) | Yes        |

Hook types: `command` (shell), `prompt` (single-turn LLM yes/no), `agent` (multi-turn subagent with tools).

```yaml
---
name: thorough-developer
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: ".claude/hooks/lint-check.sh"
  Stop:
    - hooks:
        - type: prompt
          prompt: "Check if all tasks are complete. $ARGUMENTS"
---
```

## Agent Frontmatter Reference

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `name` | Yes | string | Kebab-case identifier |
| `description` | Yes | string | When/why to invoke (with `<example>` tags) |
| `tools` | No | comma-separated string | Comma-separated allowed tools |
| `disallowedTools` | No | comma-separated string | Denylisted tools removed from inherited/specified tool list |
| `model` | No | string | `sonnet`, `opus`, `haiku`, or `inherit` |
| `permissionMode` | No | string | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | No | number | Max agent turns before subagent stops |
| `skills` | No | array | Skill names to preload; full `SKILL.md` body enters startup context. Runtime invocation of non-preloaded skills requires `Skill` in `tools:` — see [subagent-skill-runtime.md](subagent-skill-runtime.md) |
| `mcpServers` | No | array/object | MCP servers available to the subagent |
| `hooks` | No | object | Event handlers scoped to agent lifecycle |
| `memory` | No | string | Persistent memory scope: `user`, `project`, or `local`. **Off-policy in this repo** — do not set; see [subagent-memory.md](subagent-memory.md) |

### Model Selection

| Model  | Best For                         |
| ------ | -------------------------------- |
| haiku  | Fast searches, simple analysis   |
| sonnet | General coding, complex analysis |
| opus   | Architecture, nuanced reasoning  |

## Permission Modes (All 6)

| Mode | Behavior | Best For |
| --- | --- | --- |
| `default` | Standard permission prompts | Normal agents |
| `acceptEdits` | Auto-accept file edits and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`) within the working dir or `additionalDirectories` | Implementer agents |
| `auto` | Background classifier model reviews each call and blocks only what looks risky (scope escalation, unknown infrastructure, hostile-content-driven actions); aborts in non-interactive `-p` runs after repeated blocks | Long unattended runs that should not prompt for routine work |
| `dontAsk` | Auto-deny all permission prompts unless pre-approved via `/permissions` or `permissions.allow` | Highly constrained agents |
| `bypassPermissions` | Skip all permission checks; root/home `rm -rf` still prompts as a circuit breaker; can be locked out via `permissions.disableBypassPermissionsMode` | Trusted automation in isolated containers/VMs |
| `plan` | Gather context and draft plans for approval | Planning and research agents |

See [permissions-and-settings.md](permissions-and-settings.md) for rule syntax, path patterns, sandbox interaction, and managed-only settings.

## disallowedTools

Restrict which tools an agent can use by listing them in the `disallowedTools` field. This is the inverse of `tools` — everything is allowed except what you list.

```yaml
disallowedTools: Bash(rm *), Bash(git push --force*)
```

Use `disallowedTools` when you want broad access with specific command-family exclusions.

## Spawn Restrictions

Limit which subagents an agent can spawn using the `tools` field with `Task()` syntax:

```yaml
tools: Task(worker, researcher)
```

This restricts the agent to only spawning subagents named `worker` or `researcher`. Other tools remain available unless also restricted.

## MCP Tool Filtering

Include specific MCP tools alongside built-in tools in the `tools` field:

```yaml
tools: Read, Grep, mcp__supabase_main__list_tables
```

MCP tool names follow the pattern `mcp__{server}__{tool}`. You can list individual MCP tools to grant surgical access to external services without exposing the full MCP server toolset.

## Background vs Foreground Agents

| Aspect | Foreground | Background |
| --- | --- | --- |
| Execution | Blocks parent until complete | Runs concurrently with parent |
| MCP tools | Full access | NO MCP tools available |
| Permission prompts | Pass through to user | Pre-approved (no user interaction) |
| Use case | Primary task execution | Parallel independent work |
| Parent interaction | Sequential, waits for result | Fire-and-forget, check result later |

## Memory-Aware Agent Design

- Keep the agent prompt focused on role, boundaries, tools, and output shape.
- Put reusable project rules in `CLAUDE.md` or `.claude/rules`, not in every agent prompt.
- Preload `skills` only when the agent needs them on nearly every run; otherwise let the agent invoke them when relevant.
- Do not enable `memory:` on agents in this repo. Promote durable lessons into rules, hooks, skills, or the relevant `AGENTS.md` instead.

Background agents are ideal for independent tasks like running tests, searching code, or generating reports that do not require user approval or MCP server access. Foreground agents are required when MCP tools, permission escalation, or blocking coordination is needed.

## Anti-Patterns

| Anti-Pattern | Fix |
| --- | --- |
| "Be helpful" | Define specific role and expertise |
| No scope boundaries | Add explicit "do NOT" list |
| "Use your judgment" | Provide clear decision criteria |
| Missing output format | Specify exact structure |
| Tool list without guidance | Explain when to use each tool |
| Missing `skills` preload | Add `skills` for deterministic preloading; keep description for discovery |
| Explicit `tools:` allowlist without `Skill` | Subagent cannot resolve runtime path-trigger skill gates — add `Skill` to `tools:` or omit `tools:` entirely. See [subagent-skill-runtime.md](subagent-skill-runtime.md) |
| No verification step | Add quality check before completion |
| Overly complex process | Keep to 5-7 clear steps |

## Sources

- [Claude Code Agents](https://code.claude.com/docs/en/agents)
- [Agent Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks-guide)
