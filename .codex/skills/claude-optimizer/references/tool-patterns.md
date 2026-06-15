# Tool Patterns

Tool use and tool choice patterns for Claude Code skills, agents, and commands. This reference covers both how to implement tools and how to control Claude's tool selection behavior.

## Contents

- [Tool Choice Options](#tool-choice-options)
- [Tool Types Overview](#tool-types-overview)
- [Tool Definition Structure](#tool-definition-structure)
- [Tool Lifecycle](#tool-lifecycle)
- [Parallel Tool Use](#parallel-tool-use)
- [Claude Code Tool Integration](#claude-code-tool-integration)
- [Tool Choice Simulation in Claude Code](#tool-choice-simulation-in-claude-code)
- [Mandatory Tool Patterns](#mandatory-tool-patterns)
- [MCP Tool Integration](#mcp-tool-integration)
- [Error Handling](#error-handling)
- [Anti-Patterns](#anti-patterns)

---

## Tool Choice Options

| Option | Behavior | When to Use |
| --- | --- | --- |
| `auto` | Claude decides whether to use tools | General-purpose queries |
| `any` | Claude MUST use one tool (any tool) | Every response requires tool action |
| `tool` | Claude MUST use a specific tool | Structured output extraction |
| `none` | Claude cannot use tools | Pure conversation |

### Decision Matrix

| Scenario | Tool Choice | Rationale |
| --- | --- | --- |
| "What's 2+2?" with calculator tool | `auto` | Claude can answer without tool |
| "Search for X and summarize" | `auto` | Tool needed, but let Claude decide |
| SMS bot: all messages via SMS API | `any` | Every response must be a tool call |
| Extract JSON from unstructured text | `tool` | Guarantee structured output |
| "Just explain what this code does" | `none` or `auto` | No action needed |

### Extended Thinking Compatibility

| Tool Choice | Compatible? |
| ----------- | ----------- |
| `auto`      | Yes         |
| `none`      | Yes         |
| `any`       | No (error)  |
| `tool`      | No (error)  |

### Parallel Tool Use Control

```typescript
tool_choice: {
  type: "auto",
  disable_parallel_tool_use: true  // At most one tool call
}
```

---

## Tool Types Overview

| Type | Execution | Implementation | Use Case |
| --- | --- | --- | --- |
| **Client tools** | Your system | Full definition required | Custom business logic |
| **Server tools** | Anthropic servers | Type declaration only | Web search, web fetch |
| **Anthropic-defined** | Your system | Type + implementation | Bash, text editor, computer use |
| **MCP tools** | MCP server | Schema conversion | External integrations |

## Tool Definition Structure

Every tool requires name, description, and input*schema. Name must match `^[a-zA-Z0-9*-]{1,64}$`. Target 3-4 sentences minimum per tool description including when to use and limitations.

## Tool Lifecycle

```
User Query -> Claude Evaluates -> tool_use Block -> Execute Tool -> tool_result -> Claude Response
```

**Critical formatting rules:**

1. `tool_result` blocks MUST immediately follow their `tool_use` blocks
2. In user messages, `tool_result` blocks MUST come FIRST
3. Any text MUST come AFTER all tool results

## Parallel Tool Use

Claude can call multiple tools simultaneously when operations are independent. All results must be returned in ONE user message. Encourage parallel calls by adding to system prompt:

```text
For maximum efficiency, whenever you perform multiple independent operations,
invoke all relevant tools simultaneously rather than sequentially.
```

---

## Claude Code Tool Integration

### In Skills

Skills inherit all tools by default or restrict via `allowed-tools`:

```yaml
---
name: my-skill
tools: Read, Write, Edit, Glob, Grep, Bash, Skill
---
```

### In Agents

Agents may inherit the parent tool surface or intentionally scope tools for security and focus:

```yaml
---
name: code-reviewer
tools: Read, Grep, Glob
---
```

### In Commands

Commands specify `allowed-tools` in frontmatter:

```yaml
---
allowed-tools: Read, Glob, Grep
---
```

---

## Tool Choice Simulation in Claude Code

Claude Code agents cannot directly set `tool_choice` but can simulate via tool restrictions + prompting:

| Desired Behavior | Claude Code Pattern | Equivalent `tool_choice` |
| --- | --- | --- |
| Evidence-first analysis | Start with Glob/Grep/Read, keep full capability for scoped fixes when requested | Simulates `auto` with guidance |
| Forced structured output | Single tool + "MUST use this tool" prompt | Simulates `tool` |
| Always take action | "NEVER respond without using a tool first" prompt | Simulates `any` |
| Guidance without forcing | Full tools + "prefer X for Y scenarios" prompt | `auto` with guidance |

### Review Agent Pattern

Review agents should prioritize findings first and may apply scoped fixes when the caller requests implementation. Keep tool narrowing out of the default template unless the role has an explicit compliance boundary.

### Orchestrator Command Pattern

Commands that dispatch subagents should state whether the orchestrator may apply integration edits directly or must delegate them. Keep `Edit`/`Write` available when the command is expected to land scoped changes.

---

## Mandatory Tool Patterns

### Mandatory Tool Sequence

Skills requiring specific tool order enforce via numbered steps with verification:

```markdown
## Mandatory Workflow

You MUST execute these tools in order:

1. **Read** the current schema
2. **Bash** to generate migration
3. **Write** the migration SQL
4. **Bash** to apply and verify

NEVER skip steps. NEVER proceed if any step fails.
```

### Mandatory Skill Invocation

Two-layer enforcement for commands requiring skill invocation:

1. **Step 0 with MANDATORY label** -- Explicit `Skill({ skill: "..." })` call
2. **Rationalization Red Flag** -- Counter in red flags table

---

## MCP Tool Integration

Convert MCP tools to Claude format by renaming `inputSchema` to `input_schema`:

```typescript
const claudeTool = {
  name: mcpTool.name,
  description: mcpTool.description ?? "",
  input_schema: mcpTool.inputSchema,
};
```

## Error Handling

- Return errors with `is_error: true` in `tool_result`
- Claude will retry with corrections (2-3 attempts)
- Add `strict: true` to tool definitions for guaranteed schema conformance

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
| --- | --- | --- |
| `any` with conversational queries | Forced unnecessary tool calls | Use `auto` with guidance |
| `tool` for optional operations | Rigid, inflexible behavior | Use `auto` with preference prompting |
| No guidance with `auto` | Inconsistent tool usage | Add system prompt guidance |
| `any` with extended thinking | Runtime error | Use `auto` instead |

## Pricing Considerations

| Tool Choice    | Additional Tokens |
| -------------- | ----------------- |
| `auto`, `none` | 346 tokens        |
| `any`, `tool`  | 313 tokens        |

## Related References

- [agents-patterns.md](agents-patterns.md) - Agent system prompt patterns
- [commands-patterns.md](commands-patterns.md) - Command implementation
- [hooks-reference.md](hooks-reference.md) - Lifecycle hooks
