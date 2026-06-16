# Skill Matcher Patterns

Current owner: `scripts/agent-hooks/skills.mjs`.

This repo has two skill-selection layers with different jobs:

- Native model selection sees the session skill list and uses `name`, `description`, and `when_to_use` to decide what the model should load.
- The deterministic hook layer records and enforces pending skills. It uses explicit skill tokens, curated metadata, and structured file paths only.

## Runtime Contract

| Event | Responsibility | Matching input |
| --- | --- | --- |
| `UserPromptSubmit` | Record prompt-requested skills as pending and inject model-facing context. | Explicit `$skill` or `/skill`, non-generic skill names, and `metadata.keywords`. |
| `PreToolUse` | Allow observable skill loads, then block governed work if required skills are still pending. | Structured file paths from payloads and patch headers matched against `metadata.file-triggers`. |
| `PostToolUse` | Clear pending skills after observed loading. | `Skill` tool calls or actual `SKILL.md` reads through `Read`, MCP, or shell reader commands. |
| `SubagentStart` | Re-inject pending skill context for isolated subagent context. | Pending turn state. |

The hook does not score `description`, `when_to_use`, command prose, or legacy pattern metadata. Those fields may still help native model routing or authoring context, but they are not deterministic enforcement signals.

## First-Load Behavior

`UserPromptSubmit` is advisory and stateful: it tells the model which skills are required before governed work, but it does not block. The next `PreToolUse` call is allowed when it is itself an observable skill load, such as reading `.agents/skills/<name>/SKILL.md` in Codex or invoking the `Skill` tool in Claude.

If the next governed tool is not an observable skill load, `PreToolUse` denies the call and repeats the pending skill list. Codex command tools are governed: a shell reader command targeting `SKILL.md` is allowed as the first-load action, but an unrelated shell read or command is denied while skills remain pending. This prevents a loop where the hook blocks the model before the model has a chance to load the requested skill.

## Prompt Signals

Use prompt signals for user intent:

- Prefer explicit `$skill` and `/skill` tokens when the user names a skill.
- Keep `metadata.keywords` narrow and domain-specific.
- Avoid generic words such as `task`, `plan`, `verify`, `update`, `fix`, `test`, `work`, `this`, and `without`; the runtime treats these as low-signal prompt terms.
- Keep multi-word keywords literal and representative, such as `claude hooks` or `repo documentation`.

The runtime uses delimiter-aware string scanning for prompt terms. Substring-only terms such as `hook` do not match inside unrelated words, and low-signal keywords do not create pending skills unless the skill is named explicitly.

## Tool Signals

Use file triggers for tool-scoped enforcement:

- `metadata.file-triggers` should name concrete owner paths such as `.claude/hooks/**`, `.codex/hooks.json`, or `scripts/agent-hooks/**`.
- Tool matching uses structured paths from `file_path`, `path`, `target`, `uri`, nested payload fields, and patch file headers.
- Tool matching does not scan command text or patch bodies for keywords. This is intentional; command prose is too noisy for deterministic gating.
- A file-triggered skill emits context only the first time it becomes pending in the active turn.

## Observable Loads

The pending gate clears only after one of these events is observed:

- `Skill` tool call naming the skill.
- `Read` of a `SKILL.md` path under any skill root.
- MCP payload that contains a `SKILL.md` path.
- Shell reader command (`cat`, `sed`, `head`, `tail`, `nl`, `less`, `more`, or `bat`) that reads a `SKILL.md` path.

Slash commands, inline `$skill` tokens, and plain-language mentions are request signals only. They do not prove the body was loaded.

## Authoring Checklist

- Put deterministic prompt routing terms in `metadata.keywords`.
- Put deterministic tool routing paths in `metadata.file-triggers`.
- Do not add `intent-patterns:` to repo-managed skills; the guard rejects it.
- Keep `description` concise for native model routing.
- Treat `when_to_use` as native-model help, not hook evidence.
- Do not depend on command text, patch bodies, or broad generic terms for enforcement.
- After editing `.claude/skills/**`, `.claude/rules/**`, `.claude/hooks/**`, or `.claude/agents/**`, run `npm run sync:llm`.

## Tests

The current regression coverage lives in `tests/agent-hook-core.test.ts`:

- Explicit `$skill` and `/skill` requests stay pending until an observable load.
- Generic hook prose loads only the hook optimizer skills, not every skill whose description contains broad words.
- Low-signal words such as `verify`, `plan`, and `update` do not load unrelated skills.
- The SKILL.md read itself is allowed before PreToolUse blocks non-loading governed work.
- Codex command tools deny unrelated commands while pending, but allow shell reader commands that read `SKILL.md`.
- Command prose keywords are ignored for tool-scope matching.
