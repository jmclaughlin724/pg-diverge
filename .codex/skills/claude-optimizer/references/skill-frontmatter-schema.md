# Skill Frontmatter Schema

Formal schema for three optional authoring blocks a skill may carry in its frontmatter: `validate`, `chainTo`, and `retrieval`. These are documentation-only extensions to the official Claude Code skill frontmatter — they describe authoring intent and travel with the skill. In supaschema the skill router (`scripts/skills/skill-router.mjs`, invoked through `.claude/hooks/skill-*.mjs`) matches and gates skills by their official `description`/keywords; it does not currently parse these custom blocks. Treat the rules below as the schema to honor when an explicit skill validator is requested, and keep entries accurate so a future runtime can fold them in without rework.

Generated mirrors are produced by `scripts/skills/sync-llm.mjs` (`npm run sync:llm`), which owns the mapping from `.claude/**` source surfaces into Codex and `.agents` targets. It byte-copies the full `.claude/skills/**` tree into `.agents/skills/**` and `.codex/skills/**`, byte-copies `.claude/hooks/**` into `.codex/hooks/**`, renders `.claude/agents/**/*.md` into Codex-native `.codex/agents/**/*.toml`, and renders `.claude/rules/**/*.md` into comment-only `.codex/rules/**/*.rules` files.

---

## `validate` — Anti-Pattern Detection

Top-level array. Each entry detects a code anti-pattern in file content and warns or errors.

```yaml
validate:
  - pattern: string # Required. Regex tested against file content (case-insensitive)
    message: string # Required. Human-readable explanation
    severity: string # Optional. "error" | "warn" | "recommended". Default: "warn"
    skipIfFileContains: string # Optional. Regex — skip rule if file also matches this
    upgradeToSkill: string # Optional. Skill name to suggest instead. Must exist.
    upgradeWhy: string # Optional. Explanation for the upgrade suggestion
```

### Validation Rules

| Field | Check | Failure Mode |
| --- | --- | --- |
| `pattern` | Must be a valid regex | Explicit validator errors; runtime silently drops |
| `message` | Must be present | Explicit validator errors |
| `severity` | Must be `error`, `warn`, or `recommended` | Explicit validator errors; runtime defaults to `warn` |
| `skipIfFileContains` | If present, must be a valid regex | Explicit validator errors; runtime silently drops |
| `upgradeToSkill` | If present, must match a real skill directory name | Explicit validator errors |

### Example

```yaml
validate:
  - pattern: "pnpm |yarn "
    message: "supaschema is single-package npm only; never introduce pnpm or yarn"
    severity: error
    upgradeToSkill: ultracite
    upgradeWhy: "Load the repo lint/format/test runner conventions (ultracite over Biome, npm scripts)"
  - pattern: "biome (check|ci|format)"
    message: "Invoke Biome through Ultracite (npm run lint / lint:ci / format), not the raw biome CLI"
    severity: warn
    skipIfFileContains: "ultracite (check|fix|ci)"
    upgradeToSkill: ultracite
    upgradeWhy: "Reload the Ultracite policy for the correct wrapper commands"
```

---

## `chainTo` — Skill Chaining

Top-level array. After a skill is invoked, the chain evaluator can compare its `chainTo` rules against the skill's own SKILL.md body text plus the user's original prompt. When a pattern matches, the target skill is added to the pending-skills queue so the gate re-engages, blocking further work until the chained skill is also invoked.

```yaml
chainTo:
  - pattern: string # Required. Regex tested against skill body + prompt (case-insensitive)
    targetSkill: string # Required. Skill name to chain to. Must exist in catalog.
    message: string # Optional. Explanation shown when chaining
    skipIfFileContains: string # Optional. Regex — skip chain if text also matches this
```

### Validation Rules

