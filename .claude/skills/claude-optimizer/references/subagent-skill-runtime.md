# Subagent Skill Runtime Contract

How subagents load skills at startup vs. runtime, and how this interacts with the repo's path-trigger `skill-matcher.ts` gate during parallel orchestration. Reference detail extracted from [subagent-configuration.md § skills](subagent-configuration.md) and [agents-patterns.md § Agent Frontmatter Reference](agents-patterns.md). The parent docs link here; this file holds the canonical runtime contract.

> **Sources:** [Claude Code Sub-Agents § Preload skills](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents), [Claude Code Skills § Run skills in a subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent), and verified repo behavior (2026-06-03).

## Fresh subagents inherit nothing

A subagent spawned with a `subagent_type` starts at **zero context** — it does not carry the parent's loaded `SKILL.md` bodies, the parent's conversation, or any reference files the parent read. A _fork_ subagent (`context: fork`) inherits the conversation transcript but still not references the parent only linked and never read. Skill context reaches a subagent only through one of the explicit paths below; nothing is implicit.

## Conveying skill context to a subagent

Because nothing is inherited, the orchestrator must deliver skill context explicitly. In rough order of reliability:

1. **Inline it in the spawn prompt.** Paste the `SKILL.md` body (or the exact reference the worker needs) into the Task prompt. Works even if the subagent lacks the `Skill` tool or never receives the skill listing — the most portable method.
2. **Preload via `skills:`.** List the skill in the agent definition's `skills:` frontmatter; the full body is injected at startup (see "The two skill-loading paths").
3. **Name the skill to invoke.** Instruct the worker to call `Skill({ skill: "x" })`. Requires the `Skill` tool (see "Runtime invocation precondition") and that the listing reached the subagent.
4. **Give exact `Read` paths.** Point the worker at `.claude/skills/<name>/SKILL.md` and any reference paths. Requires the `Read` tool; does not depend on the listing.

References are lazy everywhere (markdown link / path → `Read`); `@`-mentions are **not** expanded in `SKILL.md` ([dynamic-context-and-runtime.md §1a](dynamic-context-and-runtime.md)), so a reference the worker must have has to be inlined (1), `Read` by path (4), or printed from a `!`-command block. The repo's `SubagentStart` hook additionally injects the parent's loaded + pending skill names, paths, and one-line descriptions as a pointer — it cannot block subagent creation, so treat it as information, not a guarantee.

## The two skill-loading paths

A subagent receives skill content through two independent mechanisms:

| Path | Trigger | When it fires | Visibility to subagent |
| --- | --- | --- | --- |
| **Preload** | `skills:` field in agent frontmatter | At subagent startup, before its first turn | Full `SKILL.md` body injected into prompt |
| **Runtime** | `Skill({ skill: "..." })` tool call | During the subagent's turn, before next action | Loads on demand, same shape as parent session |

Both paths exist alongside each other. Preload is deterministic and front-loads context cost. Runtime is on-demand and depends on the `Skill` tool being callable.

## Runtime invocation precondition

A subagent can call `Skill({ skill: "..." })` only when at least one of:

- The agent's `tools:` field omits the entire allowlist (subagent inherits all parent tools, including `Skill`)
- The agent's `tools:` field explicitly lists `Skill`

When `tools:` is set to an explicit allowlist that does NOT include `Skill`, the subagent has no way to load a skill at runtime. The framework filters the tool inventory by the listed names before exposing it to the subagent.

If violated, any hook that demands `Skill({ skill: "X" })` as a precondition (e.g., `skill-matcher.ts gate-pre` blocking on a path trigger) deadlocks the subagent: the gate fires on every `Edit`/`Write`/`Bash` call, the `Skill` tool is unreachable, and the subagent exits with a "blocked: Skill tool unavailable" message. The orchestrator must then re-do the work in the parent session (where `Skill` is available).

## Parallel-orchestration friction

