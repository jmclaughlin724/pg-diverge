# scripts/ — repo tooling

Maintainer scripts: guards, agent-hook runtime, agent-surface sync, docs linting, release/github helpers, and local-only code-atlas/stripe tooling.

## Subfolders

- `guards/` — `check-*.mjs` invariant guards (`npm run guard`)
- `agent-hooks/` — shared Claude/Codex hook runtime
- `skills/` — `sync-llm.mjs` agent-surface sync writer
- `docs-lint/` — docs-standard linter modules
- `code-atlas/`, `stripe/` — local-only (gitignored)

## Top-level scripts

- `check-docs-standard.mjs` — docs authoring standard (`npm run docs:lint`)
- `clean-dist.mjs`, `check-schema.mjs`, `format-*.mjs` — generated output cleanup, schema generation, and per-language formatters

## Owners

- Operating rules and gates: `.claude/rules/01-operating-rules.md`
- Toolchain and formatters: `.claude/rules/06-multi-language-toolchain.md`
