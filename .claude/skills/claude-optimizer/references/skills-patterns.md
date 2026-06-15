# Skills Patterns

Best practices for creating Claude Code skills with minimal context overhead.

> Sources: https://code.claude.com/docs/en/skills and https://code.claude.com/docs/en/memory

## Choose The Right Surface First

Before creating a skill, decide whether the guidance should live somewhere with a different context-loading profile.

| Need | Use | Why |
| --- | --- | --- |
| Always-needed Anilize project instructions | `AGENTS.md` | loads at session start |
| File- or directory-specific persistent guidance | `.claude/rules/*.md` with `paths` | only applies where needed |
| Reusable expertise or workflow | skill | loads when relevant |
| Isolated execution or verbose work | subagent | separate context window |

Create a skill only when the content should not live in always-on startup context. In this repo, `CLAUDE.md` files stay compatibility stubs that point at the adjacent `AGENTS.md`.

Claude Code ships 5 bundled skills (`/batch`, `/claude-api`, `/debug`, `/loop`, `/simplify`) that demonstrate good skill design patterns.

## How Skills Load

Claude loads skills in stages:

| Stage | When | What loads |
| --- | --- | --- |
| Metadata | startup | `name` and `description` (harness listing); the repo's keyword/file-trigger scoring is separate — see [skill-matcher-patterns.md](skill-matcher-patterns.md) |
| Body | when the skill is invoked | `SKILL.md` body only — `!`-command blocks expand; `@`-mentions do not |
| References | on demand | files under `references/`, `scripts/`, `assets/`, loaded only when the model `Read`s them |

Reference loading — lazy markdown links, the inert `@`-mention, no auto-walk, and the traversal guard — is owned by [dynamic-context-and-runtime.md §1a](dynamic-context-and-runtime.md). Do not write `@references/x.md` expecting eager load; it stays literal text in a skill body.

Context implication:

- descriptions should be strong but compact because they are startup context
- `SKILL.md` should stay focused on essentials
- detailed examples and variants belong in references, reached by a markdown link + `Read`

## File Structure

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

- `SKILL.md` is the only required file
- keep references one level deep
- use scripts for generated or dynamic output instead of embedding large blobs in markdown

## Frontmatter Essentials

| Field | Guidance |
| --- | --- |
| `description` | strongest signal for Claude's **native** matching (the harness layer); the repo's enforced hook matcher scores the `metadata.*` fields below, not `description` — see [skill-matcher-patterns.md](skill-matcher-patterns.md) |
| `metadata.keywords` | domain terms for keyword matching (1x per hit) |
| `metadata.intent-patterns` | regex patterns for multi-word intent matching (1x per hit) |
| `metadata.file-triggers` | glob patterns for file-path matching (2x per hit) |
| `metadata.bash-triggers` | regex patterns for bash command matching (planned, not yet implemented in hook) |
| `metadata.priority` | numeric display priority when multiple skills match equally |
| `metadata.docs` | URLs to external documentation for the skill's domain |
| `disable-model-invocation` | context-only: matches keywords but loads via Read, not Skill tool |
| `user-invocable` | hide background/supporting skills from `/` when needed |
| `validate` | anti-pattern rules — detect wrong patterns in file content and warn/error |
| `chainTo` | skill chaining — after invocation, queue a companion skill when a pattern matches |
| `retrieval` | aliases, intents, entities — folded into keyword pool for richer discovery |
| `context: fork` | use when the skill should run in an isolated subagent context |
| `agent` | required partner when `context: fork` is set |

Validate full field rules in [frontmatter-reference.md](frontmatter-reference.md). Scoring algorithm details in [skill-matcher-patterns.md](skill-matcher-patterns.md).

## Content Types

| Type | Body style | Best for |
| --- | --- | --- |
| Reference skill | conventions, patterns, routing | domain knowledge Claude should apply |
| Task skill | imperative steps | explicit workflows or operations |

If the body reads like reference documentation, keep it as a reference skill. If the body reads like a checklist, it is a task skill.

## Context-Aware SKILL.md Design

- keep `SKILL.md` under 500 lines
- keep the core workflow short enough to read quickly
- route to references instead of embedding long code blocks
- keep one canonical explanation per concept
- prefer tables and short bullets over repeated prose

Use `SKILL.md` for:

- quick start
- the core workflow
- high-signal constraints
- links to the right references

Use references for:

- multiple variants
- long examples
- edge cases
- large API or schema detail

## Description Guidance

Use this pattern:

```text
Use when [specific trigger or task] - [capability 1], [capability 2], [approach]
```

Good descriptions:

- state when to invoke
- name the outcome
- use words a user would naturally say

Bad descriptions:

- vague summaries such as “helps with code”
- lists of technologies without triggers
- long paragraphs that dilute the routing signal

## Anti-Patterns

- turning a skill into always-on project context
- duplicating `CLAUDE.md` or `.claude/rules` content in `SKILL.md`
- putting long examples directly in the skill body
- preloading a `context: fork` skill when a normal skill would do
- using a weak description and compensating with a verbose body

## Advanced Frontmatter: validate, chainTo, retrieval

These three top-level fields extend skill discovery and cross-skill intelligence. All are optional and parsed by the skill-matcher hook.