| Field | Check | Failure Mode |
| --- | --- | --- |
| `pattern` | Must be a valid regex | Explicit validator errors; runtime silently drops |
| `targetSkill` | Must be present and match a real skill directory | Explicit validator errors; runtime drops entry |
| `skipIfFileContains` | If present, must be a valid regex | Explicit validator errors; runtime silently drops |

### Example

```yaml
chainTo:
  - pattern: "SUPA_[A-Z_]+|schema (diff|tree)|migration"
    targetSkill: supaschema
    message: "Schema/migration intent — loading supaschema for the diff/check/verify workflow"
  - pattern: "\\bruff\\b|\\bmypy\\b|\\bpytest\\b|services/agent-mcp"
    targetSkill: python
    message: "Python toolchain detected — loading the uv/ruff/mypy/pytest guidance"
```

---

## `retrieval` — Discovery Metadata

Top-level object. Provides additional keyword signals intended to be folded into the scoring pool alongside `metadata.keywords` and `metadata.intent-patterns`. All three arrays score identically at 1x per hit.

```yaml
retrieval:
  aliases: string[] # Optional. Alternative names for the skill's domain
  intents: string[] # Optional. Natural-language user intent phrases
  entities: string[] # Optional. Proper nouns, tool names, config files
```

### Validation Rules

| Field | Check | Failure Mode |
| --- | --- | --- |
| `retrieval` | Must be an object (not array) | Explicit validator errors; runtime ignores |
| `aliases` | If present, must be an array of strings | Explicit validator errors; runtime ignores non-arrays |
| `intents` | If present, must be an array of strings | Explicit validator errors; runtime ignores non-arrays |
| `entities` | If present, must be an array of strings | Explicit validator errors; runtime ignores non-arrays |

### Example

```yaml
retrieval:
  aliases:
    - migration
    - schema diff
    - declarative tree
  intents:
    - generate a migration
    - check replay safety
    - detect schema drift
  entities:
    - supaschema
    - supaschema.config.json
    - SUPA_DIFF_LINEAGE_BROKEN
```

---

## Quick Copy Template

Minimal template with all three fields for new skills:

```yaml
---
name: my-skill
description: "Use when ..."
metadata:
  keywords:
    - term1
    - term2
  intent-patterns:
    - "do.*something.*specific"
  file-triggers:
    - "src/**"
validate:
  - pattern: "some-antipattern"
    message: "Explanation of why this is wrong"
    severity: warn
chainTo:
  - pattern: "related-pattern"
    targetSkill: other-skill
    message: "Loading related guidance"
retrieval:
  aliases:
    - alternative name
  intents:
    - what users want to do
  entities:
    - ProperNoun
---
```

---

## Enforcement

| Layer | What It Checks |
| --- | --- |
| Explicit skill validator | Schema validation: types, required fields, regex validity, skill name existence |
| `skill-router.mjs` runtime | Skill discovery and gate/inject enforcement via the `.claude/hooks/skill-*.mjs` wrappers; custom `validate`/`chainTo`/`retrieval` blocks are not read by the current router |
| `npm run sync:llm` | Mapped Claude-to-Codex sync owned by `scripts/skills/sync-llm.mjs`; skill and hook directories are byte-copied, Claude agent frontmatter/body is rendered into Codex TOML, and Claude Markdown rules are rendered into comment-only Codex `.rules` files |

Run `npm run sync:llm` as the closeout for any edit under `.claude/skills/**`, `.claude/hooks/**`, `.claude/agents/**`, or `.claude/rules/**` so generated Codex and `.agents` mirrors stay aligned to the canonical source.

## Skill mirror contract

`scripts/skills/sync-llm.mjs` mirrors the full `.claude/skills/**` directory. Adding, moving, or deleting a file under a Claude skill requires no sync-manifest edit; rerun `npm run sync:llm` and the `.agents/skills/**` and `.codex/skills/**` trees are replaced with the current source tree.

After changing a mirrored skill's file set, re-run `npm run sync:llm`, then confirm the same file now exists under both `.agents/skills/<skill>/` and `.codex/skills/<skill>/`.
