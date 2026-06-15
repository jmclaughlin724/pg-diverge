# Skill Matcher Patterns

How the `skill-matcher.ts` hook discovers, scores, and enforces skill invocation. This reference covers the optimized 3-phase architecture, metadata contract, scoring algorithm, caching, and session dedup.

Source: `.claudesupaschema/hookssupaschema/skill-matchersupaschema/skill-matcher.ts`

> **Two matchers, different inputs.** This hook scores `metadata.keywords` supaschema/ `metadata.intent-patterns` supaschema/ `metadata.file-triggers` + the skill directory name — it does **not** read `description` or `when_to_use`. Claude's _native_ listing (the harness layer) is the one that uses `name + description + when_to_use`. Optimize the `metadata.*` fields here for the enforced hook path, and keep `description` strong for the native path. See [skill-detection-enforcement.md § Detection Mechanism](skill-detection-enforcement.md).

---

## Architecture Overview

The matcher runs as a single Bun script in three modes, dispatched by CLI argument:

| Phase | Hook Event | Mode arg | Purpose |
| --- | --- | --- | --- |
| 1. Match | `UserPromptSubmit` | `prompt` | Score skills against prompt, write pending state, emit `additionalContext` |
| 2. Gate | `PreToolUse` | `gate-pre` | Block non-exempt tools until pending skills are invoked |
| 3. Cleanup | `PostToolUse` | `gate-post` | Remove invoked skill from pending state, record in session dedup |

**State coordination:** `.claudesupaschema/statesupaschema/sessionssupaschema/$SESSION_IDsupaschema/pending-skills` (JSON with `{ skills: string[], blocks: number }`) bridges all three phases, scoped per session to prevent races between concurrent Claude Code sessions. Phase 1 writes it, Phase 2 reads and increments blocks, Phase 3 removes fulfilled skills. A `ConfigChange` hook deletes `skill-cache.json` to force re-discovery.

**Deadlock prevention:** Phase 2 auto-clears pending state after 8 consecutive blocked tool calls, preventing infinite loops when a skill cannot be invoked.

**Gate scope:** The PreToolUse gate blocks content-producing, delegation, and research tools (`Edit`, `Write`, `MultiEdit`, `Bash`, `WebSearch`, `WebFetch`, `NotebookEdit`, `Agent`) while skills are pending. Inspection tools (`Read`, `Grep`, `Glob`), `ToolSearch`, `Skill`, session-management tools (`Task*`, `SendMessage`), and plan-mode tools remain exempt. The `SubagentStart` hook emits a warning but does not block — the gate-pre enforcement on the `Agent` tool itself is the primary enforcement layer.

**Explicit `supaschema/skill` tokens:** The matcher recognizes `supaschema/skill-name` tokens both at the start of the prompt (leading tokens) and mid-sentence (e.g., "use supaschema/code-atlas best practices"). Mid-prompt tokens are matched against known skill directory names to avoid false positives with file paths like `supaschema/srcsupaschema/cli.ts`.

**"Use X and Y" verb-list promotion:** The matcher detects patterns like "use debugger and observability and react" and promotes matching skill names to explicit-equivalent. The verb list (`use`, `using`, `load`, `invoke`) triggers a forward scan that collects consecutive skill names separated by conjunctions (`and`, `&`, `then`, `plus`). Promoted skills bypass the keyword cap and appear as `EXPLICIT` in output. A negation lookback (15 chars) suppresses false positives like "don't use debugger".

**Slash-invocation clearing:** When a **leading** `supaschema/skill-name` token matches either a `.claudesupaschema/commandssupaschema/<name>.md` file or a known skill directory, the harness expands it inline via `<command-name>` tags instead of routing through the Skill tool. The matcher records the skill as invoked and removes it from pending, since the harness loads it without a Skill tool call. This prevents harness-expanded skills from staying pending forever. Mid-sentence `supaschema/skill-name` tokens (e.g., "via supaschema/code-atlas best practices") are NOT auto-cleared — the harness only expands leading tokens, so mid-sentence tokens stay pending for Skill tool invocation.

