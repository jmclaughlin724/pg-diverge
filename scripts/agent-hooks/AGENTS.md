# scripts/agent-hooks/ — shared hook runtime

Shared Claude and Codex hook runtime, imported by both `.claude/hooks/**` and `.codex/hooks/**`. Bare imports must be declared repository dependencies; the isolated session-lifecycle closure remains limited to its explicit `node:` builtin set and relative runtime files (enforced by `check-hook-import-graph.mjs`).

## Contents

- `hook-entrypoint.mjs` — shared stdin, runtime, output, and input-error handling
- `session-lifecycle.mjs` — silent SessionStart state refresh and SessionEnd cleanup
- `runner.mjs` — non-lifecycle event dispatcher (main-session skill gate, subagent advisory context, Bash safety, and verification conflicts)
- `command-evidence.mjs` — command-evidence recording and verification-domain classification
- `response-evidence.mjs` — structured tool-outcome parsing only
- `response-claims.mjs` — parser-driven success claims checked only against unresolved structured failure evidence
- `skills.mjs` — skill discovery, prompt/tool matching, observable-load detection
- `state.mjs` — serialized per-session state
- `hook-output.mjs` — event output shaping and failure diagnostics

## Dependency topology

- `.claude/settings.json` registers canonical `.claude/hooks/context-*.mjs` entrypoints. Session lifecycle entrypoints delegate only to `session-lifecycle.mjs`; all other context entrypoints delegate to `runner.mjs`.
- `runner.mjs` owns source-repo dispatch and composes the shared runtime modules above plus `.claude/hooks/guards/bash-policy-checks.mjs`.
- `scripts/skills/sync-llm.mjs` byte-mirrors canonical hook sources into `.codex/hooks/**`, renders `.codex/hooks.json`, and generates the package-manager-specific consumer configs under `agent-bundle/**`.
- `.claude/hooks/supaschema-source-hook.mjs` bootstraps `dist/cli.js`, whose canonical source hook workflow is `src/hooks/**`.
- `.claude/hooks/sync-llm-on-claude-surface-change.mjs` invokes the canonical `npm run sync:llm` generator after owned-surface mutations.
- Consumer hook templates invoke only the compiled Supaschema generated-artifact and schema-write hooks on actual edit tools; the source-repository Bash policy remains private to `runner.mjs`.
- `check-hook-import-graph.mjs` parses static import, re-export, and literal dynamic-import edges with the TypeScript AST and resolves every relative target. The two command/runtime edges above are intentionally non-import edges and are enforced by the hook registration, sync, package, and focused runtime tests.

## Owners

- Deterministic hook context and skill loading: `.claude/rules/12-skill-loading-enforcement.md`
- Generated agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`
- Verify: `npm run guard:agent`, focused tests in `tests/agent-hooks/agent-hook-core.test.ts` and `tests/agent-hooks/agent-hooks.test.ts`
