---
description: Generated agent-surface ownership, synchronization, and hook-registration projections.
paths:
  - ".claude/agents/**"
  - ".claude/hooks/**"
  - ".claude/rules/**"
  - ".claude/settings.json"
  - ".claude/skills/**"
  - ".agents/skills/**"
  - ".codex/agents/**"
  - ".codex/hooks/**"
  - ".codex/hooks.json"
  - ".codex/rules/**"
  - "agent-bundle/**"
  - "scripts/guards/agent-surface/**"
  - "scripts/skills/agent-surface-manifest.mjs"
  - "scripts/skills/sync-llm.mjs"
---

# Rule 22 — Generated agent-surface sync ownership

## Contract

`scripts/skills/sync-llm.mjs` is the single idempotent writer for generated Claude-to-Codex, Claude-to-Agents, public-skill, and consumer-bundle outputs. Generated surfaces are never independent inputs.

Synchronization is always the actual write operation. There is no check-only sync command or read-only parity mode. Run `npm run sync:llm`; content-identical writes are skipped.

## Ownership

- `.claude/settings.json` owns source Claude hook registration.
- `.claude/hooks/**`, `.claude/rules/**`, `.claude/skills/**`, and `.claude/agents/**` own their generated projections.
- `scripts/skills/agent-surface-manifest.mjs` owns canonical source roots, applicable source file types, target roots, and target-trigger classification. This includes MDX documentation, agent prompt sources, and sync-writer modules in addition to Claude-owned surfaces.
- Parsed skill frontmatter with `metadata.public: true` owns public skill publication; no separate skill-name list exists.
- `.codex/config.toml` remains a direct runtime owner and is not generated.
- Consumer templates contain only the Supaschema generated-artifact protection and schema-write workflow hooks.

## Hook registration projection

- Source Claude and generated Codex register silent `SessionStart` and `SessionEnd`, prompt matching, subagent advisory context, and Stop verification-conflict checks.
- Context `PreToolUse` uses `Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch` in both runtimes.
- Context `PostToolUse` uses `Bash|Read|Skill`. Claude alone registers `PostToolUseFailure` for `Bash` and `TaskCompleted` for unresolved required skills.
- Claude product and surface hooks use `Write|Edit|MultiEdit|apply_patch`; Codex product and surface hooks use `apply_patch`.
- `WorktreeCreate` is not registered. Surface sync is not registered for Bash, failure, Stop, or unrelated events.
- Codex commands resolve the repository with `git rev-parse --show-toplevel` and provide a Windows equivalent; they do not depend on undocumented project-root injection.

## Target-first synchronization

- The surface-sync `PostToolUse` hook parses the explicit edit target before reading package configuration or doing other work.
- Only canonical-source edits identified structurally by source root and file type in `agent-surface-manifest.mjs` run `npm run sync:llm`.
- Bash, failure, Stop, generated-target, and unrelated edit events return immediately without hashing, digest state, or repair.
- Generated drift is reported by guards and tests. It is never silently repaired after an unrelated event.
- Hook-boundary writer failures are visible and non-blocking. Direct writer and guard commands retain their ordinary failing exit status.

## Enforcement chain

- `npm run guard:agent` runs the actual sync writer before topology and import-closure guards.
- `scripts/guards/agent-surface/check-agent-hooks.mjs` owns exact registration and consumer-template topology.
- `scripts/guards/agent-surface/check-hook-import-graph.mjs` owns runtime import closure.
- Focused tests under `tests/agent-hooks/**` own writer idempotence, target-first behavior, runtime decisions, and consumer projections.

## Verification

```bash
npm run sync:llm
npm run guard:agent
npm test -- tests/agent-hooks/sync-llm.test.ts tests/agent-hooks/agent-hook-core.test.ts tests/agent-hooks/agent-surfaces.test.ts tests/agent-hooks/agent-hooks.test.ts
```

For consumer-boundary changes, also run `npm run guard:public-surface` and `npm run check:package`.

## Done means

- The actual writer has run after the final canonical edit.
- Generated Codex, Agents, public-skill, and consumer surfaces reflect parsed canonical inputs.
- Maintainer registrations implement the exact event and matcher contract above.
- Consumer templates contain exactly the two product hooks with runtime-correct edit matchers.
- No check-only sync command, digest state, generated-target trigger, or duplicate publication list remains.
