# Claude Code Extensions (Proprietary)

Claude Code-specific frontmatter fields that extend the portable Agent Skills specification.

> **⚠️ PORTABILITY WARNING:** Fields documented here are Claude Code proprietary extensions. They will NOT work in VS Code Copilot, GitHub Copilot, Cursor, or other platforms implementing the Agent Skills specification.

## Overview

Claude Code extends the Agent Skills specification with additional frontmatter fields for invocation control, argument handling, model selection, context isolation, and lifecycle hooks.

**For portable fields that work everywhere, see:** [agent-skills-spec.md](agent-skills-spec.md)

## Claude Code-Specific Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `disable-model-invocation` | boolean | `false` | Context-only: matches keywords but loads via Read |
| `user-invocable` | boolean | `true` | Show/hide from user's `/` menu |
| `argument-hint` | string | - | Autocomplete hint for user arguments |
| `context` | string | `inherit` | Set to `fork` for isolated subagent context |
| `model` | string | `inherit` | Model override for this skill |
| `agent` | string | - | Subagent type when `context: fork` is set |
| `hooks` | object | - | Skill-scoped lifecycle hooks (PreToolUse, etc.) |

### Portability Status

| Field | Portable? | Alternative |
| --- | --- | --- |
| `disable-model-invocation` | ❌ No | Context-only: matches keywords, loads via Read |
| `user-invocable` | ❌ No | Use naming convention (prefix with `_internal`) |
| `argument-hint` | ❌ No | Document in skill description |
| `context` | ❌ No | Separate skill files per platform |
| `model` | ❌ No | Platform-specific configuration |
| `agent` | ❌ No | Not applicable in other platforms |
| `hooks` | ❌ No | Not applicable in other platforms |

## Field Specifications

### disable-model-invocation

**⚠️ Claude Code Only**

Context-only mode. The skill still participates in keyword/file-trigger matching via the shared agent hook matcher, but loads via `Read` of its SKILL.md instead of the `Skill` tool. Claude cannot auto-invoke the skill through its native description matching.

**Type:** `boolean` **Default:** `false`

**When to use:**

- Destructive operations (database resets, file deletions)
- Production deployments (requires explicit user intent)
- Expensive operations (API calls with significant cost)
- Irreversible actions (data migrations, account modifications)
- Configuration or audit skills that should load as context, not execute as workflows

**Example:**

```yaml
---
name: deploy-production
description: Deploy the application to production - handles zero-downtime deployments and rollback procedures
disable-model-invocation: true
---
```

### user-invocable

**⚠️ Claude Code Only**

Controls visibility in the user's `/` menu. When `false`, skill is hidden from menu but Claude can still auto-invoke it.

**Type:** `boolean` **Default:** `true`

**When to use:**

- Background knowledge (coding conventions, internal patterns)
- Supporting skills (automatically loaded by other skills)
- Internal references (team-specific documentation)

**Example:**

```yaml
---
name: coding-standards
description: Team coding conventions for TypeScript and React - loaded when generating code
user-invocable: false
---
```

### Invocation Matrix

| Configuration | User can invoke | Claude can invoke | Use Case |
| --- | --- | --- | --- |
| (default) | Yes | Yes | Standard skills |
| `disable-model-invocation: true` | Yes | Context-only | Keyword-matched, Read |
| `user-invocable: false` | No | Yes | Hidden background |
| Both set to restrictive | No | No | Internal-only support |

### argument-hint

**⚠️ Claude Code Only**

Hint shown during autocomplete when user types `/skill-name`.

**Type:** `string` **Max length:** Recommended <50 characters

**Examples:**

```yaml
argument-hint: [issue-number]
```

```yaml
argument-hint: [filename] [format]
```

```yaml
argument-hint: <table-or-change-description>
```

**Note:** Arguments are received via `$ARGUMENTS` variable in the skill body.

### context

**⚠️ Claude Code Only**

Controls whether the skill runs in the parent context or a forked subagent.

**Type:** `string` **Values:** `inherit` (default) | `fork`

**When to use `fork`:**

- Destructive operations needing isolation
- Long-running tasks that benefit from separate context
- Operations that might pollute the main conversation

**Example:**

```yaml
---
name: dangerous-cleanup
description: Destructive cleanup operations with isolation
context: fork
---
```

### model

**⚠️ Claude Code Only**

Override the model used when this skill is active.

**Type:** `string` **Values:** Model family or specific version

**Examples:**

```yaml
model: opus # Claude Opus family
```

```yaml
model: sonnet # Claude Sonnet family
```

```yaml
model: haiku # Claude Haiku family
```

**When to use:**

- Architecture decisions requiring maximum reasoning (opus)
- Fast searches and simple analysis (haiku)
- Balanced general coding tasks (sonnet)

### agent

**⚠️ Claude Code Only**

Specifies which subagent type to use when `context: fork` is set.

**Type:** `string` **Values:** Platform-defined agent names

**Example:**

```yaml
---
name: explore-codebase
description: Fast exploration using Explore agent
context: fork
agent: Explore
---
```

### hooks

**⚠️ Claude Code Only**

