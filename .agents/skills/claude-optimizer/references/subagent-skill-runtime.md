# Subagent Skill Runtime Contract

How subagents load skills at startup versus runtime, and how that interacts with this repo's deterministic skill-loading gate (`scripts/agent-hooks/**`, Rule 12) during fan-out.

> **Sources:** [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents), [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Code hooks](https://code.claude.com/docs/en/hooks), and verified repo behavior.

## Fresh subagents inherit nothing

A subagent spawned with a `subagent_type` — through the Task/Agent tool or a Workflow `agent()` call — starts at zero context. It does not carry the parent's loaded `SKILL.md` bodies, the parent's conversation, or any reference file the parent read. A `fork` subagent inherits the parent's conversation transcript but still not references the parent only linked and never opened. Skill context reaches a subagent only through one of the explicit paths below; nothing is implicit.

## The two skill-loading paths

| Path | Trigger | When it fires | Visibility to subagent |
| --- | --- | --- | --- |
| Preload | `skills:` field in `.claude/agents/<name>.md` frontmatter | At subagent startup, before its first turn | Full `SKILL.md` body injected into the prompt |
| Runtime | `Skill({ skill: "..." })` tool call | During the subagent's turn | Loads on demand, same shape as the parent |

Preload is deterministic and front-loads context cost. Runtime is on demand and depends on the `Skill` tool being callable.

## Runtime invocation precondition

A subagent can call `Skill({ skill: "..." })` only when the agent's `tools:` field either omits the allowlist entirely (the subagent inherits every parent tool, including `Skill`) or lists `Skill` explicitly. When `tools:` is an explicit allowlist that omits `Skill`, the framework filters `Skill` out of the tool inventory and the subagent cannot load a skill at runtime.

Every agent under `.claude/agents/` in this repo keeps `Skill` (and `Read`) in its `tools:` list or omits `tools:` to inherit all. Keep that convention when adding an agent so a fan-out worker can resolve a runtime skill gate. This is a convention, not a guard-enforced invariant — `npm run guard:agent` (`scripts/guards/check-claude-agents.mjs`) validates agent name, description, and that referenced `skills:`/`mcpServers:` exist, but it does not assert `Skill` is present in `tools:`.

## The gate is advisory inside subagents

This repo's `PreToolUse` skill gate (`scripts/agent-hooks/skills.mjs`) hard-denies a governed tool when a required skill is pending and unloaded. Claude Code fires `PreToolUse` for tool calls made inside a subagent and marks them with an `agent_id` field present only for in-subagent calls, while `SubagentStart` is observability-only and cannot block. A hard deny inside a subagent that lacks `Skill`/`Read` would therefore deadlock it with no way to clear the gate.

To prevent that, when `agent_id` is present the gate downgrades to advisory: it emits the pending-skill names as `additionalContext` instead of denying. The response-evidence gate (`scripts/agent-hooks/detectors.mjs`) downgrades the same way, because a subagent cannot revise the parent's final response. Hard enforcement stays in the main session, and the orchestrator applies subagent findings there. See Rule 12 and the `tests/agent-hooks.test.ts` subagent-downgrade case.

Preloading still matters: advisory context names the pending skill but does not load its body. A subagent that must actively use a skill should preload it via `skills:` or be given the exact `Read` path.

## Conveying skill context to a subagent

Because nothing is inherited, deliver skill context explicitly, in rough order of reliability:

1. **Inline it in the spawn prompt.** Paste the `SKILL.md` body (or the exact reference the worker needs) into the prompt. Works even if the subagent lacks the `Skill` tool — the most portable method.
2. **Preload via `skills:`.** List the skill in the agent definition; the full body is injected at startup.
3. **Name the skill to invoke.** Instruct the worker to call `Skill({ skill: "x" })`. Requires the `Skill` tool.
4. **Give exact `Read` paths.** Point the worker at `.claude/skills/<name>/SKILL.md` and any reference paths. Requires the `Read` tool.

References are lazy everywhere (a markdown link is a `Read` on demand) and `@`-mentions are not expanded inside `SKILL.md`, so a reference the worker must have has to be inlined (1) or read by path (4).

## When a worker is locked out of runtime loading

If an agent is intentionally narrow (for example a read-only reviewer that must not write files) and the advisory still leaves it without the skill body it needs:

1. The worker reports findings in its final message.
2. The orchestrator applies the change in the main session, where `Skill` is callable.
3. The orchestrator commits the slice with the worker named in the trailer.

This loses the parallelism benefit for that slice but never deadlocks.

## Review checklist

When creating or auditing an agent that may receive fan-out work:

- Does the agent's `tools:` list include `Skill` (or omit `tools:` entirely) so it can resolve a runtime skill gate?
- Does `skills:` preload the agent's known-required skills?
- If the agent is locked out of runtime loading, does the spawn prompt inline the needed context or include a "report findings instead of applying" escape clause?
