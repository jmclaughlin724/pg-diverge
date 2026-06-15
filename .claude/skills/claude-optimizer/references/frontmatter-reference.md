# Frontmatter Reference

Complete YAML frontmatter validation rules for Skills, Agents, and Commands as of April 2026.

> **Source of truth:** <https://code.claude.com/docs/en/skills>. When that page contradicts this file, the official docs win — open a PR updating this reference. Fields flagged "Custom" are repo-only extensions parsed by `.claude/hooks/skill-matcher/skill-matcher.ts` and `scripts/llm-sync/sync-skill-targets.mjs`, not by Claude Code itself.

## Contents

- [Common Fields](#common-fields)
- [Skills-Specific Fields](#skills-specific-fields)
- [Agents-Specific Fields](#agents-specific-fields)
- [Commands-Specific Fields](#commands-specific-fields)
- [Validation Checklist](#validation-checklist)
- [Description Formula](#description-formula)
- [Complete Examples](#complete-examples)

---

## Common Fields

### name (Optional for Skills, Required for Agents)

The identifier. Claude uses this for discovery and invocation. For skills, defaults to the directory name if omitted.

**Requirements:**

- Maximum **64 characters**
- Lowercase letters, numbers, hyphens only
- Cannot contain "anthropic"
- For skills: defaults to directory name — omit unless you need a different name
- Gerund form recommended (verb + -ing)

**Good examples:**

```yaml
name: processing-pdfs
name: analyzing-spreadsheets
name: generating-commit-messages
name: database-workflow
```

**Bad examples:**

```yaml
name: This-Is-Too-Long-And-Exceeds-Limit  # Wrong case, too long
name: pdf_processor  # Underscores not allowed; `anthropic` is also reserved
```

### description (Recommended for Skills, Required for Agents and Commands)

Determines when Claude invokes the configuration. This is the most critical field.

**Requirements:**

- **Skills:** `description` + optional `when_to_use` are concatenated in the skill listing and truncated at **1,536 characters combined** (official cap from <https://code.claude.com/docs/en/skills>). Front-load the key use case — if the combined text exceeds the cap, later content is dropped.
- **Agents and commands:** keep description ≤1024 characters. Agents use `<example>` tags in the body of the description.
- Third person (prefer "Use when …" over "I/you …").
- Must include WHEN to use (triggers) and WHAT it does (capabilities).
- Agent descriptions use `<example>` tags; skill descriptions should avoid XML tags so they render cleanly in the listing.
- Avoid the literal token "anthropic" in `name` — there is no published prohibition on it inside `description` prose, but keep it out of skill names.

**Pattern:** Start with "Use when..." then describe capabilities. For skills, put trigger phrases ("User says: 'deploy this', 'ship it'") in a separate `when_to_use` field so matching improves without blowing the cap.

**Startup token budget:** All skill listings share a single pool. The effective default is **1% of the session context window with a fallback floor of ~8,000 characters** — not the older 15,000-char number. Raise via `SLASH_COMMAND_TOOL_CHAR_BUDGET` only when `/context` shows pressure from listings.

---

## Skills-Specific Fields

| Field | Required | Type | Default | Description | Source |
| --- | --- | --- | --- | --- | --- |
| `name` | No | string | dir name | Kebab-case identifier. Defaults to directory name. ≤64 chars. | Official |
| `description` | Recommended | string | - | When/why to invoke. Drives auto-invocation. Combined cap with `when_to_use` = 1,536 chars. | Official |
| `when_to_use` | No | string | - | Trigger-phrase supplement appended to `description` in listings. Shares the 1,536 cap. | Official |
| `argument-hint` | No | string | - | Hint shown during autocomplete (e.g., `[issue-number]`) | Official |
| `allowed-tools` | No | string or list | all | Tool pre-approval (space-separated string OR YAML list). Does not restrict tool access. | Official |
| `paths` | No | string or list | - | Glob patterns gating auto-activation (comma-separated string OR YAML list). | Official |
| `shell` | No | string | `bash` | `bash` or `powershell` (PowerShell requires `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`). | Official |
| `effort` | No | string | inherit | `low`/`medium`/`high`/`xhigh`/`max`. Overrides session effort (not the `CLAUDE_CODE_EFFORT_LEVEL` env var). See [effort-and-thinking.md](effort-and-thinking.md). | Official |
| `user-invocable` | No | boolean | true | User can invoke directly via `/name` | Official |
| `disable-model-invocation` | No | boolean | false | Blocks Claude from auto-invoking; user `/` menu still works unless `user-invocable:false`. | Official |
| `context` | No | string | inherit | Set to `fork` for isolated subagent context | Official |
| `agent` | No | string | general-purpose | Subagent type when `context: fork` is set | Official |
| `model` | No | string | inherit | Model to use when this skill is active | Official |
| `hooks` | No | object | - | Hooks scoped to this skill's lifecycle | Official |
| `keywords` | No | array | - | (Inside `metadata`) Literal keyword terms for matching | Custom |
| `intent-patterns` | No | array | - | (Inside `metadata`) Regex patterns for multi-word intent matching | Custom |
| `file-triggers` | No | array | - | (Inside `metadata`) Glob patterns for file-path matching (2x weight) | Custom |
| `bash-triggers` | No | array | - | (Inside `metadata`) Regex for bash commands (planned, not yet in hook) | Custom |
| `priority` | No | number | - | (Inside `metadata`) Display priority for ordering | Custom |
| `docs` | No | array | - | (Inside `metadata`) URLs to external documentation | Custom |
| `relatedSkills` | No | array | - | Skills that may be invoked alongside this one | Custom |
| `category` | No | string | - | Primary category for smart categorization | Custom |
| `validate` | No | array | - | File-content validation rules with regex patterns | Custom |
| `chainTo` | No | array | - | Skill chaining rules — queue companion skills after invocation | Custom |
| `retrieval` | No | object | - | Enhanced discovery metadata (aliases, intents, entities) | Custom |

> **Note:** Fields marked "Custom" are project-specific additions not in official Anthropic documentation. Fields marked "Official" are from the [Skills documentation](https://code.claude.com/docs/en/skills).

### Invocation Control

Skills support two independent invocation controls:

| Field | Effect When `true` | Use Case |
| --- | --- | --- |
| `user-invocable: false` | Hidden from user's `/` menu; Claude can invoke | Background knowledge, internal ref |
| `disable-model-invocation` | Context-only: matches keywords, loads via Read | Destructive ops, production deploy |

**Example: Manual-only skill for dangerous operations**

```yaml
---
name: database-reset
description: Use when completely resetting development database - destructive operation
disable-model-invocation: true
---
```

**Example: Background skill hidden from users**

```yaml
---
name: coding-standards
description: Team coding conventions - loaded automatically when generating code
user-invocable: false
---
```

See [skill-detection-enforcement.md](skill-detection-enforcement.md) for detailed invocation patterns.

### Context Field

Skills can use `context: fork` to run in isolation when they need separate context windows or perform operations that might affect the main conversation. This creates a subagent with its own context, preventing side effects in the parent conversation. This is the inverse of `skills:` in a subagent — `context: fork` lets a _skill_ inject its content into a specified agent, while `skills:` lets a _subagent_ choose skills to preload into its own context. Same underlying system, different owner.

**Caveat:** `context: fork` only makes sense for skills with explicit task instructions in the body. Reference-only skills produce no meaningful output when forked because the subagent has no directive to act on. Use `context: fork` when the skill is a _worker_, not a _handbook_.

### Official Field Detail: `when_to_use`, `effort`, `paths`, `shell`

- **`when_to_use`** — separate field appended to `description` in the skill listing. Counts toward the **combined 1,536-character cap** shared with description. Use for trigger phrases ("Use when user asks to …") while keeping `description` focused on capabilities.
- **`effort`** — `low` / `medium` / `high` / `xhigh` / `max` (`xhigh` and `max` need Opus 4.8/4.7; `xhigh` falls back to `high` on Opus 4.6/Sonnet 4.6). Overrides the session effort level but **not** the `CLAUDE_CODE_EFFORT_LEVEL` env var. Use for skills that reliably need deep reasoning (e.g. architecture review, adversarial verification). Full effort system: [effort-and-thinking.md](effort-and-thinking.md).
- **`paths`** — glob patterns that gate auto-activation. Comma-separated string **or** YAML list. Skill only matches when the user's working file matches at least one pattern. Complements the repo-custom `metadata.file-triggers` — `paths` is the official gate, `file-triggers` is the repo-custom scoring signal.
- **`shell`** — `bash` (default) or `powershell`. PowerShell dispatch requires `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` in settings. Leave unset unless the skill is Windows-only.

```yaml
---
name: vercel-deploy
description: Use when deploying a Next.js app to Vercel
when_to_use: "User says: 'deploy this', 'ship to production', 'push to Vercel'"
effort: high
paths: "apps/**/vercel.json, apps/**/next.config.*"
allowed-tools: Bash(vercel *) Read Glob
---
```

### Repo-Custom Extensions — `validate`, `chainTo`, `retrieval`, `metadata.*`

These are **not** part of the official Claude Code skill schema. They are parsed by `.claude/hooks/skill-matcher/skill-matcher.ts` and validated only when the explicit skill validator is requested.

See [skill-frontmatter-schema.md](skill-frontmatter-schema.md) for the formal validate / chainTo / retrieval spec, failure modes, and copy-paste templates. Future Anthropic field additions may collide with these names — treat them as project scoped until Anthropic documents equivalents.

### Example

```yaml
---
name: security-scanning
description: Use when auditing code for vulnerabilities - performs static analysis without executing potentially dangerous code
allowed-tools: [Read, Grep, Glob]
user-invocable: true
---
```

---

## Agents-Specific Fields

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `name` | Yes | string | Kebab-case identifier |
| `description` | Yes | string | When/why to invoke (with `<example>` tags) |
| `tools` | No | comma-separated string | Allowed tools; omit to inherit all |
| `disallowedTools` | No | comma-separated string | Denylisted tools removed from inherited/specified tool list |
| `model` | No | string | `sonnet`/`opus`/`haiku`, full model ID (`claude-opus-4-8`), or `inherit` |
| `permissionMode` | No | string | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | No | number | Maximum number of agentic turns before the subagent stops |
| `skills` | No | array | Skill names to preload into subagent startup context; use sparingly |
| `mcpServers` | No | array/object | MCP servers available to the subagent (`stdio`, `http`, `sse`, or `ws`) |
| `hooks` | No | object | Lifecycle hooks scoped to agent (see below) |
| `memory` | No | string | Persistent memory scope: `user`, `project`, or `local` |
| `color` | No | string | Visual identification in UI (`red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`) |
| `background` | No | boolean | Always run as background task; pre-approve permissions before launch |
| `effort` | No | string | `low`/`medium`/`high`/`xhigh`/`max`; overrides session effort (not the `CLAUDE_CODE_EFFORT_LEVEL` env var). See [effort-and-thinking.md](effort-and-thinking.md) |
| `isolation` | No | string | `worktree` runs the agent in a temporary git worktree |
| `initialPrompt` | No | string | Auto-submitted first user turn when the agent runs as main session (`--agent`) |

### Hooks Format (Agents and Skills)

The `hooks` field defines lifecycle event handlers using a three-level nesting structure:

```yaml
hooks:
  EventName: # One of 30 hook events
    - matcher: "regex" # Optional: filter by tool/source/type
      hooks: # Array of handlers
        - type: command|http|prompt|agent
          command: "..." # command type only
          prompt: "..." # prompt/agent types only
          timeout: 60 # seconds (optional)
          once: true # skills only: run once per session
```

**Four handler types:** `command` (shell), `http` (JSON POST to URL), `prompt` (single-turn LLM yes/no), `agent` (multi-turn subagent with tools).

**Common events:** `PreToolUse`, `PostToolUse`, `Stop` (auto-converted to `SubagentStop` for agents), `SessionStart`.

See [hooks-reference.md](hooks-reference.md) for all 30 events, matcher patterns, decision control, and complete examples.

**`skills` guidance:** Preload skills only when the agent definitely needs them at startup (the full body is injected). Do not use `memory:` or `MEMORY.md` for Anilize durable lessons; promote repo lessons into rules, hooks, skills, or AGENTS briefs.

**⚠️ `mode: subagent` IS NOT A CLAUDE CODE FIELD.** This field belongs to OpenCode format only. The PostToolUse hook runs `.opencode/scripts/sync-from-claude.ts` after edits to `.claude/agents/` files — that script transforms Claude Code format to OpenCode format (replacing `name:` with `mode: subagent`, converting `tools:` to objects, converting named colors to hex). This is an intentional **one-way sync** (`.claude/` → `.opencode/`). Never manually add `mode: subagent` to `.claude/agents/*.md` files — the `name` field is required and must always be present.

**Sync script safety guards:** The script includes three guards to prevent source file corruption:

| Guard | Location | Purpose |
| --- | --- | --- |
| Symlink detection (`syncDirectory`, `syncSkills`) | Before writing agents/commands/skills | Removes symlinks at destination to prevent writing through them back to `.claude/` |
| Symlink skip (`copyRecursive`) | During recursive copy | Uses `lstatSync` and skips all symlinks to avoid following dangling or malicious links |
| Idempotency (`syncDirectory`) | Before transforming agents | Skips files that appear already in OpenCode format (have `mode:` but no `name:`) |

### Description with Examples (Required for Agents)

Agent descriptions MUST include `<example>` tags:

```yaml
description: |
  Security vulnerability specialist. Reviews code for OWASP issues,
  authentication flaws, data exposure. Use after implementing auth or APIs.

  <example>
  context: User implemented OAuth login
  user: "Review auth code for security"
  assistant: "Using security-auditor agent to analyze..."
  </example>
```

### Description Constraints

| Constraint | Limit | Rationale |
| --- | --- | --- |
| **Total length** | ≤1024 chars | Fits in metadata, reduces startup tokens |
| **Examples** | Max 2 | More adds noise without improving routing |
| **Trigger phrases** | 5-7 items | Enough for matching, not overwhelming |
| **Commentary tags** | NONE | Move `<commentary>` to body, not description |

### Model Selection

| Model    | Best For                         | Context Window |
| -------- | -------------------------------- | -------------- |
| `haiku`  | Fast searches, simple analysis   | Smallest       |
| `sonnet` | General coding, complex analysis | Medium         |
| `opus`   | Architecture, nuanced reasoning  | Largest        |

### Permission Modes

| Mode                | Behavior                                            |
| ------------------- | --------------------------------------------------- |
| `default`           | Normal permission prompts                           |
| `acceptEdits`       | Auto-accept file edits, prompt for other actions    |
| `dontAsk`           | Auto-deny all permission prompts                    |
| `bypassPermissions` | Skip all permission checks                          |
| `plan`              | Planning mode; generates plans instead of executing |

### Example

```yaml
---
name: code-reviewer
description: |
  Expert code review specialist. Reviews code for quality, security,
  and maintainability. Use proactively after implementing features.

  <example>
  context: User finished implementing auth flow
  user: "Review the authentication code"
  assistant: "Using code-reviewer agent to analyze..."
  </example>
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
model: sonnet
permissionMode: default
---
```

---

## Commands-Specific Fields

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `description` | Yes | string | Short description shown in command list |
| `argument-hint` | No | string | Placeholder showing expected input format |
| `model` | No | string | Override model for this command |
| `allowed-tools` | No | string | Tool restrictions |
| `context` | No | string | Set to `fork` for subagent isolation |

### Example

```yaml
---
description: Debug issues using parallel agents
argument-hint: <error-or-issue>
model: sonnet
allowed-tools: Read, Glob, Grep, Task, TaskOutput, TaskCreate, TaskUpdate, TaskList, TaskGet, Skill
---
```

### Argument and Environment Substitutions

Skills/commands receive user input and runtime metadata via special tokens. The runtime substitutes them before Claude sees the rendered body.

| Token | Content |
| --- | --- |
| `$ARGUMENTS` | Full argument string passed after the slash command |
| `$ARGUMENTS[N]` | Nth argument using shell-style quoting (0-indexed) |
| `$N` | Shorthand for `$ARGUMENTS[N]` — e.g. `$0`, `$1` |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Absolute path to this skill's directory (for plugin skills: skill subdir, NOT plugin root) — use for bundled script lookups |

If the body does not reference `$ARGUMENTS` but the user passed args, the runtime appends a literal `ARGUMENTS: <value>` line so Claude sees them.

### Inline Preprocessing Prefixes

| Prefix | Meaning |
| --- | --- |
| `` !`cmd` `` | Shell-execute `cmd` **before Claude reads the body**; output replaces the placeholder |
| ` `! ... ` ` | Fenced block variant — the whole fence is executed and replaced |
| `@path/to/file` | Inject file contents at read time |
| `ultrathink` (keyword) | Anywhere in body enables extended thinking for the skill's execution |

Preprocessing runs at **render time**, not via the Bash tool — `allowed-tools` does not need `Bash(cmd *)` for `` !`cmd` `` to run. It CAN be disabled org-wide via settings `"disableSkillShellExecution": true` (bundled/managed skills are exempt). See [dynamic-context-and-runtime.md](dynamic-context-and-runtime.md) for full preprocessing semantics.

---

## Validation Checklist

### All Types

- [ ] YAML uses spaces, not tabs
- [ ] No trailing whitespace
- [ ] Proper string quoting for special characters

### Skills

- [ ] name (if set) is lowercase-with-hyphens, ≤64 characters, no "anthropic"/"claude"
- [ ] name defaults to directory name if omitted — no need to set explicitly
- [ ] description uses third person and starts with "Use when..."
- [ ] `description` + `when_to_use` combined stay ≤1,536 characters (official cap; listings truncate beyond)
- [ ] trigger phrases live in `when_to_use`, capability prose lives in `description`
- [ ] description lists specific capabilities; avoid XML tags so listings render cleanly
- [ ] `paths` globs match at least one real source file if used
- [ ] `allowed-tools` uses space-separated string OR YAML list (both accepted)
- [ ] validate rules have valid regex in `pattern` and optional `skipIfFileContains`
- [ ] chainTo rules reference real skill names in `targetSkill`
- [ ] retrieval aliases, intents, and entities are string arrays (not nested objects)

### Agents

- [ ] All skill checklist items pass
- [ ] description includes `<example>` tags (max 2)
- [ ] No `<commentary>` tags in description
- [ ] tools restricted to minimum needed (or omit for full access)
- [ ] model appropriate for task complexity
- [ ] permissionMode set appropriately

### Commands

- [ ] description clearly explains what command does
- [ ] argument-hint describes expected input (or omit if none)
- [ ] $ARGUMENTS referenced in body if accepting input

---

## Description Formula

Use this template:

```
Use when [specific trigger scenario(s)] - [capability 1], [capability 2], [key approach]
```

**Examples by type:**

```yaml
# Skill
description: Use when working with PDF files or extracting document content - extracts text and tables, fills forms, merges documents using pdfplumber

# Agent
description: |
  Security vulnerability specialist. Reviews code for OWASP issues,
  authentication flaws, data exposure. Use after implementing auth or APIs.

  <example>
  context: User implemented OAuth login
  user: "Review auth code for security"
  assistant: "Using security-auditor agent..."
  </example>

# Command
description: Create a well-formatted commit following repository conventions
```

---

## Complete Examples

### Skill

```yaml
---
name: database-workflow
description: Use when executing Supabase schema changes - provides idempotent patterns, migration generation, drift detection
---
```

### Agent (Review)

```yaml
---
name: code-reviewer
description: |
  Expert code review specialist. Reviews code for quality, security,
  and maintainability. Use proactively after implementing features.

  <example>
  context: User finished implementing auth flow
  user: "Review the authentication code"
  assistant: "Using code-reviewer agent to analyze..."
  </example>
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
model: sonnet
permissionMode: default
---
```

### Command (With arguments)

```yaml
---
description: Create a database migration for schema changes
argument-hint: <table-or-change-description>
model: opus
---
```

---

## Sources

### Official Anthropic Documentation

- [Claude Code Skills](https://code.claude.com/docs/en/skills) — Skills and commands frontmatter specification. Last verified 2026-04-15.
- [Claude Code Agents](https://code.claude.com/docs/en/agents) — Agents frontmatter specification
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices) — Conciseness and content guidelines

### Related repo references

- [dynamic-context-and-runtime.md](dynamic-context-and-runtime.md) — runtime features not covered by frontmatter alone
- [skill-frontmatter-schema.md](skill-frontmatter-schema.md) — repo-custom `validate` / `chainTo` / `retrieval` formal schema

### Validation

- Field constraints verified against Claude Code CLI validation (2026-04-15)
- Character limits taken directly from official docs, not estimated from production skills
