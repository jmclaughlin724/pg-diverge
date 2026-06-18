# Skills Patterns

Best practices for creating Claude Code skills with controlled context overhead.

> Sources: https://code.claude.com/docs/en/skills and https://code.claude.com/docs/en/memory

## Choose The Right Surface First

Before creating a skill, decide whether the guidance should live somewhere with a different context-loading profile.

| Need | Use | Why |
| --- | --- | --- |
| Always-needed supaschema project instructions | `AGENTS.md` | loads at session start |
| File- or directory-specific persistent guidance | `.claude/rules/*.md` with `paths` | only applies where needed |
| Reusable expertise or workflow | skill | loads when relevant |
| Isolated execution or verbose work | subagent | separate context window |

Create a skill only when the content should not live in always-on startup context. In this repo, `CLAUDE.md` files are Claude runtime entry points that import adjacent `AGENTS.md` guidance.

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
| `metadata.keywords` | narrow domain terms for prompt matching |
| `metadata.file-triggers` | concrete owner paths for tool-scope matching |
| `metadata.priority` | authoring/display context; not read by the current matcher |
| `metadata.docs` | URLs to external documentation for the skill's domain |
| `disable-model-invocation` | context-only: matches keywords but loads via Read, not Skill tool |
| `user-invocable` | hide background/supporting skills from `/` when needed |
| `validate` | inactive documentation-only notes; use guards/tests for enforcement |
| `chainTo` | inactive documentation-only notes; not read by the current matcher |
| `retrieval` | aliases, intents, entities for authoring context; not scored by the current hook matcher |
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

## Optional Authoring Metadata

The current hook matcher reads only explicit skill names, `metadata.keywords`, and `metadata.file-triggers`. It does not parse custom `validate` or `chainTo` blocks. Do not add regex-style skill metadata as enforcement; add a guard or test instead, and use structured parsing or AST helpers for code structure.

### retrieval — Enrich authoring context

Use `retrieval` to document semantic signals that do not belong in deterministic prompt keywords. Retrieval is authoring context only in the current hook matcher.

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

### Complete example

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
  file-triggers:
    - "**/error.{tsx,ts}"
    - "**/instrumentation.{ts,js}"
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
