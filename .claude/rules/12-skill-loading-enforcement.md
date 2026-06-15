# Rule 12 — Deterministic skill-loading enforcement

Relevant project skills are loaded by **deterministic rules**, not model judgment. A routing manifest decides relevance from explicit signals; hooks **push** the skill into context and **block** governed tool use until it is loaded — for the main agent and subagents. This removes the "agent forgot to load the skill" failure mode.

**No exempt tools.** The gate runs on every tool call. A PreToolUse hook cannot make the model call the `Skill` tool, so the gate itself is the loader: when a governed action is attempted with an unloaded required skill, the gate **delivers that skill's `SKILL.md` + `refs` content inside the denial reason** and credits the ledger, then denies once so nothing runs against the governed surface until the content is in context. The re-run proceeds. Loading is enforcement-driven, never a voluntary `Skill` call.

## How it works

- **Source of truth:** `scripts/skills/skill-routing.json` (`skill-routing-v1`) maps each project skill to triggers — `whenToolEdits`/`whenPathGlob` (file-path globs), `whenBashMatches` (command substrings), `whenPromptMatches` (prompt substrings) — plus `refs` (required reference files) and `enforce` (gate vs advisory). Relevance is matched against the hook's own inputs + an on-disk scan of `.claude/skills/**/SKILL.md`; it never uses the skill `description` matcher or the model's `<system-reminder>` (hooks cannot see it).
- **Resolver:** `scripts/skills/skill-router.mjs` (shared; no regex / ReDoS-safe — segment glob matcher + substring matching + `YAML`/`JSON.parse`). Subcommands `init|inject|gate|record|subagent`.
- **Per-session ledger:** `.tmp/skill-gate/<session_id>.json` records loaded skills + read refs. Keyed by `session_id` so concurrent sessions never overlap.
- **Hooks** (`.claude/hooks/`, mirrored to `.codex/hooks/` via `npm run sync:llm`; skills also mirror to `.agents/skills/`):
  - `skill_inject.sh` (UserPromptSubmit) — pushes matched skills' `SKILL.md` + `refs` as `additionalContext` and credits the ledger.
  - `skill_gate.sh` (PreToolUse `*`) — on **any** tool whose action touches a governed surface, if the required skill (+refs) is not in the ledger it denies once, delivering the skill's full `SKILL.md` + `refs` content in the denial reason and crediting the ledger. No tool is exempt; the gate loads the content itself rather than waiting for a `Skill` call.
  - `skill_record.sh` (PostToolUse `Skill|Read`) — records a loaded skill / read ref.
  - `skill_subagent_gate.sh` (PreToolUse `Task`) — denies a governed subagent spawn whose prompt doesn't brief the required skill (subagents start at zero context).
  - `skill_session_init.sh` (SessionStart) — clears the session ledger.

## Modes & posture

- `mode` (manifest) / `SKILL_GATE_MODE` env: `warn` (log intended denials to `.tmp/skill-gate/denials.log`, never block) · `enforce` (block) · `off`. **Ship in `warn`; flip to `enforce` per-rule after validating precision.**
- **Fail open** on any resolver/internal error (never brick tools); **fail closed** only on a clean "required skill not loaded" verdict for a governed action.
- Action triggers (`whenToolEdits`/`whenPathGlob`/`whenBashMatches`) are enforcing; `whenPromptMatches` is **advisory** (inject-only, never hard-block).
- References force-loaded via `@`-mention are credited on skill load; markdown-link refs require a `Read` the recorder observes.

## Enforced by

- `scripts/guards/check-agent-hooks.mjs` (`npm run guard:agent`) — the hook files + their settings registration cannot silently disappear.
- `scripts/guards/check-agent-surface-parity.mjs` — `.claude/hooks` ≡ `.codex/hooks`, `.claude/rules` ≡ `.codex/rules`, and `.claude/skills` ≡ `.codex/skills` ≡ `.agents/skills`.
- `scripts/guards/check-no-regex-in-scripts.mjs` (Rule 07) — the resolver stays regex-free.

STOP if a governed surface is edited without its required skill loaded under `enforce` mode, if the routing manifest names a skill/ref that doesn't exist, if the resolver introduces regex over code structure, if the hooks are unregistered from `.claude/settings.json`, or if managed LLM surfaces drift.
