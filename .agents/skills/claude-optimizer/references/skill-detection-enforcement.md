# Skill Detection and Enforcement

How Claude discovers, activates, and reliably invokes skills. This reference covers detection mechanics, invocation control, and enforcement patterns that achieve ~84% invocation rates.

## Contents

- [Detection Mechanism](#detection-mechanism)
- [Three-Tier Loading Architecture](#three-tier-loading-architecture)
- [Invocation Types](#invocation-types)
- [Invocation Control Frontmatter](#invocation-control-frontmatter)
- [Hook-Based Enforcement](#hook-based-enforcement)
- [Forced-Eval Checkpoint Pattern](#forced-eval-checkpoint-pattern)
- [Rationalization Prevention](#rationalization-prevention)
- [Invocation Rate Comparison](#invocation-rate-comparison)

---

## Detection Mechanism

This project uses a **dual-layer** discovery system. The two layers are additive — both contribute to whether a skill gets invoked.

### Layer 1: Hook-Based Matching (Primary, Enforced)

The shared agent hook layer intercepts every user prompt at the `UserPromptSubmit` event and records deterministic skill requests using explicit skill tokens and curated metadata:

| Metadata Field | Signal Type |
| --- | --- |
| Explicit skill name | `$skill`, `/skill`, and non-generic skill directory names in prompt text |
| `keywords` | Delimiter-aware matches against user prompt text |
| `file-triggers` | Structured tool payload paths and patch headers matched during `PreToolUse` |

When the hook finds a prompt match, it records the skill as pending and injects model-facing context. `PreToolUse` then allows an observable skill load and blocks governed work only when the tool call is not a skill load. See [skill-matcher-patterns.md](skill-matcher-patterns.md) for scoring details and state behavior.

### Layer 2: Claude's Native Matching (Secondary, Advisory)

Claude also reads skill metadata (name + description) at startup and may invoke skills based on natural language understanding. This is the default Claude Code behavior and is additive to the hook system — it catches cases the keyword matcher misses.

| Aspect | How It Works |
| --- | --- |
| Detection method | LLM reasoning over textual descriptions |
| Decision location | Inside Claude's transformer forward pass |
| Primary signal | The `description` field in YAML frontmatter |
| Limitation | ~50% reliable on its own; rationalizations reduce activation |

### What This Means for Skill Authors

1. **Optimize metadata for the hook first** — `keywords` and `file-triggers` are the enforced discovery path
2. **Descriptions still matter** — They're Claude's native signal and catch intent the hook misses
3. **Trigger phrases matter** — Include words users actually say in both `keywords` and `description`
4. **Capabilities must be stated** — Claude can't infer unstated abilities from either layer
5. **Vague descriptions fail** — "Helps with documents" won't activate reliably in either layer

---

## Three-Tier Loading Architecture

Skills use progressive disclosure to minimize context window usage:

| Level | When Loaded | Token Cost | Content |
| --- | --- | --- | --- |
| **Metadata** | Startup | ~100 tokens/skill | name + description from YAML |
| **Instructions** | When triggered | <5,000 tokens | Full SKILL.md body |
| **Resources** | On-demand (model `Read`s them) | Unlimited | Reference files, scripts, assets — markdown-link/path only; `@`-mentions are inert in `SKILL.md` |

### Character Budget

- **Default**: 1% of the session context window (≈8,000-character floor); the older 15,000-char figure is wrong — see [dynamic-context-and-runtime.md §11](dynamic-context-and-runtime.md)
- **Per listing**: `description` + `when_to_use` are concatenated and truncated at 1,536 characters
- **Check**: `/context` (or `/doctor`) to see current usage and overflow
- **Adjust**: `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var or the `skillListingBudgetFraction` setting

### Implications

- Claude pre-loads **only metadata** at startup, keeping context lean
- Full skill content loads **only when Claude determines relevance**
- Reference files load **only when the model `Read`s them**; `@references/x.md` does **not** force-load (see [dynamic-context-and-runtime.md §1a](dynamic-context-and-runtime.md))
- Scripts execute via Bash—only output enters context
- Keep `SKILL.md` focused on the minimal workflow and move examples, checklists, and edge cases into references
- Do not duplicate `CLAUDE.md` or `.claude/rules` content in skills unless the skill must restate a task-local exception

---

## Invocation Types

| Trigger Type | Mechanism | When Used |
| --- | --- | --- |
| **Automatic** | Claude reads descriptions, matches user intent | Default behavior |
| **Manual** | User types `/skill-name` | Always available |
| **Context-only** | `disable-model-invocation: true` | Config, destructive |
| **Hidden** | `user-invocable: false` | Background knowledge |

### Automatic Invocation

Default behavior. Claude activates skills when task matches description triggers.

```yaml
---
name: database-workflow
description: Use when executing Supabase schema changes - provides idempotent patterns, migration generation, drift detection
---
```

### Context-Only (Disabled Model Invocation)

Skill still participates in keyword/file-trigger matching but loads via Read of its SKILL.md instead of the Skill tool. The pending gate clears when the SKILL.md is read.

```yaml
---
name: deploy-production
description: Use when deploying to production - handles zero-downtime deployments and rollback procedures
disable-model-invocation: true
---
```

**Use for:**

- Destructive operations (migrations, deletions)
- Production deployments
- Operations with significant cost
- Workflows requiring explicit user intent

### Hidden Skills

Visible to Claude but hidden from user's `/` menu. Claude can auto-invoke based on description.

```yaml
---
name: internal-patterns
description: Background reference for team coding conventions - loaded automatically when generating code
user-invocable: false
---
```

**Use for:**

- Background knowledge/context
- Internal reference patterns
- Skills that shouldn't clutter user's menu
- Automatically-loaded supporting skills

---

## Invocation Control Frontmatter

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `disable-model-invocation` | boolean | false | Context-only: matches keywords, loads via Read |
| `user-invocable` | boolean | true | Show in user's slash command menu |
| `allowed-tools` | array | all | Restrict available tools when active |
| `context` | string | inherit | Set to `fork` for isolated subagent |

### Combining Controls

```yaml
# Dangerous operation: manual-only, restricted tools, isolated context
---
name: database-reset
description: Use when completely resetting development database - destructive operation that cannot be undone
disable-model-invocation: true
allowed-tools: [Bash]
context: fork
---
```

```yaml
# Background reference: auto-invoke allowed, but not in user menu
---
name: coding-standards
description: Team coding conventions for TypeScript and React - automatically loaded when generating code
user-invocable: false
allowed-tools: [Read]
---
```

---

## Hook-Based Enforcement

Descriptions alone achieve ~50% reliable invocation. Hook-based enforcement achieves ~84%.

### Architecture

Hooks intercept Claude's workflow at key points:

| Hook Event         | Fires When          | Use For                         |
| ------------------ | ------------------- | ------------------------------- |
| `SessionStart`     | Conversation begins | Load mandatory context          |
| `UserPromptSubmit` | User sends message  | Detect skills, prepend commands |

### Dual-Method Activation

The most reliable pattern uses both `updatedPrompt` and `additionalContext`:

```typescript
const userPromptSubmitHandler = async (payload) => {
  const matches = detectSkills(prompt, domains);

  // Method 1: Prepend skill commands to force execution
  const skillCommands = matches.map((m) => `/${m.skill}`).join("\n");
  const updatedPrompt = `${skillCommands}\n\n${prompt}`;

  return {
    decision: "approve",
    updatedPrompt, // Forces skill invocation at token generation level
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: formatContext(matches), // Forced-eval pattern
    },
  };
};
```

### How It Works

1. **Keyword Detection**: Hook scans user prompt for domain keywords
2. **Skill Matching**: Keywords map to relevant skills via configuration
3. **Prompt Modification**: Prepends `/skill-name` commands to user message
4. **Context Injection**: Adds forced-eval checkpoint requiring YES/NO decision

---

## Forced-Eval Checkpoint Pattern

The checkpoint pattern requires Claude to explicitly state whether it will invoke a skill:

```
[Skill Detector] MANDATORY EVALUATION REQUIRED:

## Forced-Eval Checkpoint (DO NOT SKIP)

**Skill: database-workflow**
- Category: database migration
- Keyword detected: "create table"
- Decision: [STATE "YES - invoking now" or "NO - reason"]

**If YES:** Invoke the skill IMMEDIATELY using the Skill tool.
**If NO:** You must provide a specific reason why this skill doesn't apply.

**BLOCKED RATIONALIZATIONS:**
- "This was research/verification" -> Research BENEFITS from skills
- "This is straightforward/simple" -> Simple tasks need skills most
- "I already know how" -> Knowing != using the skill
```

### Why It Works

1. **Explicit Decision**: Claude must write YES or NO, not skip silently
2. **Accountability**: Requires stating a reason for NO
3. **Blocked Excuses**: Pre-empts common rationalizations
4. **Token-Level Forcing**: Prepending `/skill` triggers tool invocation

---

## Rationalization Prevention

Claude tends to rationalize why skills aren't necessary. Counter with explicit blockers:

### Common Rationalizations (Red Flags)

| Thought                            | Reality                                |
| ---------------------------------- | -------------------------------------- |
| "This is just a simple question"   | Questions are tasks. Check for skills. |
| "I need more context first"        | Skill check comes BEFORE clarifying.   |
| "Let me explore the codebase"      | Skills tell you HOW to explore.        |
| "I can check git/files quickly"    | Files lack conversation context.       |
| "This doesn't need a formal skill" | If a skill exists, use it.             |
| "I remember this skill"            | Skills evolve. Read current version.   |
| "The skill is overkill"            | Simple things become complex. Use it.  |
| "I'll just do this one thing"      | Check BEFORE doing anything.           |

### Prevention Strategies

1. **Separate "when to use" from "what it does"** — Focus descriptions on triggers
2. **Block specific rationalizations** — List them explicitly in hooks or skill body
3. **Session boundary rules** — Prior context doesn't count; evaluate fresh
4. **Forced-eval checkpoints** — Require explicit YES/NO before proceeding

---

## Invocation Rate Comparison

| Method | Effectiveness | Mechanism |
| --- | --- | --- |
| Description quality alone | ~50% | Claude reasons, may rationalize skipping |
| Imperative language ("MUST") | Minimal gain | Claude follows words, doesn't enforce tools |
| Hook-based forced-eval | ~84% | Prepends /skill + requires YES/NO evaluation |
| **Blocking enforcement** | **~95%+** | PreToolUse "deny" blocks Edit/Write until invoked |
| `tool_choice: {type: "any"}` | 100% (API) | Forces tool call at API level; not for skills |
| Programmatic orchestration | Most reliable | Code-based tool calling for critical flows |

### Key Insight

Natural language imperatives like "MUST use this tool" are not enforced. The most reliable patterns:

1. **Hook-based enforcement** — Prepend `/skill` to prompt + forced-eval checkpoint (~84%)
2. **Blocking enforcement** — PreToolUse hook with `permissionDecision: "deny"` (~95%+)
3. **Programmatic orchestration** — Code-based tool calling for critical workflows (100%)

### Blocking Enforcement (Recommended)

The `skill-enforcer.ts` hook uses `permissionDecision: "deny"` to block Edit/Write/MultiEdit operations until detected skills have been invoked:

```typescript
return {
  permissionDecision: "deny",
  permissionDecisionReason: `⛔ BLOCKED: Skills not invoked: ${uninvokedList}

  **REQUIRED ACTION:** Invoke skills before implementation:
  ${uninvokedSkills.map((s) => `  Skill({ skill: "${s}" })`).join("\n")}`,
};
```

This achieves ~95%+ activation because Claude cannot proceed with implementation until skills are invoked - the tool call is rejected outright.

---

## Implementation Example

For a complete hook implementation, see:

- `.claude/hooks/skill-detector/index.ts` — Main detector
- `.claude/hooks/skill-detector/utils.ts` — Keyword matching, scoring
- `.claude/hooks/skill-detector/domains/*.ts` — Domain-specific configurations
- `.claude/settings.json` — Hook configuration

### Hook Configuration in settings.json

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "bun \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/skill-detector/index.ts UserPromptSubmit",
        "timeout": 5,
        "type": "command"
      }
    ]
  }
}
```

---

## Sources

### Official Anthropic Documentation

- [Claude Code Skills](https://code.claude.com/docs/en/skills) — Frontmatter reference
- [Agent Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — Structure, naming
- [Equipping Agents with Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Progressive disclosure architecture

### Community Analysis

- [Claude Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — YAML frontmatter, invocation mechanics
- [Claude Code Skills](https://mikhail.io/2025/10/claude-code-skills/) — Skill lifecycle, system prompt integration
- [Skills for Claude](https://blog.fsck.com/2025/10/16/skills-for-claude/) — Rationalization prevention