Path-trigger skill matching (the repo's `.claude/hooks/skill-matcher/skill-matcher.ts`) does not distinguish parent sessions from subagents. Both fire the same gate when an `Edit`/`Write`/`Bash` call touches a file path that matches a skill's `file-triggers:` glob. In a parallel orchestration pattern (e.g., `/team` dispatching N workers each on a different slice of the repo):

- Each worker may touch files spanning multiple path-trigger globs (e.g., a worker editing both `apps/portal/components/**/*.tsx` and `apps/portal/lib/**/*.ts` triggers `react-composition` AND `tanstack-query` AND `anilize-data`).
- Predicting every trigger the worker will hit is brittle — the slice spans many subdirectories.
- Preloading every potentially-required skill into `skills:` defeats the point of preload (startup context cost balloons).

The realistic answer: configure the worker agent so it can resolve dynamic gates at runtime.

## Two compliant agent configurations

For any agent that may receive work spanning multiple path-trigger globs (typical for refactoring agents like `elegant`, `code-reviewer`, `test-writer`):

### Option 1: explicit allowlist that includes Skill

```yaml
---
name: elegant
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
skills:
  - elegant
mcpServers:
  - cclsp
  - context7
---
```

The `Skill` token in `tools:` keeps the runtime path open. The `skills:` preload still front-loads the agent's primary domain skill, but other path-trigger skills can be invoked on demand.

### Option 2: omit tools: entirely

```yaml
---
name: elegant
# (no tools: field — inherits everything from parent)
skills:
  - elegant
---
```

Inheritance grants every tool the parent has, including `Skill`. Use this when the agent's role is broad enough that an explicit allowlist would be longer than the denylist.

## When neither option is available

If the agent is intentionally locked to a narrow tool set (e.g., a security auditor that must not write files), and the parent's path-trigger gate fires on a path the worker is editing:

1. The worker reports findings via its final UNIT line ("findings: file:line — change").
2. The orchestrator applies the edits in the parent session, where `Skill` is callable.
3. The orchestrator commits the slice with the worker named in the trailer.

This is the fallback pattern used in this repo's 2026-05-09 `/team /simplify` orchestration: 2 of 4 workers were locked out of runtime skill loading, surfaced findings, and the orchestrator applied them directly. It works but loses the parallelism benefit for those slices.

## Repo-state audit

As of 2026-06-03, every agent definition in `.claude/agents/*.md` carries both `Skill` and `Read` in its `tools:` list (or omits `tools:` to inherit all). `pnpm agents:check` enforces this: an explicit `tools:` allowlist that drops `Skill` or `Read` fails the check, so a fan-out worker cannot silently lose runtime skill resolution or lazy-reference reads. A per-agent inventory is intentionally not kept here — it drifts as agents change; the guard is the source of truth.

When adding a new agent, keep both `Skill` and `Read` in `tools:` unless there is a concrete reason to deny them (then use the opt-out marker the guard recognizes). Agents launched by `/team` or `/batch` must have `Skill` available — the path-trigger matcher fires on every Edit/Write/Bash, and a missing `Skill` tool blocks the worker indefinitely.

## Cascading skill gates

A subagent that satisfies one path-trigger gate by calling `Skill({ skill: "X" })` may immediately face a second gate: skill X's body, once loaded into context, can keyword-match the skill matcher and pre-fire additional pending skills. The matcher rescores the prompt + tool input on every PreToolUse, so a freshly loaded skill body counts as fresh prompt content.

Observed in the 2026-05-09 `/team /simplify` orchestration: the `elegant` agent loaded `simplify` to pass the orchestration prompt's path triggers, then editing `apps/portal/components/**/*.tsx` triggered `react-composition`, then editing `apps/portal/lib/**/*.ts` triggered `tanstack-query` and `anilize-data`. Each Edit blocked until the matched skill loaded.

This is not a bug — it is the cascading-load contract. Each skill body adds context the agent should respect. Two operational notes:

- The agent must have `Skill` in `tools:` (or omit `tools:` entirely) to satisfy each gate. The same precondition as the runtime contract above.
- The cascade can produce many small Skill loads in succession. If startup context is tight, prefer preloading the agent's known-required skills via `skills:` so the cascade only fires for unanticipated path triggers.

## `disable-model-invocation` interaction

Skills with `disable-model-invocation: true` in their frontmatter cannot be preloaded into a subagent's `skills:` list — the framework draws preload candidates from the same set Claude can invoke. A listed-but-disabled skill is silently skipped and logged to the debug log. This applies regardless of the `tools:` allowlist; the disable flag is a property of the skill itself, not the subagent.

The repo's `claude-optimizer` skill itself uses `disable-model-invocation: true`. To preload claude-optimizer guidance into a config-editing agent, either remove the flag from `claude-optimizer/SKILL.md` (changing its repo-wide invocation contract) or split the preload-safe content into a separate skill.

## Sibling skill orchestration

`/simplify` and `/elegant` share the orchestration shape: both can be dispatched via `/team` to apply per-slice work in parallel. The friction analyzed above applies identically to both. After the structural fix landed (every agent's `tools:` list now carries `Skill`), a follow-up `/team /elegant` run over the same slices completed without subagent gate deadlocks — the validation that the prevention works.

`/elegant` is the more aggressive sibling: it rewrites for the simplest correct end state, deleting backward-compat wrappers and parallel type systems where library or framework alternatives exist. `/simplify` preserves contracts; `/elegant` may change them. Choose the matching skill based on whether existing call sites must be respected or can be updated in the same change.

## Review checklist

When creating or auditing an agent definition that may receive work via parallel orchestration:

- Does the agent's `tools:` list include `Skill` (or omit `tools:` entirely)?
- Does the `skills:` preload list cover the agent's known-required path triggers?
- For agents spawned by `/team` or `/batch`, is the path-trigger gate satisfied at startup, or does the agent need runtime invocation?
- If the agent is locked out of runtime invocation, does the spawn prompt include a "report findings instead of applying" escape clause?
