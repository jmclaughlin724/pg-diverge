# Subagent Examples

Canonical YAML frontmatter examples, sibling to `subagent-configuration.md`. Extracted to keep the main reference within the 500-line cap.

## Permission Mode Examples

```yaml
# Explore agent -- evidence gathering
name: explore
tools: Read, Write, Edit, Glob, Grep, Bash, mcp__*

# Developer agent -- auto-approve edits
name: developer
permissionMode: acceptEdits
tools: Read, Write, Edit, Glob, Grep, Bash

# CI agent -- fully autonomous
name: ci-runner
permissionMode: bypassPermissions
```

## Explore Agent

```yaml
---
name: explore
description: |
  Deep research specialist for technical investigations requiring synthesis
  from multiple sources. Use when current/authoritative information is needed,
  existing context is insufficient, or when validating approaches.
  Do NOT use for implementation (use developer) or debugging (use debugger).

  <example>
  context: Evaluating authentication strategies
  user: "Research JWT vs session-based auth for our use case"
  assistant: "Using explore agent to analyze both approaches..."
  </example>
model: haiku
tools: Read, Write, Edit, Glob, Grep, Bash, mcp__perplexity__search, mcp__perplexity__reason
color: cyan
---
```

## Full Development Agent

```yaml
---
name: developer
description: |
  Implementation specialist that prioritizes code reuse over creation and
  enforces zero-violation quality gates. Use when specifications are complete,
  production-ready code with tests is needed, or extending existing services.
  Do NOT use for architecture decisions (use architect) or debugging (use debugger).

  <example>
  context: Architect provided complete specifications
  user: "Implement the user authentication flow"
  assistant: "Using developer agent to implement with code reuse analysis."
  </example>
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion, Skill
color: blue
---
```

> `Task` was renamed to `Agent` in Claude Code 2.1.63. Both spellings resolve to the same tool; prefer `Agent` in new definitions. Existing `Task, TaskOutput` entries remain valid aliases.

## Orchestrator Agent with Hooks

```yaml
---
name: debugger
description: |
  Debugging orchestrator specializing in systematic error classification
  and specialist coordination. Use for complex bugs requiring multi-step
  investigation. Do NOT use for simple fixes (use developer).

  <example>
  context: TypeScript compilation error in production build
  user: "Getting build error: Property 'variant' does not exist"
  assistant: "Using debugger agent to systematically investigate."
  </example>
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill, mcp__sentry__search_issues
color: cyan
hooks:
  Stop:
    - hooks:
        - type: prompt
          prompt: "Verify root cause was identified and fix was validated: $ARGUMENTS"
---
```

## Main-Session Agent with `initialPrompt`

```yaml
---
name: pr-reviewer
description: |
  Reviews diffs against repo conventions. Use for PR passes when
  the session has already landed on a branch.

  <example>
  context: branch has diff vs main
  user: "review my changes"
  assistant: "Using pr-reviewer agent to analyze the diff..."
  </example>
model: sonnet
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
initialPrompt: "Start by running `git diff origin/main...HEAD` and classifying each hunk."
---
```

`initialPrompt` is auto-submitted as the first user turn **only when the agent runs as the main session** (via `claude --agent` or the `agent` setting). It does not fire when the agent is spawned as a subagent through the Agent tool. Commands and skills are processed; the prompt is prepended to any user-provided prompt.

## Budget-Constrained Agent with `effort`

```yaml
---
name: cheap-lookup
description: |
  Fast fact lookups in docs and config files. Use when the answer is a
  one-liner and the session is token-bound.

  <example>
  context: asked which port Next.js dev server uses
  user: "what port does next dev use by default"
  assistant: "Using cheap-lookup agent..."
  </example>
model: haiku
effort: low
tools: Read, Glob, Grep
permissionMode: plan
---
```

`effort` accepts `low`, `medium`, `high`, `xhigh`, or `max` (`xhigh`/`max` on Opus 4.8/4.7; `xhigh` falls back to `high` on Opus 4.6/Sonnet 4.6). It overrides the session effort level while the agent is active (but not the `CLAUDE_CODE_EFFORT_LEVEL` env var) and is distinct from `model` — an Opus agent with `effort: low` spends fewer reasoning tokens than the session default. See [effort-and-thinking.md](effort-and-thinking.md).

## Sources

- [Claude Code Sub-Agents](https://code.claude.com/docs/en/sub-agents)
- Parent reference: `subagent-configuration.md`
