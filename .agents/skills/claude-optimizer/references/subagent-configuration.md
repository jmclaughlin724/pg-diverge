# Subagent Configuration Reference

Complete YAML frontmatter specification for custom subagent definition files (`.claude/agents/*.md`).

> **Source:** [Claude Code Agents](https://code.claude.com/docs/en/agents), [Claude Code Sub-Agents](https://code.claude.com/docs/en/sub-agents), and verified codebase patterns (February 2026).

## Contents

- [Frontmatter Fields](#frontmatter-fields)
- [Required Fields](#required-fields)
- [Optional Fields](#optional-fields)
- [Permission Modes](#permission-modes)
- [Tool Restriction Patterns](#tool-restriction-patterns)
- [Auto-Discovery and Routing](#auto-discovery-and-routing)
- [File Locations and Priority](#file-locations-and-priority)
- [Validation Checklist](#validation-checklist)
- [Anti-Patterns](#anti-patterns)
- [See Also](#see-also) — sibling references for examples and advanced topics

## See Also

- `subagent-examples.md` — canonical YAML frontmatter examples (exploration, developer, orchestrator, main-session, budget-constrained)
- `subagent-advanced.md` — invocation ladder, `--agent` session mode, resume mechanics, managed/CLI/plugin scopes, background flow, `auto` permission mode, MCP context isolation, `/btw`

---

## Frontmatter Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | Yes | - | Unique ID, lowercase-with-hyphens |
| `description` | string | Yes | - | When Claude should delegate; triggers auto-invocation |
| `tools` | string | No | all | Comma-separated list of allowed tools |
| `disallowedTools` | string/array | No | none | Tools to explicitly deny (denylist approach) |
| `model` | string | No | inherit | `sonnet`/`opus`/`haiku`, full model ID (`claude-opus-4-6`), or `inherit` |
| `permissionMode` | string | No | default | Permission behavior for the agent session |
| `maxTurns` | number | No | unlimited | Maximum agentic turns before stopping |
| `skills` | array | No | - | Skill names to preload (full content injected at start) |
| `mcpServers` | object/array | No | inherit | MCP server definitions (by name or inline) |
| `hooks` | object | No | - | Lifecycle hooks scoped to agent lifetime |
| `memory` | string | No | - | Persistent memory scope. **Off-policy in this repo** — see [subagent-memory.md](subagent-memory.md). |
| `color` | string | No | - | Visual identification in UI terminal output |
| `background` | boolean | No | false | Always run as background task |
| `effort` | string | No | inherit | `low`/`medium`/`high`/`max` — `max` is Opus 4.6 only |
| `isolation` | string | No | - | `worktree` for temporary git worktree isolation |
| `initialPrompt` | string | No | - | Auto-submitted first user turn when the agent runs as the main session |

---

## Required Fields

### name

Unique identifier used for discovery, invocation, and agent routing.

**Validation rules:**

- Maximum **64 characters**
- Lowercase letters, numbers, hyphens only (`^[a-z0-9-]+$`)
- Cannot contain "anthropic" or "claude"
- Must be unique across all agent locations

**Examples:**

```yaml
# Good
name: code-reviewer
name: security-auditor
name: database-admin
name: frontend-agent

# Bad
name: Code_Reviewer     # uppercase, underscores
name: claude-helper      # reserved word "claude"
name: a-very-long-agent-name-that-exceeds-the-sixty-four-character-maximum-limit  # too long
```

### description

The single most important field for agent routing. Claude reads every agent's description at session start to decide when to delegate.

**Validation rules:**

- Maximum **1024 characters**
- Must include `<example>` tags (agents require them; skills do not)
- Cannot contain "anthropic" or "claude"
- Third person voice (NOT "you" or "I")

**Pattern:** State expertise + trigger scenarios + explicit exclusions.

```yaml
description: |
  Security vulnerability specialist. Reviews code for OWASP issues,
  authentication flaws, data exposure. Use after implementing auth or APIs.
  Do NOT use for general code review (use code-reviewer) or performance
  analysis (use performance-engineer).

  <example>
  context: User implemented OAuth login
  user: "Review auth code for security"
  assistant: "Using security-auditor agent to analyze..."
  </example>
```

**Description quality directly controls invocation accuracy.** Vague descriptions cause missed invocations or false positives.

| Description Quality  | Invocation Result                     |
| -------------------- | ------------------------------------- |
| Specific triggers    | Reliable automatic routing            |
| Explicit exclusions  | Prevents overlap with similar agents  |
| `<example>` tags     | Trains Claude on exact matching       |
| Vague/broad language | Inconsistent or competing invocations |

---

## Optional Fields

### tools

Comma-separated string of allowed tools. Omit entirely to inherit all tools from the parent session.

**Format:** Comma-separated string (NOT an array for agents).

```yaml
# Evidence-gathering agent with explicit tools
tools: Read, Write, Edit, Grep, Glob, Bash, Skill

# Full development agent
tools: Read, Write, Edit, Glob, Grep, Bash, Task, TaskOutput, KillShell, AskUserQuestion, Skill

# Agent with MCP tools (fully qualified names)
tools: Read, Grep, Glob, mcp__perplexity__search, mcp__perplexity__reason, mcp__context7__get-library-docs

# Orchestrator agent (coordination only, no direct edits)
tools: Read, Glob, Grep, Task, TaskOutput, KillShell, EnterPlanMode, ExitPlanMode
```

**Common tool groups:**

| Purpose            | Tools                                                  |
| ------------------ | ------------------------------------------------------ |
| Evidence-gathering | `Read, Grep, Glob, Bash, Skill`                        |
| Full development   | `Read, Write, Edit, Glob, Grep, Bash`                  |
| Orchestration      | `Read, Glob, Grep, Task, TaskOutput, KillShell, Skill` |
| Research           | `Read, Glob, Grep, mcp__*`                             |

### disallowedTools

Denylist approach -- block specific tools while allowing everything else. Use when the blocklist is shorter than the allowlist.

```yaml
# Block destructive shell commands when a role needs broad non-shell access
disallowedTools:
  - Bash(rm *)
  - Bash(git push --force*)
```

**Decision: `tools` vs `disallowedTools`:**

| Scenario | Use | Rationale |
| --- | --- | --- |
| Agent needs 3-5 specific tools | `tools` | Short allowlist is clearer |
| Agent needs everything except a small risky command family | `disallowedTools` | Short denylist is clearer |

**Composition rule when both are set:** `disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed. This is well-defined, but the two-step resolution is easy to get wrong — prefer one field per agent.

### model

Override the model for this agent. Accepts a model alias, a full model ID, or `inherit`. Agents default to `inherit` if omitted.

| Value         | Example           | Best For                               |
| ------------- | ----------------- | -------------------------------------- |
| `haiku`       | `model: haiku`    | Fast searches, simple analysis, triage |
| `sonnet`      | `model: sonnet`   | General coding, complex analysis       |
| `opus`        | `model: opus`     | Architecture, nuanced reasoning        |
| Full model ID | `claude-opus-4-6` | Pinning a specific version             |
| `inherit`     | `model: inherit`  | Use parent session's model (default)   |

Full model IDs accept the same values as the `--model` CLI flag (for example, `claude-opus-4-6`, `claude-sonnet-4-6`).

**Model resolution precedence** (first match wins):

1. `CLAUDE_CODE_SUBAGENT_MODEL` environment variable
2. Per-invocation `model` parameter Claude passes when spawning the agent
3. The subagent definition's `model` frontmatter
4. The main conversation's model

Set `CLAUDE_CODE_SUBAGENT_MODEL` to force every subagent in a session onto one model regardless of per-agent frontmatter — useful for budget caps or model A/B testing.

### permissionMode

Controls what the agent can do without asking for user approval. See [Permission Modes](#permission-modes) for full details.

```yaml
permissionMode: plan        # Planning mode
permissionMode: default     # Normal permission prompts
permissionMode: acceptEdits # Auto-approve file edits
```

### maxTurns

Limits the number of agentic turns. Prevents runaway agents on open-ended tasks.

```yaml
maxTurns: 25   # Short focused task
maxTurns: 50   # Standard development
maxTurns: 100  # Complex multi-step work
```

**Guidelines:**

| Task Type               | Recommended maxTurns |
| ----------------------- | -------------------- |
| Quick research/triage   | 10-25                |
| Standard implementation | 30-50                |
| Complex multi-file work | 50-100               |
| Leave unlimited         | Omit the field       |

### skills

Pre-loads skill content into the agent's startup context. The full `SKILL.md` body is injected before the agent begins work.

```yaml
skills:
  - database-workflow
  - supabase
```

**Important:** Skills listed here consume startup context. Only preload skills the agent will definitely need. The runtime invocation contract — when a subagent can call `Skill()` for non-preloaded skills, and how this interacts with path-trigger skill-matcher gates in parallel orchestration — lives in [subagent-skill-runtime.md](subagent-skill-runtime.md). Read that reference before designing an agent that may receive work spanning multiple path-trigger globs.

**Memory rule:** Preload only certain needs, not nice-to-haves. Preloading is for deterministic startup knowledge; optional expertise should stay discoverable instead of always injected.

### mcpServers

Configure MCP servers available to this agent. Three approaches: reference by name, inline definition, or mixed. See [subagent-mcp.md](subagent-mcp.md) for complete MCP configuration patterns.

```yaml
# Reference globally configured servers by name
mcpServers:
  - github
  - sentry

# Inline stdio server
mcpServers:
  my-db:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: "postgresql://..."
```

Inline definitions accept the same types as `.mcp.json`: `stdio`, `http`, `sse`, `ws`. String references share the parent session's connection; inline definitions connect on spawn and disconnect on finish.

### hooks

Lifecycle hooks scoped to the agent's lifetime. Uses the same format as settings-based hooks. For agents, `Stop` hooks are automatically converted to `SubagentStop`.

**Supported events:** `PreToolUse`, `PostToolUse`, `Stop` (auto-converts to `SubagentStop`).

```yaml
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: ".claude/hooks/lint-check.sh"
  Stop:
    - hooks:
        - type: prompt
          prompt: "Verify all tasks are complete: $ARGUMENTS"
```

See [hooks-reference.md](hooks-reference.md) for all events, matchers, handler types, and decision control.

### memory

Off-policy in this repo. Do not set `memory:` on any agent under `.claude/agents/**`. Promote durable lessons into rules, hooks, skills, or the relevant `AGENTS.md`. See [subagent-memory.md](subagent-memory.md).

### color

Visual identification in terminal UI. Helps distinguish agents in multi-agent sessions and agent teams.

**Valid values:** `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`, `white`.

```yaml
color: cyan      # Research agents
color: blue      # Developer agents
color: purple    # Monitor/audit agents
color: green     # Testing agents
```

### background

Always run as background task. Background subagents run concurrently with the main conversation. Pre-approve permissions before launch since background agents cannot prompt interactively. Users can send a foreground agent to the background with `Ctrl+B`.

```yaml
background: true
```

### isolation

Run in a temporary git worktree, giving the agent an isolated copy of the repository. The worktree is auto-cleaned if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.

Related settings: `worktree.symlinkDirectories` (directories to symlink instead of copy), `worktree.sparsePaths` (sparse checkout paths).

```yaml
isolation: worktree
```

---

## Permission Modes

Five modes controlling agent autonomy, from most restrictive to most permissive.

| Mode | Behavior | Use Case |
| --- | --- | --- |
| `plan` | Generates plans instead of executing. | Research, architecture review |
| `default` | Standard prompts for all tool invocations. | General agents (safest default) |
| `acceptEdits` | Auto-approves file edits, prompts for Bash/MCP. | Trusted development agents |
| `dontAsk` | Auto-approves all safe operations, prompts for destructive ones. | Autonomous agents with guardrails |
| `bypassPermissions` | Skips all permission prompts. No safety net. | CI/CD automation, trusted scripts |

### Permission Mode Decision Matrix

| Scenario | Mode | Rationale |
| --- | --- | --- |
| Code review, research | `plan` | Must not modify files |
| Standard development | `default` | User approves each action |
| Trusted developer agent | `acceptEdits` | Fast edits, controlled commands |
| Autonomous background work | `dontAsk` | Self-directed with safety rails |
| CI pipeline, GitHub Action | `bypassPermissions` | No human to prompt |

> **Note:** "Delegate mode" in agent teams (Shift+Tab) is a UI interaction mode that prevents the lead from implementing directly. It is separate from the `permissionMode` frontmatter field.

### Examples

See `subagent-examples.md` → "Permission Mode Examples" for explore / developer / CI agent frontmatter.

### Parent/child override rules

- If the parent session uses `bypassPermissions`, the child inherits it and **cannot** override.
- If the parent uses `auto`, the subagent's `permissionMode` frontmatter is **ignored**; the background classifier evaluates tool calls with the parent's rules.
- A sixth mode `auto` — a background classifier reviews commands and protected-directory writes — is documented in `subagent-advanced.md`.

---

## Tool Restriction Patterns

- **Default inheritance:** omit `tools` when the agent should inherit the parent session's full surface.
- **Allowlist:** use `tools:` only when the role needs a narrower and intentional surface.
- **Denylist:** use `disallowedTools` for a small set of risky command families while inheriting everything else.
- **Spawn restrictions:** `tools: Read, Agent(security-auditor, performance-engineer)` restricts which subagent types a `--agent` main thread can spawn. `Agent` without parens allows any; omitting `Agent` blocks all spawning. `Task(...)` is the pre-2.1.63 alias.
- **MCP filtering:** reference MCP tools by `mcp__servername__toolname`, or use `mcp__servername__*` for a whole server.
- **Bash command filtering:** `tools: Bash(git:*), Bash(pnpm:*)` narrows Bash to command prefixes.

See `subagent-advanced.md` for worked examples, plus MCP context isolation and the `claude --disallowedTools "Agent(Explore)"` shutoff path.

---

## Auto-Discovery and Routing

Claude discovers agents at session start by reading metadata from all agent definition files across all locations.

### How Routing Works

1. **Startup:** Claude loads `name` + `description` from every `.md` file in agent directories (~100 tokens per agent)
2. **Matching:** When a user request arrives, Claude evaluates descriptions against the request
3. **Invocation:** If a description matches, Claude spawns the agent via `Task(agent-name)`
4. **Fallback:** If no agent matches, Claude handles the request directly

**Built-in subagents** (always available, no definition file needed): `Explore` (Haiku, constrained by Claude Code to search/analyze codebases), `Plan` (inherits model, used during plan mode), `general-purpose` (inherits model, all tools), `statusline-setup` (Sonnet, invoked by `/statusline`), `Claude Code Guide` (Haiku, invoked for Claude Code feature questions).

### Description Impact on Routing

| Description Element | Routing Impact |
| --- | --- |
| Trigger phrases | Primary match signal ("Use when...", "Use after...") |
| `<example>` tags | Trains exact scenario matching |
| "Do NOT use for..." clauses | Prevents false positive matches |
| Expertise declaration | Disambiguates between similar agents |
| Capability list | Broadens match surface for edge cases |

### Routing Conflicts

When multiple agents match a request, Claude considers:

1. **Specificity** -- More specific description wins over generic
2. **Explicit exclusions** -- "Do NOT use for X" defers to the agent that handles X
3. **Example match** -- Agents with matching `<example>` tags rank higher
4. **Recency** -- More recently used agents have slight preference in ambiguous cases

---

## File Locations and Priority

Agent definitions are loaded from multiple locations with cascading priority.

| Priority | Location | Scope | Shareable |
| --- | --- | --- | --- |
| 1 (highest) | Managed settings `.claude/agents/` | Organization-wide | Admin-only |
| 2 | `--agents` CLI flag (JSON) | Session-specific | No |
| 3 | `.claude/agents/` | Project-scoped | Yes (VCS) |
| 4 | `~/.claude/agents/` | User-global | No |
| 5 (lowest) | Plugin-provided agents | Plugin-scoped | Via plugin |

### Resolution Rules

- **Name collision:** Higher-priority location wins. Managed definitions override project and user agents with the same name.
- **Walk-up scoping:** Project agents are found by walking up from the cwd. Directories added with `--add-dir` grant file access only — they are _not_ scanned for subagents.
- **Plugin restrictions:** Plugin-provided subagents silently drop the `hooks`, `mcpServers`, and `permissionMode` frontmatter fields. Copy the file into `.claude/agents/` or `~/.claude/agents/` to keep those fields. See `subagent-advanced.md`.
- **CLI audit path:** `claude agents` (no interactive session) lists every agent grouped by source and flags which ones are overridden.

### File Structure

```
.claude/agents/
  code-reviewer.md       # One agent per file
  security-auditor.md    # Filename should match agent name
  backend-architect.md   # .md extension required
```

---

## Validation Checklist

### Required

- [ ] `name` is lowercase-with-hyphens
- [ ] `name` is 64 characters or fewer
- [ ] `name` does not contain "anthropic" or "claude"
- [ ] `description` is 1024 characters or fewer
- [ ] `description` includes at least one `<example>` tag
- [ ] `description` uses third person voice
- [ ] YAML frontmatter uses spaces, not tabs

### Recommended

- [ ] `description` includes "Do NOT use for..." exclusions
- [ ] `description` starts with expertise declaration
- [ ] `tools` is either omitted for inheritance or intentionally scoped for the agent's real work
- [ ] `model` matches task complexity (haiku for fast tasks, opus for reasoning)
- [ ] `permissionMode` is most restrictive option that works
- [ ] `color` is set for visual identification in multi-agent sessions
- [ ] No `<commentary>` tags in the description (move to body)

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
| --- | --- | --- |
| Vague description ("Be helpful") | Never auto-invoked | Add specific trigger scenarios |
| No `<example>` tags | Unreliable routing | Add 1-2 realistic examples |
| No exclusions ("Do NOT use...") | Competes with similar agents | List explicit exclusions |
| All tools granted to review agent | Reviewer accidentally edits files | Restrict to `Read, Grep, Glob` |
| `bypassPermissions` in dev | No safety net for destructive operations | Use `acceptEdits` or `dontAsk` instead |
| `hooks` / `mcpServers` / `permissionMode` on plugin agent | Silently dropped; runtime behaves as if unset | Copy the agent into `.claude/agents/` or `~/.claude/agents/` |
| Description over 1024 chars | Silently truncated | Move details to body content |
| Overlapping agent descriptions | Claude picks randomly between matches | Add "Do NOT use for..." to both agents |
| Missing `color` in teams | Agents visually indistinguishable | Assign distinct colors per role |

---

## Complete Examples

Moved to `subagent-examples.md` to keep this reference under the 500-line cap. See that file for exploration, full development, orchestrator-with-hooks, main-session `initialPrompt`, and `effort`-constrained agents.

---

## Sources

- [Claude Code Agents Documentation](https://code.claude.com/docs/en/agents) - Official agent specification
- [Claude Code Sub-Agents](https://code.claude.com/docs/en/sub-agents) - Subagent spawning and configuration
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Lifecycle hooks specification
- [frontmatter-reference.md](frontmatter-reference.md) - Complete field reference for all configuration types
- [agents-patterns.md](agents-patterns.md) - System prompt design patterns
- [hooks-reference.md](hooks-reference.md) - Hook events, matchers, and handler types
