# Skill Frontmatter Schema

Formal schema for historical optional authoring blocks a skill may carry in its frontmatter: `validate`, `chainTo`, and `retrieval`. These are documentation-only extensions to the official Claude Code skill frontmatter — they describe authoring intent and travel with the skill. In supaschema the shared agent hook matcher (`scripts/agent-hooks/skills.mjs`) scores explicit skill names, `metadata.keywords`, and `metadata.file-triggers`; it does not parse these custom blocks. Do not add `validate` or `chainTo` to repo-managed skills as enforcement. Add a guard or test instead, and use structured parsing or AST helpers for code structure.

Generated mirrors are produced by `scripts/skills/sync-llm.mjs` (`npm run sync:llm`), which owns the mapping from `.claude/**` source surfaces into Codex and `.agents` targets. It byte-copies the full `.claude/skills/**` tree into `.agents/skills/**`, byte-copies `.claude/hooks/**` into `.codex/hooks/**`, renders `.claude/agents/**/*.md` into Codex-native `.codex/agents/**/*.toml`, and renders `.claude/rules/**/*.md` into comment-only `.codex/rules/**/*.rules` files.

---

## `validate` — Anti-Pattern Detection

Top-level array. Historical documentation-only notes for anti-patterns. The current runtime does not evaluate these entries.

```yaml
validate:
  - pattern: string # Historical note only; not evaluated by the current runtime
    message: string # Required. Human-readable explanation
    severity: string # Optional. "error" | "warn" | "recommended". Default: "warn"
    skipIfFileContains: string # Historical note only; not evaluated by the current runtime
    upgradeToSkill: string # Optional. Skill name to suggest instead. Must exist.
    upgradeWhy: string # Optional. Explanation for the upgrade suggestion
```

### Validation Rules

| Field | Check | Failure Mode |
| --- | --- | --- |
| `pattern` | String only | Current runtime ignores this field |
| `message` | Must be present | Explicit validator errors |
| `severity` | Must be `error`, `warn`, or `recommended` | Explicit validator errors; runtime defaults to `warn` |
| `skipIfFileContains` | String only | Current runtime ignores this field |
| `upgradeToSkill` | If present, must match a real skill directory name | Explicit validator errors |

Do not copy this block into new repo-managed skills. If a mistake should be prevented, add or extend a guard/test owned by the relevant rule.

---

## `chainTo` — Skill Chaining

Top-level array. Historical documentation-only notes for companion skills. The current runtime does not evaluate these entries or enqueue companion skills from skill body text.

```yaml
chainTo:
  - pattern: string # Historical note only; not evaluated by the current runtime
    targetSkill: string # Required. Skill name to chain to. Must exist in catalog.
    message: string # Optional. Explanation shown when chaining
    skipIfFileContains: string # Historical note only; not evaluated by the current runtime
```

### Validation Rules

| Field                | Check       | Failure Mode                       |
| -------------------- | ----------- | ---------------------------------- |
| `pattern`            | String only | Current runtime ignores this field |
| `targetSkill`        | String only | Current runtime ignores this field |
| `skipIfFileContains` | String only | Current runtime ignores this field |

Do not copy this block into new repo-managed skills. If two skills should load together regularly, consolidate the guidance or add explicit prompt keywords/file triggers to the correct owner.

---

## `retrieval` — Discovery Metadata

Top-level object. Provides authoring context for aliases, intents, and entities. The current hook matcher does not score retrieval entries; put deterministic prompt terms in `metadata.keywords`.

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

Focused template for new skills. Keep deterministic routing in active `metadata.*` fields; add guards or tests for enforcement.

```yaml
---
name: my-skill
description: "Use when ..."
metadata:
  keywords:
    - term1
    - term2
  file-triggers:
    - "src/**"
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
| Explicit skill validator | Optional authoring check only; enforcement belongs in guards/tests |
| `scripts/agent-hooks/skills.mjs` runtime | Skill discovery and gate/inject enforcement via shared Claude/Codex hook wrappers; custom `validate`/`chainTo`/`retrieval` blocks are not read by the current matcher |
| `npm run sync:llm` | Mapped Claude-to-Codex sync owned by `scripts/skills/sync-llm.mjs`; skill and hook directories are byte-copied, Claude agent frontmatter/body is rendered into Codex TOML, and Claude Markdown rules are rendered into comment-only Codex `.rules` files |

Run `npm run sync:llm` as the closeout for any edit under `.claude/skills/**`, `.claude/hooks/**`, `.claude/agents/**`, or `.claude/rules/**` so generated Codex and `.agents` mirrors stay aligned to the canonical source.

## Skill mirror contract

`scripts/skills/sync-llm.mjs` mirrors the full `.claude/skills/**` directory. Adding, moving, or deleting a file under a Claude skill requires no sync-manifest edit; rerun `npm run sync:llm` and the `.agents/skills/**` tree is replaced with the current source tree.

After changing a mirrored skill's file set, re-run `npm run sync:llm`, then confirm the same file now exists under `.agents/skills/<skill>/`.