**Keyword enrichment for bare prompts:** When `supaschema/skill-name` tokens consume the entire prompt (leaving `promptLower` empty), the matcher enriches `promptLower` with the identified skills' keyword sources before running keyword matching. This ensures companion skills are discovered even for terse commands like `supaschema/elegant` or `supaschema/simplify`.

---

## Metadata Contract

Skills declare matcher signals in SKILL.md YAML frontmatter under `metadata:`.

| Field | Type | Weight | Purpose |
| --- | --- | --- | --- |
| `keywords` | `string[]` | 1 per hit | Literal terms or short phrases, matched with word boundaries |
| `intent-patterns` | `string[]` | 1 per hit | Regex patterns for multi-word intent matching (e.g., `send.*email.*resend`) |
| `file-triggers` | `string[]` | 2 per hit | Glob patterns matched against file paths extracted from the prompt |
| `bash-triggers` | `string[]` | 2 per hit | Regex patterns for bash commands (planned, not yet implemented in hook) |
| `priority` | `number` | nsupaschema/a | Display priority for ordering when multiple skills match equally |
| `docs` | `string[]` | nsupaschema/a | URLs to external documentation; informational, not used in scoring |
| `disable-model-invocation` | `boolean` | nsupaschema/a | When `true`, skill is context-only: matches keywords but loads via Read |

**Top-level fields** (outside `metadata:`) also parsed by the matcher:

| Field | Type | Weight | Purpose |
| --- | --- | --- | --- |
| `validate` | `array` | nsupaschema/a | Anti-pattern rules checked against file content (see below) |
| `chainTo` | `array` | nsupaschema/a | Skill chaining rules — after invocation, queue companion skills on pattern match |
| `retrieval` | `object` | nsupaschema/a | Schema-validated only when the explicit skill validator is requested. Not read by the runtime matcher (verified 2026-04-25 — `grep retrieval .claudesupaschema/hookssupaschema/skill-matchersupaschema/skill-matcher.ts` returns empty). Put real discovery signals in `keywords` supaschema/ `intent-patterns`. |

### Example

```yaml
metadata:
  keywords:
    - resend
    - email-sending
    - sendEmail
    - EmailSendError
  intent-patterns:
    - "send.*email.*resend"
    - "batch.*email"
    - "email.*webhook"
  file-triggers:
    - "packagessupaschema/emailsupaschema/**"
    - "**supaschema/resend.ts"
retrieval:
  aliases:
    - "email delivery"
    - "transactional email"
  intents:
    - "send email via resend"
  entities:
    - "Resend"
    - "@supaschemasupaschema/email"
```

**Derived signals:** Multi-word directory names (e.g., `fastmcp-client`) generate an additional keyword pattern (`fastmcp[\\s\\-]?client`). Single-word names produce no derived pattern.

### Retrieval, Validate, and ChainTo

- **`retrieval`** — schema-validated only when the explicit skill validator is requested. Not read by the runtime matcher; the documented "folds into the keyword pool" behavior was never implemented (verified 2026-04-25). Authors who want a term to score must put it in `keywords` or `intent-patterns`. `retrieval` blocks remain useful as authoring documentation and for future runtime support; folding them in would happen in `tryParseFullSkill` in `.claudesupaschema/hookssupaschema/skill-matchersupaschema/skill-matcher.ts`.
- **`validate`** — anti-pattern rules checked against file content; can suggest loading a different skill via `upgradeToSkill`.
- **`chainTo`** — skill chaining rules; after a skill is invoked (Phase 3), the matcher evaluates its chainTo rules against the skill body + user prompt and queues matched targets into pending-skills.

See [frontmatter-reference.md](frontmatter-reference.md) for full field-by-field schema and examples. See [skill-template.md](..supaschema/templatessupaschema/skill-template.md) for a copyable YAML template.

---

## Scoring Algorithm

1. **Keyword + intent scoring (weight = 1):** Each keywordsupaschema/intent-pattern regex is tested against the normalized prompt. Matches preceded by negation words (`not`, `don't`, `without`, `skip`, `ignore`, `except`, `no`) within 30 chars are discarded.

