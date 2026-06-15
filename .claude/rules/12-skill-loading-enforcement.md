# Rule 12 — Deterministic skill-loading enforcement

Relevant project skills are loaded by **deterministic rules**, not model judgment. A routing manifest decides relevance from explicit signals; hooks **push** the skill into context and **block** governed tool use until it is loaded — for the main agent and subagents. This removes the "agent forgot to load the skill" failure mode.

**No exempt tools.** The gate runs on every tool call. A PreToolUse hook cannot make the model call the `Skill` tool, so the gate itself is the loader: when a governed action is attempted with an unloaded required skill, the gate **delivers that skill's `SKILL.md` + `refs` content inside the denial reason** and credits the ledger, then denies once so nothing runs against the governed surface until the content is in context. The re-run proceeds. Loading is enforcement-driven, never a voluntary `Skill` call.

## How it works

- **Source of truth:** `scripts/skills/skill-routing.json` (`skill-routing-v1`) maps each project skill to triggers — `whenToolEdits`/`whenPathGlob` (file-path globs), `whenBashMatches` (command substrings), `whenPromptMatches` (prompt substrings) — plus `refs` (required reference files) and `enforce` (gate vs advisory). Relevance is matched against the hook's own inputs + an on-disk scan of `.claude/skills/**/SKILL.md`; it never uses the skill `description` matcher or the model's `<system-reminder>` (hooks cannot see it).
- **Resolver:** `scripts/skills/skill-hook-core.mjs` owns routing, ledgers, and hook output formatting. `scripts/skills/skill-router.mjs` is a compatibility CLI over the same core. The resolver uses segment glob matching + substring matching + `JSON.parse`.
- **Per-session ledger:** `.tmp/skill-gate/<session_id>.json` records loaded skills. Keyed by `session_id` so concurrent sessions do not overlap.
- **Hooks:** Claude and Codex have separate native hook adapters. `npm run sync:llm` mirrors the six enumerated skills to `.codex/skills`/`.agents/skills`, not hooks.
  - Claude: `.claude/hooks/skill-session-init.mjs`, `skill-inject.mjs`, `skill-gate.mjs`, `skill-record.mjs`, and `skill-subagent-gate.mjs`.
  - Codex: `.codex/hooks/skill-session-init.mjs`, `skill-inject.mjs`, `skill-gate.mjs`, and `skill-record.mjs`.
  - `skill-inject.mjs` (UserPromptSubmit) pushes matched skills' `SKILL.md` + optional `refs` as `additionalContext` and credits the ledger.
  - `skill-gate.mjs` (PreToolUse) denies once when a governed edit touches an unloaded required skill, delivering the skill's full `SKILL.md` + optional `refs` content in the denial reason and crediting the ledger. The re-run proceeds with the guidance in context.
  - `skill-record.mjs` (PostToolUse `Skill|Read`) records a loaded skill / read ref.
  - `skill-session-init.mjs` (SessionStart) clears the session ledger.

## Modes & posture

- `mode` (`scripts/skills/skill-routing.json`) / `SKILL_GATE_MODE` env: `warn` (emit an advisory `systemMessage`, never block) · `enforce` (deny a file-editing tool once when a routed skill is unloaded, deliver that skill's `SKILL.md` into the denial reason, and credit the session ledger so the immediate re-run proceeds) · `off`. **The repo ships in `enforce`.** Only file-editing tools (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) are gated; reads of governed paths stay advisory so navigating source never hard-stops.
- **Fail open** on any resolver/internal error (never brick tools); **fail closed** only on a clean "required skill not loaded" verdict for a governed action.
- Action triggers (`whenToolEdits`/`whenPathGlob`/`whenBashMatches`) are enforcing; `whenPromptMatches` is **advisory** (inject-only, never hard-block).
- References force-loaded via `@`-mention are credited on skill load; markdown-link refs require a `Read` the recorder observes.

## Enforced by

- `scripts/guards/check-agent-hooks.mjs` (`npm run guard:agent`) — the hook files + their settings registration cannot silently disappear.
- `scripts/guards/check-agent-surface-parity.mjs` — byte-parity of the six mirrored skills across `.claude/skills` ≡ `.codex/skills` ≡ `.agents/skills`, the shared Code Atlas doctrine string in `AGENTS.md` and `.claude/rules/supaschema.md`, and a Codex rule pointer back to the canonical rule. Codex hooks and numbered rules are separate native implementations kept aligned by hand (`AGENTS.md`), not byte-mirrored.
- `scripts/guards/check-no-regex-in-scripts.mjs` (Rule 07) — the resolver stays regex-free.

STOP if a governed surface is edited without its required skill loaded under `enforce` mode, if the routing manifest names a skill/ref that doesn't exist, if the resolver introduces regex over code structure, if the hooks are unregistered from `.claude/settings.json`, or if managed LLM surfaces drift.