Lifecycle hooks scoped to this skill or agent. Uses the same configuration format as settings-based hooks. All 12 hook events are supported. For agents, `Stop` hooks are automatically converted to `SubagentStop`.

**Type:** `object` (event name → array of matcher groups)

**Three hook handler types:**

| Type      | Description                          | Default Timeout |
| --------- | ------------------------------------ | --------------- |
| `command` | Run a shell command                  | 600s            |
| `prompt`  | Single-turn LLM yes/no evaluation    | 30s             |
| `agent`   | Multi-turn subagent with tool access | 60s             |

**Fields per handler:**

| Field | Required | Description |
| --- | --- | --- |
| `type` | Yes | `"command"`, `"prompt"`, or `"agent"` |
| `command` | Yes\* | Shell command (\*command type only) |
| `prompt` | Yes\* | Prompt text with `$ARGUMENTS` (\*prompt/agent types only) |
| `timeout` | No | Seconds before canceling |
| `statusMessage` | No | Custom spinner message |
| `once` | No | Run only once per session then remove (skills only) |
| `model` | No | Model override (prompt/agent types only) |
| `async` | No | Run in background (command type only) |

**Example (command hook):**

```yaml
---
name: validated-changes
description: Changes with validation hooks
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: ".claude/hooks/lint-check.sh"
  Stop:
    - hooks:
        - type: prompt
          prompt: "Check if all tasks are complete: $ARGUMENTS"
---
```

**Example (agent hook for test verification):**

```yaml
---
name: thorough-developer
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: "Verify all tests pass. Run the suite and check results. $ARGUMENTS"
          timeout: 120
---
```

**See:** [hooks-reference.md](hooks-reference.md) for all events, matchers, and decision control patterns. [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks) for official specification.

## String Substitutions

**⚠️ Claude Code Only** (other platforms may have different syntax)

| Variable               | Description                            |
| ---------------------- | -------------------------------------- |
| `$ARGUMENTS`           | All arguments passed when invoking     |
| `${CLAUDE_SESSION_ID}` | Current session ID for logging/storage |

**Example:**

```yaml
---
name: fix-issue
description: Fix a GitHub issue
disable-model-invocation: true
---
Fix GitHub issue $ARGUMENTS following our coding standards.
```

## Dynamic Context Injection

**⚠️ Claude Code Only**

The `` !`command` `` syntax runs shell commands before skill content is sent to Claude.

**Example:**

```yaml
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
allowed-tools: Bash(gh:*)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`

## Your task
Summarize this pull request...
```

**How it works:**

1. Each `` !`command` `` executes immediately (before Claude sees anything)
2. Output replaces the placeholder
3. Claude receives fully-rendered prompt with actual data

## Migration to Portable Specification

To make a skill cross-platform, remove Claude Code-specific fields:

| Claude Code Field          | Portable Alternative                    |
| -------------------------- | --------------------------------------- |
| `disable-model-invocation` | Document in description or metadata     |
| `user-invocable`           | Use naming convention (`_internal-...`) |
| `argument-hint`            | Document in description                 |
| `context: fork`            | Not portable (platform-specific)        |
| `model`                    | Move to `metadata.preferred-model`      |

Mark compliance: `metadata: { compliance: "claude-code" }` (or `agent-skills-v1` for portable).

---

## Agent Integration Patterns

How skills integrate into agent system prompts and work with different agent types.

### System Prompt Integration

Skills integrate via `<available_skills>` XML block in agent system prompts:

```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>Extract text and tables from PDF files...</description>
    <location>/path/to/skills/pdf-processing/SKILL.md</location>
  </skill>
</available_skills>
```

### Loading Behavior

| Stage | What Loads | Token Cost | When |
| --- | --- | --- | --- |
| Startup | Metadata (name + description) | ~100 tokens/skill | Every conversation start |
| Activation | Full SKILL.md body | <5000 tokens | When Claude determines relevance |
| On-demand | Reference files | Variable | When explicitly accessed |

Skills with `disable-model-invocation: true` still participate in keyword/file-trigger matching via the shared agent hook matcher but load via `Read` of their SKILL.md instead of the `Skill` tool. Claude's native description matching does not auto-invoke them.

### MCP Tool References

When skills reference MCP tools, ALWAYS use fully qualified names (`ServerName:tool_name`):

```markdown
Use the BigQuery:bigquery_schema tool to retrieve table schemas. Use the GitHub:create_issue tool to create issues.
```

### Agent Types

| Capability      | Filesystem Agent           | Tool-Based Agent |
| --------------- | -------------------------- | ---------------- |
| Read SKILL.md   | `cat SKILL.md`             | Custom tool      |
| Execute scripts | `bash scripts/validate.sh` | Not available    |
| List files      | `ls references/`           | Custom tool      |
| Dynamic context | `` !`command` ``           | Not supported    |

---

## See Also

- [agent-skills-spec.md](agent-skills-spec.md) - Portable specification (works everywhere)
- [frontmatter-reference.md](frontmatter-reference.md) - Complete field reference
- [skills-patterns.md](skills-patterns.md) - Skills authoring best practices

## Sources

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) - Official Claude Code specification
- [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks) - Lifecycle hooks specification
- [Agent Skills Specification](https://agentskills.io/specification) - Base portable specification