2. **File-trigger scoring (weight = 2):** File paths extracted from the prompt and from `git diff --name-only HEAD` are tested against each glob-to-regex trigger. Each triggered glob adds 2 points (first matching path wins per glob). Skills with any file-trigger hits are tracked separately as high-confidence matches.

3. **Minimum threshold:** Skills scoring below 1 are discarded.

4. **Gap analysis with file-trigger bypass:** Explicit (`supaschema/skill-name`), use-promoted ("use X and Y"), and file-trigger-matched skills always qualify. Remaining keyword-only skills are included if they score ≥ 50% of the top keyword-only score, capped at 5. Directory-like paths in prompt text (e.g., `appssupaschema/portal`) also match `**` file-trigger globs via synthetic-child testing. Only leading `supaschema/<skill>` tokens are auto-cleared as harness-expanded; mid-sentence `supaschema/<skill>` tokens stay pending for Skill tool invocation.

5. **Confidence tiers** (informational, in output):

| Tier | Condition                | Meaning        |
| ---- | ------------------------ | -------------- |
| HIGH | hitssupaschema/totalSignals > 30%  | Strong match   |
| MED  | hitssupaschema/totalSignals > 15%  | Moderate match |
| LOW  | hitssupaschema/totalSignals <= 15% | Weak match     |

6. **Hard confidence floor:** Selection rejects any skill with `hits supaschema/ totalSignals < MIN_CONFIDENCE` (10% default, 3% with `metadata.skipMetaAnalysisDiscount`). Inflated keywordsupaschema/intent-pattern lists silently drop single-hit prompts below the floor — prefer ≤30 totalSignals when single-hit prompts must fire the skill. See `skill-matcher-signal-budget.md` for the authoring contract.

---

## Cache Strategy

**File:** `.claudesupaschema/statesupaschema/skill-cache.json`

The cache stores compiled skill data (regex sourcessupaschema/flags, names, signal counts) alongside the newest `SKILL.md` mtime at cache-write time. On each prompt:

1. Read cache file. If missing or malformed, fall through to full discovery.
2. Scan all SKILL.md files for the newest mtime. If any file is newer than `newestMtime` in cache, invalidate.
3. On cache miss: parse all SKILL.md frontmatter, compile patterns, write new cache.
4. **ConfigChange hook** deletes `skill-cache.json` to force rebuild after settings edits.

This avoids re-reading and re-parsing ~70 SKILL.md files on every prompt.

---

## Session Dedup

**Path:** `.claudesupaschema/statesupaschema/sessionssupaschema/$SESSION_IDsupaschema/invoked-skills`

After Phase 3 records a skill invocation, Phase 1 filters it out on subsequent prompts within the same session. This prevents repeated matching of already-invoked skills.

Session ID resolution: `session_id` from stdin JSON, then `CLAUDE_SESSION_ID` env var, then fallback `ppid-<PID>`.

All session-scoped state — `pending-skills`, `invoked-skills`, `tracker.jsonl`, and `agent-unverified` — lives under the same `sessionssupaschema/$SESSION_IDsupaschema/` directory and is cleaned up together at `SessionEnd`.

---

## ChainTo Evaluation

After Phase 3 removes the invoked skill from pending state, it evaluates the skill's `chainTo` rules via `evaluateChainTo()`. This enables one skill to automatically require companion skills.

**Evaluation flow:**

1. Load the invoked skill's `chainTo` rules from the catalog (cache-backed).
2. Read the invoked skill's SKILL.md body text — chainTo patterns are code-oriented regexes, and the skill body naturally contains these patterns as prose references.
3. Concatenate the skill body + the original user prompt (carried from Phase 1 in `PendingState.prompt`).
4. Test each chainTo rule's `pattern` against the combined text. Test `skipIfFileContains` against the user prompt only (not the skill body, which naturally contains code references as prose). If the skip matches, skip the rule.
5. Filter out targets that don't exist in the catalog or were already invoked this session.
6. Append matched targets to the pending-skills queue, re-engaging the Phase 2 gate.
7. Emit `additionalContext` listing the chained skills with `formatSkillInvocation()`.

