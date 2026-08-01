# scripts/skills/ — agent-surface sync writer

The single writer for generated Claude-to-Codex and Claude-to-Agents outputs.

## Contents

- `sync-llm.mjs` — writes `.codex/hooks.json`, `.codex/hooks/**`, `.codex/agents/**`, `.codex/rules/**`, `.agents/skills/**`, public `skills/supaschema`, and `agent-bundle/**` from `.claude/**` owners
- `codex-rules.mjs` — Codex agent/rule rendering helpers

## Owners

- Context surface sync matrix: `.claude/rules/18-context-surface-sync.md`
- Generated agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`
- Edit the `.claude/**` owner, then run the idempotent `npm run sync:llm` writer and `npm run guard:agent`. Never hand-edit generated mirrors.
