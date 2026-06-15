# Effort and Thinking

How Claude Code controls reasoning effort and extended thinking — the effort levels, where each is set, precedence, and the adaptive-reasoning model.

> Source: https://code.claude.com/docs/en/model-config (Adjust effort level) and https://code.claude.com/docs/en/env-vars. When those pages contradict this file, the official docs win — open a PR updating this reference.

## Contents

- [Effort Levels by Model](#effort-levels-by-model)
- [Where Effort Is Set](#where-effort-is-set)
- [Precedence](#precedence)
- [ultracode](#ultracode)
- [ultrathink](#ultrathink)
- [Thinking and Adaptive Reasoning](#thinking-and-adaptive-reasoning)
- [Repo Note](#repo-note)

---

## Effort Levels by Model

Effort controls adaptive reasoning — how much the model thinks per step. Levels are calibrated per model, so the same name is not the same underlying budget across models.

| Model | Levels | Default |
| --- | --- | --- |
| Opus 4.8, Opus 4.7 | `low`, `medium`, `high`, `xhigh`, `max` | `high` (4.8), `xhigh` (4.7) |
| Opus 4.6, Sonnet 4.6 | `low`, `medium`, `high`, `max` | `high` |
| Older models | unsupported | — |

If you set a level the active model does not support, Claude Code falls back to the highest supported level at or below it (e.g. `xhigh` runs as `high` on Opus 4.6). Switching to Opus 4.8/4.7 the first time applies that model's default even if another level was set previously.

`max` is the deepest; it can overthink and show diminishing returns — test before adopting broadly.

## Where Effort Is Set

| Method | Scope | Notes |
| --- | --- | --- |
| `/effort [level\|auto]` | Session | Slider with no arg; `auto` resets to model default |
| `/model` arrows | Session | Left/right adjusts the effort slider in the picker |
| `--effort <level>` | Single launch | CLI flag |
| `CLAUDE_CODE_EFFORT_LEVEL` | Env | `low\|medium\|high\|xhigh\|max\|auto`; highest precedence |
| `effortLevel` (settings) | Persistent | **Accepts `low\|medium\|high\|xhigh` only** — `max`/`ultracode` rejected here |
| `effort:` frontmatter | Skill/subagent | Overrides session level (not the env var) while active |

**`max` persists across sessions only through `CLAUDE_CODE_EFFORT_LEVEL`** — the `effortLevel` settings key cannot hold it.

The active level shows next to the logo/spinner ("with low effort") and is exposed to hooks (`effort.level` JSON field, `$CLAUDE_EFFORT` env — see [hooks-reference.md](hooks-reference.md)).

## Precedence

Highest to lowest:

1. `CLAUDE_CODE_EFFORT_LEVEL` env var
2. Skill / subagent frontmatter `effort`
3. Session `/effort` or `--effort`
4. Settings `effortLevel`
5. Model default

## ultracode

`ultracode` is a Claude Code setting, **not** a model effort level. It sends `xhigh` to the model and additionally has Claude orchestrate [dynamic workflows](dynamic-workflows.md) for each substantive task.

- Session-only; resets on a new session. Drop back with `/effort high`.
- Offered only on models supporting `xhigh` (Opus 4.8/4.7); removed from the `/effort` menu when [workflows are disabled](dynamic-workflows.md#disable-workflows).
- Set via `/effort ultracode`, or `"ultracode": true` through `--settings` / an Agent SDK control request.
- Not part of `effortLevel`, `--effort`, or `CLAUDE_CODE_EFFORT_LEVEL`.

## ultrathink

Include the literal word `ultrathink` anywhere in a prompt to request deeper reasoning **on that turn only**, without changing the session effort. The effort level sent to the API is unchanged; Claude Code adds an in-context instruction. Other phrases ("think hard", "think more") are passed through as ordinary text and are not recognized.

## Thinking and Adaptive Reasoning

Extended thinking is the reasoning emitted before responding. On adaptive-reasoning models the effort level is the primary control; the settings below toggle thinking on/off and how it displays.

| Control | How to set | Effect |
| --- | --- | --- |
| `alwaysThinkingEnabled` (settings) | `/config` thinking toggle, saved to `~/.claude/settings.json` | Enable thinking by default |
| Session thinking toggle | `Option+T` (macOS) / `Alt+T` (Win/Linux) | Toggle for the current session |
| `showThinkingSummaries` (settings) | settings | Show full thinking summaries when expanded (`Ctrl+O` toggles verbose) |
| `MAX_THINKING_TOKENS` | env | Fixed thinking budget; `0` disables thinking entirely regardless of effort |
| `CLAUDE_CODE_DISABLE_THINKING` | env | Force-disable extended thinking |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | env | Revert 4.6-class models to fixed budget (`MAX_THINKING_TOKENS`) |

**Adaptive reasoning is model-dependent:**

- **Opus 4.7 and later always use adaptive reasoning.** The fixed-thinking-budget mode and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` **do not apply** to them — the flag is inert on Opus 4.8/4.7. There is no setting that turns adaptive reasoning off on those models; only `MAX_THINKING_TOKENS=0` / `CLAUDE_CODE_DISABLE_THINKING` (disable thinking entirely) exist.
- **Opus 4.6 and Sonnet 4.6** honor `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`, reverting to the fixed budget set by `MAX_THINKING_TOKENS`.

## Repo Note

This repo sets `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1"` in `.claude/settings.json` `env` and **retains it by policy** (adaptive thinking must remain disabled). Effect is model-scoped: it disables adaptive reasoning on 4.6-class models (e.g. Sonnet 4.6 subagents, Haiku background work) and is inert on the Opus 4.7+/4.8 main session. Do not remove it during a config audit on the grounds that it is inert on Opus 4.8 — it is intentional and load-bearing for 4.6-class lanes.

Project `effortLevel` is the committed team default; a per-user `CLAUDE_CODE_EFFORT_LEVEL` in `~/.claude/settings.json` overrides it locally (env wins over settings).

## Related References

- [dynamic-workflows.md](dynamic-workflows.md) — `ultracode` triggers workflow orchestration
- [prompt-caching-runtime.md](prompt-caching-runtime.md) — effort level is a cache key; switching invalidates the cache
- [permissions-and-settings.md](permissions-and-settings.md) — `effortLevel`, `alwaysThinkingEnabled`, and thinking settings in the key catalog
- [frontmatter-reference.md](frontmatter-reference.md) — `effort:` field on skills and subagents
- Official docs: https://code.claude.com/docs/en/model-config, https://code.claude.com/docs/en/env-vars
