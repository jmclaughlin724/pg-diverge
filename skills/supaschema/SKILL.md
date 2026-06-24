---
name: supaschema
description: Generate, check, and verify replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs with supaschema. Use when schema changes are requested, migrations must be created or validated, schema drift needs detection, or a supaschema diagnostic (SUPA_*) blocks a plan.
metadata:
  keywords:
    - supaschema
    - schema migration
    - database migration
    - declarative SQL
    - migration drift
    - SUPA diagnostic
---

# supaschema Migration Workflow

## Contract

This skill is a direct execution contract for producing schema migrations with supaschema. Follow the workflow in order; do not hand-author migration SQL for changes the declarative tree plus migration-derived source-intent lane can express, and never edit a generated migration (the `-- supaschema: lineage` marker) by hand.

When the bundled PostToolUse hook is wired (`.claude/settings.json` / `.codex/hooks.json`) and `workflow.schema_diff` / `workflow.migration_check` keep their defaults, a write to a schema-tree `.sql` file auto-runs `diff` then `check <generated migration path...>` and returns the generated migration name or blocking `SUPA_*` diagnostic. If `workflow.migration_sync` allows automatic sync, the hook first confirms exactly one `sync.targets` entry is selected with `mode: "auto"`, its database URL reference resolves when its runner needs one, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync` for the full source, diff, target-selection, history, check, generated-contract, stage, safety, verify, runner, and reconciliation workflow. If `check` or `sync` fails, inspect the diagnostic, fix the canonical source, and rerun the failing command.

## Installed Setup

The normal consumer setup is package install plus one explicit setup command through the consuming project's package manager. Default `supaschema init` writes or repairs `supaschema.config.json`, configured schema directories, configured migration directories, safe focused package scripts when `package.json` exists (`supaschema:diff`, `supaschema:stage`, `supaschema:types`, and `supaschema:check`), package-owned active AI enforcement under `.agents`, `.claude`, and `.codex`, and `.supaschema/install.json` only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories. It copies missing package-bundled prompt/rule/skill/hook files, merges the package-manager-specific `.claude/settings.json` and `.codex/hooks.json` entries, preserves existing non-identical files, and reports skipped non-mergeable hook config so the agent can repair the gap. Supabase projects whose owner brief marks `supabase/schemas/**` as inventory, or whose schema tree contains `_bootstrap`, still get a working config with `workflow.schema_diff` and `workflow.migration_sync` set to `manual`, Supabase-managed schemas seeded into `schemas.exclude`, and `_bootstrap` directories skipped by schema-source readers. It does not write `AGENTS.md`, `CLAUDE.md`, backup directories, maintainer tooling, or apply-capable package scripts. Use direct CLI commands for setup diagnostics, full sync/apply, and database execution verification: `supaschema config validate`, `supaschema sync`, `supaschema apply`, and `supaschema verify`.

If this skill was installed through `npx skills`, treat it as portable workflow context only. Agent Skills installs `SKILL.md`-based folders into a user-selected skill location; it does not create `supaschema.config.json`, schema/migration directories, passive rule files, hook scripts, or hook registration. To install project enforcement surfaces, install the npm package with the consuming project's manager from the owning package directory, then run `supaschema init`; the npm package installer is the activation path for the bundled `.agents`, `.claude`, and `.codex` enforcement files.

Before the first schema edit, check `.supaschema/install.json` first. Normal resolved installs do not create `.supaschema/`; if the manifest exists and says `"pathConfirmationNeeded": true`, treat it as an agent handoff, inspect `agentInstructions`, choose from candidate `schemaPaths` and `migrationsDirs`, then create or update `supaschema.config.json` with explicit `schemaPaths`, `sources.to`, and `migrationsDir` before running validation or workflow commands. If no pending manifest exists, inspect `supaschema.config.json` directly. Do not generate a migration from a guessed path; the bundled hooks also skip auto-diff until all three fields are explicit.

Use the configured `schemaPaths`, `sources`, and `migrationsDir` as the source of truth. Do not create a parallel schema tree, a second migrations directory, duplicate database credentials, or a new config unless the user explicitly asks to change project layout. Supabase installs use the Supabase CLI runner by default; other PostgreSQL installs reuse detected existing database URL environment variable names in `sync.targets` when present.

Before saying supaschema cannot model a migration, inspect all three configured sources:

- `schemaPaths` / `sources.to` for the declarative end-state;
- `sources.from` for the before-state baseline;
- `migrationsDir` for existing migration source intent.

Existing migrations are not only history. They are the source-intent corpus for operational facts the schema tree cannot express by shape alone, including row backfills, explicit DML/`DO` workflows, enum rewrite recipes, Vault references or placeholder names, workload-proven index intent, reviewed routine drops, and provider bootstrap constraints. Preserve explicit intent from those files through the planner/check/verify lane. Never invent missing row values, Vault secret material, tenant predicates, conversion expressions, or workload indexes; when the corpus lacks the fact, produce or follow the diagnostic/agent instruction that names the canonical file, config, hint, or workload artifact that must declare it.

## Config Reference

Read `supaschema.config.json` before editing schemas. Treat these four decisions as the agent-facing source of truth:

- **Schema tree:** `schemaPaths`, `sources.to`, and `migrationsDir`. Edit only the configured schema roots; `dir:` sources read nested `.sql` files recursively and merge them into one model. `sources.to` is the explicit target for zero-source-flag `diff`, `plan`, and `verify`. Generated migrations write to `migrationsDir`.
- **Diff baseline:** `sources.from` and `sources.to`. Install writes `sources.from: "auto"` and `sources.to: "dir:<schemaPaths[0]>"`; examples or fixture projects can pin `dump:`, `dir:`, `git:`, `database:`, `catalog:`, or `empty:` values when that source is the project contract.
- **Generated contracts:** `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`. `supaschema types` creates or refreshes TypeScript and Zod outputs from the configured schema source; `zod_validated` means agents should use generated Zod validators at runtime boundaries.
- **Apply policy:** `workflow.migration_sync` and `sync.targets`. The default `migration_sync: "auto"` keeps bare `supaschema sync` apply-capable for one target with `mode: "auto"`. Set a target to `manual` to omit it from bare sync, set `workflow.migration_sync` to `manual` to require `--target <name>`, or set it to `disabled` to block apply. Multiple automatic targets are refused because cross-target apply is not atomic. Remote targets also require `requireApprovalEnv`.

Other config fields refine those decisions: `managedSchemas` blocks externally owned schemas, Supabase installs mirror those names into `schemas.exclude`, `transactionMode` mirrors the apply runner, `environments` optionally holds extra `$ENV_NAME` URL references, and `adapter: "auto"` is a provider-neutral sentinel rather than workflow consent.

## Workflow

1. **Edit the declarative tree** (`config.schemaPaths`) to express the desired end state. Typical roots are `database/schemas/**` for neutral PostgreSQL, `supabase/schemas/**` for Supabase, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**` for detected managed PostgreSQL providers. Use schema-qualified object names. When a change depends on data movement, secret placeholders, or workload-derived indexes, confirm the intent already exists in the configured migration corpus, config, hint, or workload artifact before generating.
2. **Generate the migration:**

   ```bash
   supaschema diff
   ```

   Zero-source-flag defaults come from `config.sources` and are printed to stderr. `sources.from: "auto"` resolves to valid `git:HEAD`, then a database URL, then `empty:`; `sources.to` points at the configured declarative tree. The file lands in `config.migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` only when the human wants a specific file name. The write is no-clobber and chain-gated. If it exits 2, read the diagnostic:
   - `SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED` / `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` / `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` / `SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED` — review the rendered `-- BLOCKED` section, then add the exact object key to `hints.destructive` in `supaschema.config.json` and regenerate. Never use `"*"` in committed config. Rendered `-- supaschema: operation ...` comments disclose destructive or drop-guard intent; disclosure is not a second blocker once the planner has allowed the operation.
   - `SUPA_DIFF_LINEAGE_BROKEN` — a pending generated migration exists; diff from the post-migration state instead: `--from database:<db with pending applied>`.
   - `SUPA_DIFF_LINEAGE_DUPLICATE` — the transition is already pending; apply or remove the pending migration instead of regenerating.
   - Renames: declare `{ "from": "<key>", "to": "<key>" }` in `hints.renames`; renames are never inferred.

3. **Check replay safety:** `supaschema check` gates every `.sql` in the migrations directory (or name specific files) — must exit 0 for generated and hand-authored migrations alike.
4. **Regenerate contracts:** `supaschema types` refreshes TypeScript and Zod outputs from the configured schema source. Use generated Zod validators at runtime boundaries when `workflow.type_usage` is `zod_validated`.
5. **Stage generated migrations:** `supaschema stage` git-stages changed migration files containing the `-- supaschema: lineage` marker and leaves hand-authored SQL untouched.
6. **Apply pending migrations:** `supaschema apply` applies already-generated pending migrations through the configured runner without generating a new diff. Do not mutate a database unless config, target resolution, safety gates, and required runtime approval allow that target.
7. **Verify execution** (when any database is resolvable — URL precedence is `--database-url` (`$ENV` supported), named `config.environments` via global `--env`, `SUPASCHEMA_DATABASE_URL`, then the nearest `supabase/config.toml`):

   ```bash
   supaschema verify
   ```

   Defaults to the newest pending migration in the migrations directory with the same from/to defaults as `diff`; pass `--migration <file>` to verify a specific one.

   Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks (e.g. `authenticated`). Use `--ensure-environment` when a plain PostgreSQL verification server needs Supabase-provisioned surfaces. A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

8. **Commit** the tree change, generated migration, and generated outputs together. `sync` is the one-command workflow for schema changes; `diff`, `stage`, `apply`, `types`, and `check` remain focused lanes for explicit operation. Never wait for a deploy or run introspection-based typegen to get correct types.

## Operational Sync

`supaschema sync` is the canonical one-command workflow. It composes apply policy, source resolution, diff generation, target selection, migration-history reconciliation, replay-safety check, generated TypeScript/Zod refresh according to workflow policy, generated-migration staging when Git is available, deploy safety gates, disposable-database verification of the ordered pending migration set, selected runner apply, and final reconciliation or dry-run reporting. It refreshes generated contracts and runs the local stage lane even when no migration is pending. Use the explicit command lanes (`diff`, `check`, `types`, `stage`, `apply`) only when the user asks for a focused step. Bare `sync` may select one configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`; multiple automatic targets are refused because cross-target apply is not atomic. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply while allowing non-mutating sync lanes. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`.

## Drift Detection

```bash
supaschema diff --fail-on-diff --quiet
```

Exit 3 means the live database and the tree have diverged; exit 0 means parity. Use this as a CI gate and decode any blocking diagnostic with `supaschema explain <SUPA_CODE>`.

When drift is large or blocked, triage before editing:

- `supaschema diff --summary` — operation/diagnostic counts grouped by kind and schema, printed even when the plan is blocked.
- `supaschema diff --write-hints <file>` — writes the gated destructive object keys as a reviewable `hints.destructive` skeleton (no-clobber).
- `supaschema audit --from <source> [--json]` — modeled coverage by kind/schema plus every statement outside the contract grouped by diagnostic code.
- `supaschema selfcheck` — re-extracts a live catalog's rendered SQL and reports any object whose identity diverges (`SUPA_SELFCHECK_*`); zero mismatches proves cross-lane identity parity.
- `supaschema migrations` — classifies on-disk migrations against a target's applied history: applied, pending, ghost, or out-of-order.

## SQL Understanding

- Treat SQL semantics as an AST/model problem. For supaschema implementation work, classify, compare, or mutate DDL through PostgreSQL parse trees (`libpg-query`) and the structured model helpers, not ad hoc regular expressions.
- Regex is acceptable for outer transport concerns such as finding file markers, parsing hook payload headers, or redacting raw text, but not for deciding whether SQL is safe, equivalent, destructive, or replayable.
- Treat PostgreSQL support claims as executable contracts. If a docs page, skill, rule, or agent says an object or statement is supported, it must be wired through `src/sql/support.ts`, extraction, catalog extraction when live databases apply, planning, rendering, checking, audit reporting, and focused tests. If a boundary is unsupported, it must be listed in `unsupportedStatementSupport` so parser-backed diagnostics name the boundary.
- Deparser normalization is fidelity-gated. Known third-party `pgsql-deparser` gaps live in `src/sql/support.ts`; new `SUPA_CHECK_DEPARSE_*` or `SUPA_NORMALIZE_*` findings should be fixed by improving the model/render/deparser contract or documenting an actual unsupported boundary, not by editing generated migrations.
- Unsupported or ambiguous DDL fails closed with a `SUPA_*` diagnostic. Do not silently pass through statements the model cannot prove safe.

## Boundaries

- Sources for either side of a diff: `dir:<tree>`, `git:<ref>`, `database:<url|$ENV>`, `dump:<file.sql>`, `catalog:<snapshot.json>`.
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`), row backfills, enum rewrite recipes, Vault references, and workload-derived index intent are outside the declarative schema shape but not outside supaschema's source-intent contract. The planner must mine explicit intent from configured existing migrations or other reviewed project artifacts before blocking. If the runtime lane cannot yet model a case, validate the explicit migration with `check` and `verify`, decode blocking diagnostics with `supaschema explain <SUPA_CODE>`, and update the canonical source rather than editing a generated migration.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked in that mode and splits to a `.concurrent.sql` companion only under an explicit `transactionMode: "per-statement"` lane.
- Database URL resolution for CLI commands is flag (`$ENV` supported) > named `config.environments` via global `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`.
- `supaschema explain <SUPA_CODE>` decodes any diagnostic offline.
