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

This skill is a direct execution contract for producing schema migrations with supaschema. Follow the workflow in order; do not hand-author migration SQL for changes the declarative tree can express, and never edit a generated migration (the `-- supaschema: lineage` marker) by hand.

When the bundled PostToolUse hook is wired (`.claude/settings.json` / `.codex/hooks.json`) and `workflow.schema_diff` / `workflow.migration_check` keep their defaults, a write to a schema-tree `.sql` file auto-runs steps 2–3 — `diff` then `check <generated migration path...>` — and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as context. If `workflow.migration_sync` allows automatic sync, the hook first confirms every selected `sync.targets` entry is `mode: "auto"`, every database URL reference resolves, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync` for diff, generated outputs, type/RLS safety gates, apply, and target reconciliation. If the generated-migration `check` or `sync` fails, the hook emits loop-continuation feedback; inspect the diagnostic, identify the canonical root source in the declarative tree, config, or generated migration chain, search for similar or correlated migration failures, fix the canonical owner, and rerun the failing command. Read that context as the workflow result and act on any reported code.

## Installed Setup

The normal consumer setup is package install plus one explicit setup command through the consuming project's package manager. Default `supaschema init` writes only `supaschema.config.json`, configured schema directories, configured migration directories, and `.supaschema/install.json` when paths need confirmation. It does not write active `.agents`, `.claude`, `.codex`, `AGENTS.md`, or `CLAUDE.md` surfaces. The raw AI-agent bundle ships under `node_modules/supaschema/agent-bundle/`; read `agent-bundle/INSTALL.md` and install it only after the user asks for AI-agent enforcement or approves the bundle. Use `supaschema init --agent-bundle` only for that explicit opt-in path.

If this skill was installed through `npx skills`, treat it as portable workflow context only. Agent Skills installs `SKILL.md`-based folders into a user-selected skill location; it does not create `supaschema.config.json`, schema/migration directories, passive rule files, hook scripts, or hook registration. To install project enforcement surfaces, install the npm package with the consuming project's manager from the owning package directory, review `node_modules/supaschema/agent-bundle/INSTALL.md`, then install the raw bundle on demand.

Before the first schema edit, inspect `supaschema.config.json`. Normal resolved installs do not create `.supaschema/`; if `.supaschema/install.json` exists, treat it as pending path-confirmation state. If it says `"pathConfirmationNeeded": true`, inspect its candidate `schemaPaths` and `migrationsDirs`, ask the user which `schemaPaths`, `sources.to`, and `migrationsDir` to use, update `supaschema.config.json`, then run the workflow. Do not generate a migration from a guessed path; the bundled hooks also skip auto-diff until all three fields are explicit.

Use the configured `schemaPaths`, `sources`, and `migrationsDir` as the source of truth. Do not create a parallel schema tree, a second migrations directory, duplicate database credentials, or a new config unless the user explicitly asks to change project layout. Supabase installs use the Supabase CLI runner by default; other PostgreSQL installs reuse detected existing database URL environment variable names in `sync.targets` when present.

## Config Reference

Read `supaschema.config.json` before editing schemas. Treat these four decisions as the agent-facing source of truth:

- **Schema tree:** `schemaPaths`, `sources.to`, and `migrationsDir`. Edit only the configured schema roots; `dir:` sources read nested `.sql` files recursively and merge them into one model. `sources.to` is the explicit target for zero-source-flag `diff`, `plan`, and `verify`. Generated migrations write to `migrationsDir`.
- **Diff baseline:** `sources.from` and `sources.to`. Install writes `sources.from: "auto"` and `sources.to: "dir:<schemaPaths[0]>"`; examples or fixture projects can pin `dump:`, `dir:`, `git:`, `database:`, `catalog:`, or `empty:` values when that source is the project contract.
- **Generated contracts:** `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`. The default `create_or_refresh` policy creates or updates TypeScript and Zod outputs after `diff`; `zod_validated` means agents should use generated Zod validators at runtime boundaries.
- **Apply policy:** `workflow.migration_sync` and `sync.targets`. The default `migration_sync: "auto"` keeps bare `supaschema sync` apply-capable, but only targets with `mode: "auto"` are selected. Set a target to `manual` to omit it from bare sync, set `workflow.migration_sync` to `manual` to require `--target <name>`, or set it to `disabled` to block apply. Remote targets also require `requireApprovalEnv`.

Other config fields refine those decisions: `managedSchemas` blocks externally owned schemas, `transactionMode` mirrors the apply runner, `environments` optionally holds extra `$ENV_NAME` URL references, and `adapter: "auto"` is a provider-neutral sentinel rather than workflow consent.

## Workflow

1. **Edit the declarative tree** (`config.schemaPaths`) to express the desired end state. Typical roots are `database/schemas/**` for neutral PostgreSQL, `supabase/schemas/**` for Supabase, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**` for detected managed PostgreSQL providers. Use schema-qualified object names.
2. **Generate the migration:**

   ```bash
   supaschema diff
   ```

   Zero-source-flag defaults come from `config.sources` and are printed to stderr. `sources.from: "auto"` resolves to valid `git:HEAD`, then a database URL, then `empty:`; `sources.to` points at the configured declarative tree. The file lands in `config.migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` only when the human wants a specific file name. The write is no-clobber and chain-gated. If it exits 2, read the diagnostic:
   - `SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED` / `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` / `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` / `SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED` — review the rendered `-- BLOCKED` section, then add the exact object key to `hints.destructive` in `supaschema.config.json` and regenerate. Never use `"*"` in committed config.
   - `SUPA_DIFF_LINEAGE_BROKEN` — a pending generated migration exists; diff from the post-migration state instead: `--from database:<db with pending applied>`.
   - `SUPA_DIFF_LINEAGE_DUPLICATE` — the transition is already pending; apply or remove the pending migration instead of regenerating.
   - Renames: declare `{ "from": "<key>", "to": "<key>" }` in `hints.renames`; renames are never inferred.

3. **Check replay safety:** `supaschema check` gates every `.sql` in the migrations directory (or name specific files) — must exit 0 for generated and hand-authored migrations alike.
4. **Verify execution** (when any database is resolvable — URL precedence is `--database-url` (`$ENV` supported), named `config.environments` via global `--env`, `SUPASCHEMA_DATABASE_URL`, then the nearest `supabase/config.toml`):

   ```bash
   supaschema verify
   ```

   Defaults to the newest pending migration in the migrations directory with the same from/to defaults as `diff`; pass `--migration <file>` to verify a specific one.

   Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks (e.g. `authenticated`). Use `--ensure-environment` when a plain PostgreSQL verification server needs Supabase-provisioned surfaces. A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

5. **Commit** the tree change, the generated migration, and refreshed generated outputs together. The diff/check/verify workflow never stages changes; apply happens only through configured `supaschema sync` target selection or an explicit user-approved target override. TypeScript and Zod outputs come from the tree (`diff` creates or refreshes `database.types.ts` / `database.zod.ts` by default). When `workflow.type_usage` is `zod_validated`, use generated Zod validators for runtime parsing/validation instead of hand-authored database-shape validators — never wait for a deploy or run introspection-based typegen to get correct types.

## Operational Sync

`supaschema sync` is the operational apply path, not the default generation workflow. Bare `sync` selects every configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply. `--target <name>` is the only public override path; do not use removed local/remote aliases. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`. Do not mutate a database unless config, target resolution, safety gates, and required runtime approval allow that specific target.

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
- Unsupported or ambiguous DDL fails closed with a `SUPA_*` diagnostic. Do not silently pass through statements the model cannot prove safe.

## Boundaries

- Sources for either side of a diff: `dir:<tree>`, `git:<ref>`, `database:<url|$ENV>`, `dump:<file.sql>`, `catalog:<snapshot.json>`.
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`) and enum reordering/removal are hand-authored migrations — validate them with `check` and `verify`; decode blocking diagnostics with `supaschema explain <SUPA_CODE>`.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked in that mode and splits to a `.concurrent.sql` companion only under an explicit `transactionMode: "per-statement"` lane.
- Database URL resolution for CLI commands is flag (`$ENV` supported) > named `config.environments` via global `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`.
- `supaschema explain <SUPA_CODE>` decodes any diagnostic offline.
