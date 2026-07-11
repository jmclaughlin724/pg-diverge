# scripts/guards/ — invariant guards, organized by domain

Single-concern `check-*.mjs` guards proving repo invariants, grouped by domain. The umbrella is `npm run guard` (`check-all.mjs`), which must print `ALL_GUARDS_OK`.

## Layout

- `check-all.mjs` — single guard source: runs every domain guard, then the public-checkout subset, prints `ALL_GUARDS_OK`
- `lib/` — guard assertions, process execution, repository access, graph traversal, TypeScript AST, and PostgreSQL AST owners
- `code-shape/` — canonical code-surface shape (Rule 01/07/13): `check-canonical-surfaces.mjs` aggregator + `check-change-discipline.mjs`, `check-pattern-engine.mjs`, `check-package-scripts.mjs`, `check-child-process-shell.mjs`, `ast-scan.mjs`
- `toolchain/` — `check-tooling-stack.mjs`, `check-lsp-coverage.mjs` (Rule 06/08)
- `ci-release/` — `check-ci-governance.mjs`, `check-codex-execpolicy.mjs`, `check-github-process.mjs`, `check-release-version-surfaces.mjs` (Rules 09/19/21)
- `agent-surface/` — `check-agent-hooks.mjs`, `check-agent-surface-parity.mjs`, `check-claude-agents.mjs`, `check-hook-import-graph.mjs` (Rule 12/22)
- `repo-surface/` — `check-public-repo-surface.mjs`, `check-repo-layout.mjs` (Rule 13/20)
- `docs-config/` — `check-config-standardization.mjs`, `check-rule-citations.mjs`, `check-schema.mjs`
- `fastmcp/check-fastmcp-agent.mjs` (Rule 11)
- `code-atlas/check-code-atlas.mjs` (Rule 10)
- `deps/check-dependency-catalog.mjs`

## Owners

- Gates are real; fix the cause, never weaken a guard: `.claude/rules/01-operating-rules.md`
- CI/release governance: `.claude/rules/09-ci-cd-efficiency-governance.md`
- Each guard is single-concern by domain; split new invariants into the owning domain folder, never a catch-all file