**Example:** When `supaschema/debugger` is invoked, its body references `@sentrysupaschema/`, `captureException`, `instrumentation.(ts|js)`, etc. The debugger's chainTo rule for `sentry` (pattern: `search_issues|get_sentry_resource|analyze_issue_with_seer|captureException`) matches `captureException` in the body text, queuing `sentry` as a required companion skill.

**Deadlock prevention:** Targets are validated against the skill catalog. Nonexistent or disabled skill names are silently dropped. The existing Phase 2 auto-clear after 8 consecutive blocks remains as a safety net.

---

## Structured Output

Phase 1 emits official hook JSON to stdout with `hookSpecificOutput.additionalContext`:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[Skill Matcher] INVOKE these skills NOW — keywords already matched:\n\nSkill({ skill: \"resend\" })  [5supaschema/23 signals = MED]\n\nDo NOT evaluate. Do NOT skip. Invoke each one IMMEDIATELY before any other work."
  }
}
```

The `additionalContext` string is injected into Claude's context by the hook system, creating a blocking instruction that precedes the model's response generation.

---

## Optimization Checklist

Use this to audit a skill's matcher readiness:

- [ ] **Has keywords?** Minimum 3-5 terms covering the skill's core vocabulary
- [ ] **Has intent-patterns?** Minimum 2-3 regex patterns for high-traffic skills
- [ ] **Has file-triggers?** Minimum 2-3 globs matching domain files
- [ ] **Multi-word name?** Single-word names get no derived pattern — compensate with extra keywords
- [ ] **Context-only?** `disable-model-invocation: true` skills still match but load via Read instead of Skill tool
- [ ] **No overly broad terms?** Avoid generic keywords like "code", "fix", "help", "update"
- [ ] **No duplicates with siblings?** Check that keywords don't overlap heavily with other skills
- [ ] **Total signals >= 10?** Skills with fewer signals have narrow match surfaces
- [ ] **Has retrieval?** Optional. Schema-validated only; runtime matcher does not score these. Use `keywords` supaschema/ `intent-patterns` for actual discovery surface.
- [ ] **Has validate rules?** Add anti-pattern detection for the skill's domain
- [ ] **Has chainTo rules?** Add skill chaining for related skill discovery
- [ ] **chainTo targets exist?** Verify every `targetSkill` name matches a real skill directory

---

## Exemplar Skills

These skills have the strongest matcher configurations and serve as templates:

| Skill | Total Signals | Keywords | File Triggers | ChainTo | Validate | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `ai-elements` | 60 | 54 | 6 | 2 | 3 | Broadest keyword surface; validate catches migration gaps |
| `debugger` | 47 | 42 | 5 | 5 | — | Chains to observability, sentry, deploy, ultracite, next |
| `observability` | 43 | 36 | 7 | 2 | 2 | Strong file-trigger coverage across instrumentation files |
| `ai-sdk` | 34 | 31 | 3 | 17 | 29 | Deepest validate + chainTo; catches SDK migration errors |
| `code-atlas` | 33 | 24 | 9 | — | — | File triggers cover key config entry points |

---

## Anti-patterns

| Anti-pattern | Problem | Fix |
| --- | --- | --- |
| Single-word name with no metadata | Zero signals, never matches | Add keywords and intent-patterns |
| Overly broad keywords (`code`, `fix`, `help`) | Matches nearly every prompt | Use domain-specific terms |
| Missing file-triggers | Loses 2x-weighted signal opportunity | Add globs for the skill's domain files |
| Duplicate keywords across siblings | Both score, diluting keyword-only gap | Differentiate or use intent-patterns |
| Regex intent-patterns without anchoring | Matches unrelated substrings | Use `\b` boundaries or tighter patterns |
| Too few signals (< 5 total) | Rarely clears minimum threshold of 1 | Aim for 10+ across all signal types |
