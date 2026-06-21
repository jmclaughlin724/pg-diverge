# src/ — supaschema CLI and library source

TypeScript (NodeNext ESM) compiled to `dist/`. Public API surface is `src/index.ts`.

## Organization

- `cli.ts`, `cli-diff.ts`, `cli-reports.ts`, `cli-tools.ts` — commander command registration and subcommand wiring
- `workflow.ts` — `syncMigrations` orchestrator (fallback + configured-target lanes); the apply path stays here
- `sync-targets.ts` — sync target selection and database-URL resolution (pure logic, no DB)
- `config.ts` / `config-validate.ts` — zod config schema + loading, and path/URL validation
- `config-contract.ts` — canonical config constants and enum contracts (mirrored to `bin/config-contract.mjs`)
- `planner.ts`, `sql/` — schema diff planning and Postgres AST extract/model/render
- `verify.ts`, `check.ts` — replay-safety verification and migration SQL checks
- `typegen-*.ts` — generated TypeScript/Zod contract emission from the declarative tree

## Owners and commands

- Migration policy and generated contracts: `.claude/rules/supaschema.md`
- Repo-wide change discipline: root `AGENTS.md`, `.claude/rules/01-operating-rules.md`
- `npm run typecheck` (tsc), `npm run build` (emit `dist/`), `npm test`
