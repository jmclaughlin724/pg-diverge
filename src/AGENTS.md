# src/ — supaschema CLI and library source

TypeScript (NodeNext ESM) compiled to `dist/`. Public API surface is `src/index.ts`.

## Organization

- `cli.ts`, `cli/diff.ts`, `cli/reports.ts`, `cli/tools.ts` — commander command registration and subcommand wiring
- `workflow/sync.ts`, `workflow/targets.ts`, `workflow/history.ts`, `workflow/report.ts`, `workflow/verify.ts` — sync orchestration, target selection, history reconciliation, reporting, and verification handoff
- `hooks/config.ts`, `hooks/targets.ts`, `hooks/checks.ts`, `hooks/payload.ts`, `hooks/commands.ts`, `hooks/output.ts` — schema-write hook config, payload parsing, target checks, command execution, and output rendering
- `migrations/files.ts`, `migrations/lineage.ts`, `migrations/stage.ts`, `migrations/status.ts`, `migrations/runners.ts` — migration file discovery, lineage markers, generated migration staging, history reconciliation, and runner execution
- `config/schema.ts` / `config/validate.ts` — zod config schema, loading, and path/URL validation
- `config/contract.ts` — canonical config constants and enum contracts mirrored to `bin/config-contract.mjs`
- `catalog/query.ts`, `catalog/extract.ts`, `catalog/types.ts`, `catalog/tables.ts`, `catalog/sequences.ts`, `catalog/foreign.ts`, `catalog/grants.ts`, `catalog/comments.ts` — read-only catalog extraction and live database model construction
- `source/resolve.ts`, `source/normalize.ts`, `source/extract.ts`, `database/url.ts`, `database/admin.ts` — source resolution, SQL-tree normalization, source model extraction, database URL discovery, and disposable database lifecycle
- `planner/schema.ts`, `planner/table.ts`, `planner/replace.ts`, `planner/order.ts`, `render/migration.ts`, `render/guards.ts`, `sql/` — schema diff planning, guarded SQL rendering, and Postgres AST extract/model/render helpers
- `grants/default-acl.ts` — default-privilege planning support
- `verify/migration.ts`, `check/migration.ts`, `check/report.ts` — replay-safety verification and migration SQL checks
- `scan/rules.ts`, `scan/model.ts`, `scan/aggregate.ts` — rule packs, safety scoring, JSON report validation, aggregation, and badge rendering
- `pipeline/diff.ts`, `pipeline/deploy-safety.ts`, `pipeline/type-safety.ts` — source-to-plan construction and workflow deploy gates
- `contract/schema.ts`, `contract/type-diff.ts`, `contract/registry-client.ts` — schema contract shape, type-contract drift, and registry client behavior
- `typegen/database.ts`, `typegen/model.ts`, `typegen/views.ts`, `typegen/zod.ts`, `typegen/contracts.ts` — generated TypeScript/Zod contract emission from the declarative tree
- `benchmark/run.ts`, `benchmark/diff-score.ts`, `benchmark/fixtures.ts`, `corpus.ts` — benchmark and corpus verification surfaces
- `audit.ts`, `diagnostics.ts`, `doctor.ts`, `hash.ts`, `intake.ts`, `license.ts`, `onboard.ts`, `paths.ts`, `redaction.ts`, `remediation.ts`, `selfcheck.ts`, `validators.ts` — focused single-concern roots

## Owners and commands

- Migration policy and generated contracts: `.claude/rules/supaschema.md`
- Repo-wide change discipline: root `AGENTS.md`, `.claude/rules/01-operating-rules.md`
- `npm run typecheck` (tsc), `npm run build` (emit `dist/`), `npm test`
