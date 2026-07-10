# scripts/agent-hooks/ — shared hook runtime

Shared Claude and Codex hook runtime, imported by both `.claude/hooks/**` and `.codex/hooks/**`. Must import only `node:` builtins and relative files (enforced by `check-hook-import-graph.mjs`).

## Contents

- `runner.mjs` — event dispatcher (skill gate and Bash safety)
- `command-evidence.mjs` — command-evidence recording and verification-domain classification
- `response-evidence.mjs` — tool-outcome, GitHub-failure, and exit-code parsing
- `skills.mjs` — skill discovery, prompt/tool matching, observable-load detection
- `state.mjs` — serialized per-session state
- `hook-output.mjs` and `atlas.mjs` — event output and Code Atlas owners

## Owners

- Deterministic hook context and skill loading: `.claude/rules/12-skill-loading-enforcement.md`
- Generated agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`
- Verify: `npm run guard:agent`, focused tests in `tests/agent-hooks/agent-hook-core.test.ts` and `tests/agent-hooks/agent-hooks.test.ts`
