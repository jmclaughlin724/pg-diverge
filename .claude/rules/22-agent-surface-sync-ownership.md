---
description: Generated agent-surface ownership, synchronization, and hook-registration projections.
enforcement:
  type: enforced
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

# Rule 22 - Generated agent-surface sync ownership

## Contract

`scripts/skills/sync-llm.mjs` is the single idempotent writer for generated Claude-to-Codex, Claude-to-Agents, public-skill, and consumer-bundle outputs. Generated surfaces are never independent inputs.

Synchronization is always the actual write operation. There is no check-only sync command or read-only parity mode. Run `npm run sync:llm`; content-identical writes are skipped.

## Ownership

- `.claude/settings.json` owns source Claude hook registration.
- `.claude/hooks/**`, `.claude/rules/**`, `.claude/skills/**`, and `.claude/agents/**` own their generated projections.
- `scripts/skills/agent-surface-manifest.mjs` owns canonical source roots, exact source files where ownership is singular, applicable source file types, targets, and target-trigger classification. The only agent prompt input is `.agents/prompts/supaschema-install.md`; sibling prompt files are unrelated and must not trigger sync.
- Parsed skill frontmatter with `metadata.public: true` owns public skill publication; no separate skill-name list exists.
- `.codex/config.toml` remains a direct runtime owner and is not generated.
- Consumer templates contain only the Supaschema generated-artifact protection and schema-write workflow hooks.

## Hook registration projection

- Source Claude and generated Codex register silent `SessionStart` and `SessionEnd`, prompt matching, subagent advisory context, and Stop verification-conflict checks.
- Context `PreToolUse` uses `Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch` in both runtimes.
- Context `PostToolUse` uses `Bash|Read|Skill`. Claude alone registers `PostToolUseFailure` for `Bash`.
- Claude product and surface hooks use `Write|Edit|MultiEdit|apply_patch`; Codex product and surface hooks use `apply_patch`.
- `WorktreeCreate` is not registered. Surface sync is not registered for Bash, failure, Stop, or unrelated events.
- Codex commands resolve the repository with `git rev-parse --show-toplevel` and provide a Windows equivalent; they do not depend on undocumented project-root injection.

## Target-first synchronization

- The surface-sync `PostToolUse` hook parses the explicit edit target before reading package configuration or doing other work.
- Only canonical-source edits identified structurally by exact source file or source root and file type in `agent-surface-manifest.mjs` run `npm run sync:llm`.
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

## Failure behavior

If sync, writer, or registration validation fails:

1. Identify whether the failure is in a canonical source (`.claude/hooks/**`, `.claude/rules/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/settings.json`), the manifest (`scripts/skills/agent-surface-manifest.mjs`), or the writer (`scripts/skills/sync-llm.mjs`).
2. Fix the canonical source or the manifest's source roots, exact files, and target-trigger classification first. Never hand-edit `.codex/hooks.json`, `.codex/hooks/**`, `.codex/rules/**`, `.codex/agents/**`, `.agents/skills/**`, public `skills/**`, or `agent-bundle/**`.
3. Re-run `npm run sync:llm`. A content-identical write is a no-op, so a persistent diff after rerunning means the source or manifest fix was incomplete.
4. Re-run `npm run guard:agent` so the topology and import-closure guards prove the projection against the regenerated targets.
5. If the failure is a missed or over-eager sync trigger, fix the classification in `agent-surface-manifest.mjs`; do not add ad hoc hashing, digest state, or a second sync path.
6. If a consumer-boundary check fails, fix the stripping or rendering logic in `sync-llm.mjs` (source-only hook removal, package-manager command materialization); do not patch the generated `agent-bundle/**` output directly.

## Done means

- The actual writer has run after the final canonical edit.
- Generated Codex, Agents, public-skill, and consumer surfaces reflect parsed canonical inputs.
- Maintainer registrations implement the exact event and matcher contract above.
- Consumer templates contain exactly the two product hooks with runtime-correct edit matchers.
- No check-only sync command, digest state, generated-target trigger, or duplicate publication list remains.
