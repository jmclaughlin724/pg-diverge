---
description: Required skill routing context, observable skill loads, hook state, and runtime-specific hook behavior.
paths:
  - ".claude/agents/**"
  - ".claude/hooks/**"
  - ".claude/settings*.json"
  - ".claude/skills/**"
  - ".agents/skills/**"
  - ".codex/agents/**"
  - ".codex/hooks*"
  - "scripts/agent-hooks/**"
  - "scripts/guards/agent-surface/**"
  - "tests/agent-hooks/**"
---

# Rule 12 — Required skill routing context and hook state

## Contract

Platform and repository instructions own when a skill must be used. Repository skill matching surfaces that requirement by naming each matched skill, the exact prompt signal, the skill's declared scope, its `SKILL.md` path, and the required load action.

Skill context is an instruction, not an authorization gate. It MUST NOT deny tool use or block task completion. Only an explicit safety policy, such as the Rule 21 Bash command policy, may deny a `PreToolUse` call. A crashed contextual check emits a bounded warning and makes no policy decision.

## Runtime behavior

- `SessionStart` silently refreshes context-lifetime state. `startup`, `clear`, and Claude `fork` replace state; `resume` and `compact` advance the context epoch. Successful lifecycle hooks emit no stdout, stderr, or model context.
- `UserPromptSubmit` may match explicit `$skill` and `/skill` tokens and curated `metadata.keywords`. Its context explains why each skill applies and directs the agent to invoke the Skill tool or read the listed `SKILL.md` completely before task actions.
- `PreToolUse` may match exact structured file targets against parsed `metadata.file-triggers`. When a target matches, its context names the target, matching trigger, applicable scope, `SKILL.md` path, and required load action. This is context only: pending or missing load telemetry never denies the current or a later tool call.
- The Claude context matcher covers only file-bearing tools plus Bash: `Bash|Edit|MultiEdit|NotebookEdit|Read|Write|apply_patch`. The Codex projection covers the stable intercepted tools `Bash|apply_patch`. Tools without a structured file target do not pay for an empty contextual hook.
- Bash `PreToolUse` also runs the explicit secret, raw-DDL, and dangerous broad-deletion safety policy. Those positive safety classifications are the only denial path in the shared context runner.
- `PostToolUse` may silently record a successful `Skill` tool invocation or complete `SKILL.md` read as observable load telemetry. A match or inline skill token is not a load.
- `PostToolUseFailure` records supported failed-command evidence only. It does not run surface sync or convert a failed contextual check into a denial.
- `SubagentStart` may carry unresolved prompt-matched skill requirements into the subagent context. Subagents are never blocked on parent skill state.
- `Stop` and `SubagentStop` act only on verification claims contradicted by recorded command evidence. Missing evidence is unknown, not a failure.
- No task-completion or permission-denied event is registered for repository skill enforcement.
- `SessionEnd` validates its event input, clears session state, and remains silent on success.

## State and ownership

- Hook state lives under `.tmp/agent-hooks` by default and may be redirected with `STATE_DIR` for isolated tests.
- State mutation is serialized by `scripts/agent-hooks/state.mjs`; pending requirements and observable loads preserve context but do not authorize or deny tools.
- Canonical hook entrypoints live in `.claude/hooks/**`; shared logic lives in `scripts/agent-hooks/**`.
- `scripts/agent-hooks/session-lifecycle.mjs` owns SessionStart and SessionEnd. Lifecycle entrypoints MUST NOT import the non-lifecycle runner.
- `npm run sync:llm` mirrors canonical Claude hook and rule sources into generated Codex surfaces. Do not edit generated mirrors directly.
- Source and inventory reads are context gathering, not verification evidence. Command outcome parsing trusts structured status fields rather than arbitrary stdout or source text.

## Verification

For hook state, routing, or runtime changes, run:

```bash
npm run sync:llm
npm run guard:agent
npm test -- tests/agent-hooks/agent-hook-core.test.ts tests/agent-hooks/agent-hooks.test.ts
```

## Done means

- Skill matching cannot deny or deadlock any tool call.
- Matched-skill context states the exact signal, applicable skill scope, path, and required load action.
- No task-completion hook enforces pending skill state.
- Successful lifecycle and automatic sync hooks remain silent.
- Bash safety still enforces its explicit secret, raw-DDL, and dangerous broad-deletion classifications.
- Generated hook and rule surfaces reflect their canonical owners.
