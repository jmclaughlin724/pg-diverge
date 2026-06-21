# scripts/agent-hooks/ — shared hook runtime

Shared Claude and Codex hook runtime, imported by both `.claude/hooks/**` and `.codex/hooks/**`. Must import only `node:` builtins and relative files (enforced by `check-hook-import-graph.mjs`).

## Contents

- `runner.mjs` — event dispatcher (skill gate, response-evidence gate, Bash safety)
- `command-evidence.mjs` — command-evidence recording and verification-domain classification
- `evidence-gate.mjs` — PreToolUse response-evidence gate (subagent-advisory)
- `response-shape.mjs` — response-shape detectors (`runResponseDetectors`)
- `response-evidence.mjs` — tool-outcome, GitHub-failure, and exit-code parsing
- `skills.mjs` — skill discovery, prompt/tool matching, observable-load detection
- `state.mjs` — serialized per-session state
- `tool-payload.mjs`, `hook-output.mjs`, `response-claims.mjs`, `atlas.mjs` — payload and evidence helpers

## Owners

- Deterministic hook context and skill loading: `.claude/rules/12-skill-loading-enforcement.md`
- Generated agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`
- Verify: `npm run guard:agent`, focused tests in `tests/agent-hook-core.test.ts` and `tests/agent-hooks.test.ts`
