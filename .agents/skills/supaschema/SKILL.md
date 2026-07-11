---
name: supaschema
description: Supaschema CLI reference for declarative SQL diffs, generated migrations, replay checks, generated contracts, and SUPA_* diagnostics. Use this skill for tool semantics; migration workflow policy lives in the bundled supaschema rule.
metadata:
  keywords:
    - supaschema
    - schema migration
    - database migration
    - declarative SQL
    - migration drift
    - SUPA diagnostic
---

# supaschema CLI Reference

## Contract

This skill explains supaschema behavior. Use it to decode CLI commands and diagnostics, not as workflow authority. Migration policy, ordering, ownership, and stop conditions live in the bundled supaschema rule.

For source-kind and introspection boundaries, read `docs/concepts/sources.mdx` first, then the owner briefs in `src/AGENTS.md`, `src/source/AGENTS.md`, and `src/typegen/AGENTS.md`.

When the bundled PostToolUse hook is wired (`.claude/settings.json` / `.codex/hooks.json`) and `workflow.schema_diff` / `workflow.migration_check` keep their defaults, a write to a schema-tree `.sql` file auto-runs `diff` then `check <generated migration path...>` and returns the generated migration name or blocking `SUPA_*` diagnostic. If `workflow.migration_sync` allows automatic sync, the hook first confirms exactly one `sync.targets` entry is selected with `mode: "auto"`, its database URL reference resolves when its runner needs one, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync` for the full source, diff, target-selection, history, check, generated-contract, schema-closure staging, source safety, runner, and reconciliation workflow. If `check` or `sync` fails, inspect the diagnostic, fix the canonical source, and rerun the failing command.

## Installed Setup

The normal consumer setup is package install plus one explicit setup command through the consuming project's package manager. Default `supaschema init` writes or repairs `supaschema.config.json`, configured schema directories, configured migration directories, safe focused package scripts when `package.json` exists (`supaschema:diff`, `supaschema:stage`, `supaschema:types`, and `supaschema:check`), package-owned active AI enforcement under `.agents`, `.claude`, and `.codex`, and `.supaschema/install.json` only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories. It copies missing package-bundled prompt/rule/skill/hook files, merges the package-manager-specific `.claude/settings.json` and `.codex/hooks.json` entries, preserves existing non-identical files, and reports skipped non-mergeable hook config so the agent can repair the gap. Supabase projects whose owner brief marks `supabase/schemas/**` as inventory, or whose schema tree contains `_bootstrap`, still get a working config with `workflow.schema_diff` and `workflow.migration_sync` set to `manual`, Supabase-managed schemas seeded into `schemas.exclude`, and `_bootstrap` directories skipped by schema-source readers. It does not write `AGENTS.md`, `CLAUDE.md`, backup directories, maintainer tooling, or apply-capable package scripts. Use direct CLI commands for setup diagnostics, full sync/apply, and database execution verification: `supaschema config validate`, `supaschema sync`, `supaschema apply`, and `supaschema verify`.

If this skill was installed through `npx skills`, treat it as portable workflow context only. Agent Skills installs `SKILL.md`-based folders into a user-selected skill location; it does not create `supaschema.config.json`, schema/migration directories, passive rule files, hook scripts, or hook registration. To install project enforcement surfaces, install the npm package with the consuming project's manager from the owning package directory, then run `supaschema init`; the npm package installer is the activation path for the bundled `.agents`, `.claude`, and `.codex` enforcement files.

Before the first schema edit, check `.supaschema/install.json` first. Normal resolved installs do not create `.supaschema/`; if the manifest exists and says `"pathConfirmationNeeded": true`, treat it as an agent handoff, inspect `agentInstructions`, choose from candidate `schemaPaths` and `migrationsDirs`, then create or update `supaschema.config.json` with explicit `schemaPaths` and `migrationsDir` before running validation or workflow commands. If no pending manifest exists, inspect `supaschema.config.json` directly. Do not generate a migration from a guessed path; the bundled hooks also skip auto-diff until both fields are explicit.

Use the configured `schemaPaths`, `sources`, and `migrationsDir` as the source of truth. Do not create a parallel schema tree, a second migrations directory, duplicate database credentials, or a new config unless the user explicitly asks to change project layout. Supabase installs use the Supabase CLI runner by default; other PostgreSQL installs reuse detected existing database URL environment variable names in `sync.targets` when present.

Before saying supaschema cannot model a migration, inspect all three configured sources:

- `schemaPaths` for the declarative end-state;
- `sources.from` for the before-state baseline;
- `migrationsDir` for existing migration source intent and generated-lineage baseline proof.

Existing migrations are not only history. They are the source-intent corpus for operational facts the schema tree cannot express by shape alone, including row backfills, explicit DML/`DO` workflows, enum rewrite recipes, Vault references or placeholder names, workload-proven index intent, reviewed routine drops, and provider bootstrap constraints. Generated migration lineage in that directory is also the migration-tree baseline proof that a `git:` before-state must match. Preserve explicit intent from those files through the planner and replay-safety check lane. Never invent missing row values, Vault secret material, tenant predicates, conversion expressions, or workload indexes; when the corpus lacks the fact, produce or follow the diagnostic/agent instruction that names the canonical file, config, hint, or workload artifact that must declare it.

## Config Reference

Read `supaschema.config.json` before editing schemas. Treat these four decisions as the agent-facing source of truth:

- **Schema tree:** `schemaPaths` and `migrationsDir`. Edit only the configured schema roots; nested `.sql` files are merged into one model, and zero-source-flag `diff`, `plan`, and `verify` target `dir:<schemaPaths[0]>`. Pass `--to` for an explicit alternate target. Generated migrations write to `migrationsDir`; existing generated lineage there proves the migration-tree baseline.
- **Diff baseline:** `sources.from` owns the before-state and `schemaPaths` owns the after-state. Install writes `sources.from: "auto"`; for generation, `auto` resolves a proven staged closure as `git:INDEX` before trying `git:HEAD`, and the chosen snapshot must match generated migration lineage when migrations exist. Use explicit `--from` or `--to` for source-backed `dump:`, `dir:`, `git:`, `catalog:`, `empty:`, or `database:` inputs outside those configured defaults.
- **Generated contracts:** `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`. `supaschema types` creates or refreshes TypeScript and Zod outputs from the configured schema source, including schema-defined views, materialized views, view-on-view dependencies, functions, enums, and composites; `zod_validated` means agents should use generated Zod validators at runtime boundaries. If a view depends on an extension-owned relation outside the configured schema source, fix the supported source/model instead of patching application consumers with casts, aliases, or local contract copies. If a modeled relation, function, extension, or expression should resolve but remains `unknown`, fix that owner; unsupported PostgreSQL scalars that upstream maps to `unknown` are intentional and must not gain local mappings. Do not commit app-side casts, copied contracts, or local DTOs to hide missing model coverage.
- **Apply policy:** `workflow.migration_sync` and `sync.targets`. The default `migration_sync: "auto"` keeps bare `supaschema sync` apply-capable for one target with `mode: "auto"`. Set a target to `manual` to omit it from bare sync, set `workflow.migration_sync` to `manual` to require `--target <name>`, or set it to `disabled` to block apply. Multiple automatic targets are refused because cross-target apply is not atomic. Remote targets also require `requireApprovalEnv`.

Other config fields refine those decisions: `managedSchemas` blocks externally owned schemas, Supabase installs mirror those names into `schemas.exclude`, `transactionMode` mirrors the apply runner, `environments` optionally holds extra `$ENV_NAME` URL references, and `adapter: "auto"` is a provider-neutral sentinel rather than workflow consent.

## Workflow

This sequence documents CLI shape only. Follow the bundled supaschema rule for workflow policy.

1. **Edit the declarative tree** (`config.schemaPaths`) to express the desired end state. Typical roots are `database/schemas/**` for neutral PostgreSQL, `supabase/schemas/**` for Supabase, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**` for detected managed PostgreSQL providers. Use schema-qualified object names. When a change depends on data movement, secret placeholders, or workload-derived indexes, confirm the intent already exists in the configured migration corpus, config, hint, or workload artifact before generating.
2. **Generate the migration:**

   ```bash
   supaschema diff
   ```

   Zero-source-flag defaults use `sources.from` and `dir:<schemaPaths[0]>` and are printed to stderr. For generation, `sources.from: "auto"` resolves a staged migration/schema closure to `git:INDEX` when its lineage fingerprint matches the index, then valid `git:HEAD` as a candidate source snapshot, then `empty:` only for a first migration with no existing migration corpus; existing migrations without a Git baseline produce `SUPA_SOURCE_BASELINE_REQUIRED`, and generated migration lineage mismatches produce `SUPA_MIGRATION_BASELINE_MISMATCH` / `SUPA_MIGRATION_BASELINE_UNSUPPORTED`. The file lands in `config.migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` only when the human wants a specific file name. The write is no-clobber and chain-gated; named/file-output empty plans fail with `SUPA_DIFF_EMPTY_PLAN`. If it exits 2, read the diagnostic:
   - `SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED` / `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` / `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` / `SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED` — review the rendered `-- BLOCKED` section, then add the exact object key to `hints.destructive` in `supaschema.config.json` and regenerate. Never use `"*"` in committed config. Rendered `-- supaschema: operation ...` comments disclose destructive or drop-guard intent; disclosure is not a second blocker once the planner has allowed the operation.
   - `SUPA_ROUTINE_DEPENDENCY_PROOF_REQUIRED` / `SUPA_PLAN_COLUMN_DEPENDENT_REWRITE_REQUIRED` — do not guess around routine bodies or column dependents. Rewrite the dependent routine/view/policy/trigger so dependencies are structurally extractable or it no longer references the changed column, split the migration, or use a reviewed explicit migration.
   - `SUPA_PLAN_DATA_TRANSITION_REQUIRED` — do not treat a destructive hint as backfill intent. Add reviewed DML or a `DO` transition to the migration corpus, or use a reviewed explicit migration that `supaschema check` and `supaschema verify` can validate.
   - `SUPA_DIFF_LINEAGE_BROKEN` — a pending generated migration exists; resolve a source-backed post-migration baseline such as `git:<ref>`, `dir:<path>`, `dump:<file>`, `catalog:<snapshot>`, or reviewed `empty:`.
   - `SUPA_DIFF_LINEAGE_DUPLICATE` — the transition is already pending; apply or remove the pending migration instead of regenerating.
   - `SUPA_DIFF_REPLACE_*` — `diff --replace` is only for a generated migration inside `migrationsDir` whose original lineage baseline matches the planned `--from`; if a configured target records the version as applied, create a forward migration instead.
   - `SUPA_DIFF_GENERATED_CONTRACT_DIRTY` / `SUPA_DIFF_MIGRATIONS_DIRTY` — generated contracts or migration files contain unstaged changes beyond a proven `git:INDEX` closure, or are dirty against another Git baseline. Repair or close that migration unit before running another diff.
   - `SUPA_DIFF_CONFIG_DIRTY` / `SUPA_DIFF_SCOPED_DIRTY_SCHEMA` — a scoped `--schema` diff cannot own dirty global config or dirty schema files outside the requested schema filter. Close the owning migration unit or use an unscoped diff that owns the config/schema change.
   - `SUPA_MIGRATION_BASELINE_FORMAT_DRIFT` — review the generated SQL normally; the previous generated lineage came from an older model format, so old and current fingerprints are not directly comparable. Do not add hints, bypass the chain gate, or edit generated migrations to silence it. The next generated migration writes versioned lineage and re-establishes comparable chain proof.
   - `SUPA_MIGRATIONS_STALE_BASELINE` — when no configured target records the pending generated version as applied, review the SQL and remove it through `supaschema migrations --prune-stale` with a resolved target, or `--force` only after explicit review. Do not hand-delete lineage migrations as a routine recovery path.
   - Renames: declare `{ "from": "<key>", "to": "<key>" }` in `hints.renames`; renames are never inferred.

3. **Check replay safety:** `supaschema check` gates every `.sql` in the migrations directory (or name specific files) — must exit 0 for generated and hand-authored migrations alike. Use `--changed`, `--staged`, `--base <ref>`, or `--since <ref>` only when a workflow intentionally wants a git-selected subset under `config.migrationsDir`; scaffolded `supaschema:check` remains the full-directory lane. It checks statement replay safety plus same-file forward references, `SECURITY DEFINER` search paths, and public-schema function `EXECUTE` exposure.
4. **Regenerate contracts:** `supaschema types` refreshes TypeScript and Zod outputs from the configured schema source, including views and materialized views declared in that source. Investigate `unknown` when modeled relation, function, extension, or expression facts should resolve; preserve upstream's intentional `unknown` fallback for unsupported PostgreSQL scalars. Use generated Zod validators at runtime boundaries when `workflow.type_usage` is `zod_validated`.
5. **Stage generated migrations:** `supaschema stage` git-stages changed migration files containing the `-- supaschema: lineage` marker and leaves other files untouched.
6. **Apply pending migrations:** `supaschema apply` applies already-generated pending migrations through the configured runner without generating a new diff. When a selected Supabase CLI target has no resolved database URL, the CLI owns historical pending selection; supaschema replay-checks generated lineage files only instead of treating every disk migration as pending. Do not mutate a database unless config, target resolution, safety gates, and required runtime approval allow that target.
7. **Verify execution** (when any database is resolvable — URL precedence is `--database-url` (`$ENV` supported), named `config.environments` via global `--env`, `SUPASCHEMA_DATABASE_URL`, then the nearest `supabase/config.toml`):

   ```bash
   supaschema verify
   ```

   Defaults to the newest pending migration in the migrations directory with the same from/to defaults as `diff`; pass `--migration <file>` to verify a specific one.

   Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks (e.g. `authenticated`). Use `--ensure-environment` when a plain PostgreSQL verification server needs Supabase-provisioned surfaces. A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

8. **Commit before handoff or merge** with the tree changes, generated migrations, and generated outputs together. `sync` stages each complete closure, so several forward schema edits may be generated and applied without an intermediate commit. `sync` is the one-command workflow for schema changes; `diff`, `stage`, `apply`, `types`, and `check` remain focused lanes for explicit operation. Never wait for a deploy or run introspection-based typegen to get correct types.

## Operational Sync

`supaschema sync` is the canonical one-command workflow. It composes apply policy, target selection, pre-generation migration-history reconciliation, source resolution, diff generation, refreshed history, replay-safety check, generated TypeScript/Zod refresh according to workflow policy, schema closure staging when Git is available, source-model deploy safety gates, selected runner apply, and final reconciliation or dry-run reporting. It refreshes generated contracts and runs the schema-closure staging lane even when no migration is pending. Target-history pending files are checked before runner handoff when a database URL is resolved. When a selected Supabase CLI target has no resolved database URL, the CLI owns historical pending selection; supaschema replay-checks generated lineage files only and must not treat every disk migration as pending. Use the explicit command lanes (`diff`, `check`, `types`, `stage`, `apply`) only when the user asks for a focused step. Bare `sync` may select one configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`; multiple automatic targets are refused because cross-target apply is not atomic. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply while allowing non-mutating sync lanes. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`.

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
- Routine dependency proof is model-owned. SQL-standard bodies, SQL string bodies, and static PL/pgSQL statements feed relation/column dependencies into planning and `check`; dynamic SQL, partial PL/pgSQL, and unsupported languages fail closed when relation/type changes are in the same plan unless the routine is rewritten or the change is moved to a reviewed explicit migration.
- Treat PostgreSQL support claims as executable contracts. If a docs page, skill, rule, or agent says an object or statement is supported, it must be wired through `src/sql/support.ts`, extraction, catalog extraction when live databases apply, planning, rendering, checking, audit reporting, and focused tests. If a boundary is unsupported, it must be listed in `unsupportedStatementSupport` so parser-backed diagnostics name the boundary.
- Deparser normalization is fidelity-gated. Known third-party `pgsql-deparser` gaps live in `src/sql/support.ts`; new `SUPA_CHECK_DEPARSE_*` or `SUPA_NORMALIZE_*` findings should be fixed by improving the model/render/deparser contract or documenting an actual unsupported boundary, not by editing generated migrations.
- Unsupported or ambiguous DDL fails closed with a `SUPA_*` diagnostic. Do not silently pass through statements the model cannot prove safe.

## Boundaries

- Sources for either side of a diff: `dir:<tree>`, `git:<ref>`, `database:<url|$ENV>`, `dump:<file.sql>`, `catalog:<snapshot.json>`.
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`), row backfills, enum rewrite recipes, Vault references, and workload-derived index intent are outside the declarative schema shape but not outside supaschema's source-intent contract. The planner must mine explicit intent from configured existing migrations or other reviewed project artifacts before blocking. If the runtime lane cannot yet model a case, validate the explicit migration with `check` and `verify`, decode blocking diagnostics with `supaschema explain <SUPA_CODE>`, and update the canonical source rather than editing a generated migration.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked in that mode and splits to a `.concurrent.sql` companion only under an explicit `transactionMode: "per-statement"` lane.
- Database URL resolution for CLI commands is flag (`$ENV` supported) > named `config.environments` via global `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`.
- `supaschema explain <SUPA_CODE>` decodes any diagnostic offline.
