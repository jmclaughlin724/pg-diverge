# scripts/agent-hooks/ — shared hook runtime

Shared Claude and Codex hook runtime, imported by both `.claude/hooks/**` and `.codex/hooks/**`. Must import only `node:` builtins and relative files (enforced by `check-hook-import-graph.mjs`).

## Contents

- `runner.mjs` — event dispatcher (skill gate and Bash safety)
- `command-evidence.mjs` — command-evidence recording and verification-domain classification
- `response-evidence.mjs` — tool-outcome, GitHub-failure, and exit-code parsing
- `response-claims.mjs` and `response-shape.mjs` — final-response claim and closeout correction checks
- `evidence-gate.mjs` — prevents further mutations while a response-evidence correction is unresolved
- `skills.mjs` — skill discovery, prompt/tool matching, observable-load detection
- `state.mjs` — serialized per-session state
- `hook-output.mjs` and `atlas.mjs` — event output and Code Atlas helpers
- `merged-branch-state.mjs` — squash-merged topic-checkout context

## Dependency topology

- `.claude/settings.json` registers canonical `.claude/hooks/context-*.mjs` entrypoints; each delegates one event to `runner.mjs`.
- `runner.mjs` owns source-repo dispatch and composes the shared runtime modules above plus `.claude/hooks/guards/bash-policy-checks.mjs`.
- `scripts/skills/sync-llm.mjs` byte-mirrors canonical hook sources into `.codex/hooks/**`, renders `.codex/hooks.json`, and generates the package-manager-specific consumer configs under `agent-bundle/**`.
- `.claude/hooks/supaschema-source-hook.mjs` bootstraps `dist/cli.js`, whose canonical source hook workflow is `src/hooks/**`.
- `.claude/hooks/sync-llm-on-claude-surface-change.mjs` invokes the canonical `npm run sync:llm` generator after owned-surface mutations.
- Consumer hook templates invoke only the compiled Supaschema generated-migration and schema-write hooks; the Bash policy remains source-repo-only in `runner.mjs`.
- `check-hook-import-graph.mjs` parses static import, re-export, and literal dynamic-import edges with the TypeScript AST and resolves every relative target. The two command/runtime edges above are intentionally non-import edges and are enforced by the hook registration, sync, package, and focused runtime tests.

## Owners

- Deterministic hook context and skill loading: `.claude/rules/12-skill-loading-enforcement.md`
- Generated agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`
- Verify: `npm run guard:agent`, focused tests in `tests/agent-hooks/agent-hook-core.test.ts` and `tests/agent-hooks/agent-hooks.test.ts`