### validate — Detect anti-patterns in file content

Use `validate` when a skill's domain has common mistakes that should surface as warnings or errors when the model reads affected files.

```yaml
validate:
  - pattern: '"pipeline"\s*:'
    message: 'turbo.json "pipeline" was renamed to "tasks" in v2'
    severity: error
    skipIfFileContains: '"tasks"\s*:'
    upgradeToSkill: turborepo
    upgradeWhy: "Reload Turborepo skill for v2 migration guidance"
```

| Field | Required | Description |
| --- | --- | --- |
| `pattern` | Yes | Regex matched against file content |
| `message` | Yes | Human-readable explanation |
| `severity` | No | `error`, `warn` (default), or `recommended` |
| `skipIfFileContains` | No | Regex — skip if file also matches this |
| `upgradeToSkill` | No | Suggest loading this skill instead |
| `upgradeWhy` | No | Reason for the skill upgrade |

**When to add:** When you've seen the same mistake twice and it's detectable by regex. Don't add validate rules for things better caught by lint or typecheck.

### chainTo — Automatically queue companion skills

Use `chainTo` when invoking one skill often requires loading another. After Phase 3 removes the invoked skill from pending state, `evaluateChainTo()` tests the skill's chainTo patterns against the skill's own SKILL.md body text + the user's original prompt. Matched targets are queued into pending-skills, re-engaging the Phase 2 gate.

```yaml
chainTo:
  - pattern: "@vercel/analytics|@vercel/speed-insights|instrumentation\\.(ts|js)"
    targetSkill: observability
    message: "Observability instrumentation detected — loading monitoring setup guidance."
    skipIfFileContains: "packages/observability|@anilize/observability"
```

| Field | Required | Description |
| --- | --- | --- |
| `pattern` | Yes | Regex matched against skill body + user prompt |
| `targetSkill` | Yes | Skill directory name to queue |
| `message` | No | Explanation shown when chaining |
| `skipIfFileContains` | No | Regex — skip if the user prompt also matches this |

`skipIfFileContains` is tested against the user prompt only, not the skill body. This prevents the skill's own prose references from triggering skip conditions.

**When to add:** When domain A regularly crosses into domain B and the two domains stay distinct. Real examples in the repo: `debugger → observability`, `turbopack → next`, `prompt-creator → openai-docs`. Verify `targetSkill` matches a real skill directory name.

**When NOT to add (consolidate instead):** If A's chainTo to B fires almost every time A loads — i.e., the two skills cover one library or domain split by surface (server/client/test, frontend/backend) — they are one skill. Merge them into a single skill with surface-prefixed references and let `file-triggers` + `intent-patterns` route within the consolidated body. Mirrors the progressive-disclosure rule for reference files: if two siblings load together every time, they should not be split.

### retrieval — Enrich keyword discovery surface

Use `retrieval` to add semantic signals that don't fit naturally into `keywords` or `intent-patterns`. All three arrays fold into the same scoring pool (1x per hit, identical to keywords).

```yaml
retrieval:
  aliases:
    - "troubleshooter"
    - "diagnostic"
  intents:
    - "debug stuck app"
    - "triage production issue"
  entities:
    - "Sentry"
    - "Vercel logs"
    - "Next DevTools"
```

| Field | Required | Description |
| --- | --- | --- |
| `aliases` | No | Alternative names or shorthands for the skill's domain |
| `intents` | No | Natural-language phrases describing what the user wants |
| `entities` | No | Proper nouns, tool names, config files associated with the skill |

**When to add:** When users describe the problem differently than the skill's keywords capture. Aliases cover naming variants, intents cover goal-oriented phrasing, entities cover specific tool names.

**keywords vs retrieval:** Use `keywords` for raw signal terms that don't need categorization. Use `retrieval` when the semantic grouping (alias / intent / entity) helps a skill author understand why each term is there.

### Complete example with all three

```yaml
---
name: debugger
description: "Use when encountering build errors, test failures, or when something is stuck, hung, or not loading."
metadata:
  keywords:
    - "build error"
    - "test failure"
    - "stuck"
    - "frozen"
    - "timeout"
  intent-patterns:
    - "why.*(?:fail|broken|error)"
    - "(?:it'?s|seems?).*(?:stuck|hung|frozen)"
  file-triggers:
    - "**/error.{tsx,ts}"
    - "**/instrumentation.{ts,js}"
validate:
  - pattern: "console\\.log\\(['\"]error"
    message: "Console.log-only error handling — consider structured logging or Sentry"
    severity: recommended
    skipIfFileContains: "captureException|@sentry/"
chainTo:
  - pattern: "@sentry/|captureException"
    targetSkill: sentry
    message: "Sentry usage detected — loading production issue triage workflow."
retrieval:
  aliases:
    - "troubleshooter"
    - "triage"
  intents:
    - "debug stuck app"
    - "investigate runtime error"
  entities:
    - "Sentry"
    - "Vercel logs"
---
```

## Related References

- [progressive-disclosure.md](progressive-disclosure.md)
- [frontmatter-reference.md](frontmatter-reference.md)
- [agents-patterns.md](agents-patterns.md)
