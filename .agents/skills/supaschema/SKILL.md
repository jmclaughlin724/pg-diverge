---
name: supaschema
description: Generate, check, and verify replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs with supaschema. Use when schema changes are requested, migrations must be created or validated, schema drift needs detection, or a supaschema diagnostic (SUPA_*) blocks a plan.
---

# supaschema Migration Workflow

## Contract

This skill is a direct execution contract for producing schema migrations with supaschema. Follow the workflow in order; do not hand-author migration SQL for changes the declarative tree can express, and never edit a generated migration (the `-- supaschema: lineage` marker) by hand.

When the bundled PostToolUse hook is wired (`.claude/settings.json` / `.codex/hooks.json`) and `workflow.schema_diff` / `workflow.migration_check` keep their defaults, a write to a schema-tree `.sql` file auto-runs steps 2–3 — `diff` then `check` — and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as context. If `check` fails, the hook emits loop-continuation feedback; inspect the diagnostic, identify the canonical root source in the declarative tree or generated migration chain, search for similar or correlated migration failures, fix the canonical owner, regenerate when the tree changes, and rerun `supaschema check`. Read that context as the diff result and act on any reported code. The commands below are the same workflow for CI, hand runs, `verify`, and any step the hook reports as blocked; the hook never applies to a database.

## Installed Setup

The normal consumer setup is one package install with the consuming project's package manager. Read `.agents/prompts/supaschema-install.md` before installing, initializing, inspecting, or explaining setup. That prompt owns package-manager detection, workspace targeting, local runner commands, lifecycle-script recovery, and wrong-manager stop conditions. Treat `supaschema.config.json`, installed schema/migration directories, Claude/Codex rule and skill files, hook wiring, and tagged `AGENTS.md` / `CLAUDE.md` addenda as the package-owned setup surface. The package scaffold installs the full supaschema skill directories directly into `.agents/skills/supaschema` and `.claude/skills/supaschema`; it does not invoke `npx skills`.

If this skill was installed through `npx skills`, treat it as portable workflow context only. Agent Skills installs `SKILL.md`-based folders into a user-selected skill location; it does not create `supaschema.config.json`, schema/migration directories, passive rule files, hook scripts, or hook registration. To install those project enforcement surfaces, install the npm package with the consuming project's manager from the owning package directory. If the package is already present but lifecycle scripts did not run, run `supaschema init` through the same manager's local runner from that directory. The package scaffold installs the rule and hooks; the `npx skills` lane does not.

Before the first schema edit, inspect `supaschema.config.json`. Normal resolved installs do not create `.supaschema/`; if `.supaschema/install.json` exists, treat it as pending path-confirmation state. If it says `"pathConfirmationNeeded": true`, inspect its candidate `schemaPaths` and `migrationsDirs`, ask the user which `schemaPaths`, `sources.to`, and `migrationsDir` to use, update `supaschema.config.json`, then run the workflow. Do not generate a migration from a guessed path; the bundled hooks also skip auto-diff until all three fields are explicit.

Use the configured `schemaPaths`, `sources`, and `migrationsDir` as the source of truth. Do not create a parallel schema tree, a second migrations directory, or a new config unless the user explicitly asks to change project layout.

## Config Reference

Read `supaschema.config.json` before editing schemas. These keys are the agent-facing source of truth:

- `adapter`: `auto` is the provider-neutral adapter sentinel. It is not a Supabase switch and does not grant workflow consent.
- `workflow`: agent/hook automation policy. `schema_diff: "on_schema_write"` runs hook diff after schema SQL writes; `migration_check: "after_schema_diff"` runs hook check after generated migrations; `migration_verify: "suggest_after_check"` tells agents to suggest verify when a database is reachable; `migration_sync: "explicit_request_only"` allows sync apply handoff only when explicitly invoked; `type_generation: "create_or_refresh"` and `zod_generation: "create_or_refresh"` create or update generated outputs after `diff`; `type_usage: "zod_validated"` means use generated Zod validators for runtime boundaries and derived validated types.
- `schemaPaths`: declarative SQL roots to edit and parse. Typical install-selected roots are `database/schemas`, `supabase/schemas`, `neon/schemas`, `aws-postgresql/schemas`, `cloud-sql/schemas`, `alloydb/schemas`, or `azure-postgresql/schemas`.
- `sources`: default before/after sources for zero-source-flag `diff`, `plan`, and `verify`. Install writes `sources.from: "auto"` and `sources.to: "dir:<schemaPaths[0]>"`; examples or fixture projects can pin `dump:`, `dir:`, `git:`, `database:`, `catalog:`, or `empty:` values when that source is the project contract.
- `migrationsDir`: where generated migrations are written and where zero-arg `check` / `verify` look for pending migrations.
- `typesFile` and `zodFile`: generated TypeScript and Zod output paths. `diff` follows `workflow.type_generation` and `workflow.zod_generation`; the default `create_or_refresh` policy creates missing outputs and updates existing outputs.
- `managedSchemas`: externally owned schemas that the declarative tree cannot claim. Generic PostgreSQL installs use `[]`; Supabase installs seed the common Supabase-provisioned schemas.
- `transactionMode`: runner behavior. Use `per-migration` for transactional runners; use `per-statement` only for explicit out-of-transaction operational lanes.
- `environments`: named database URL references for `--env`; use `$ENV_NAME` indirection and never commit credentials.

## Workflow

1. **Edit the declarative tree** (`config.schemaPaths`) to express the desired end state. Typical roots are `database/schemas/**` for neutral PostgreSQL, `supabase/schemas/**` for Supabase, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**` for detected managed PostgreSQL providers. Use schema-qualified object names.
2. **Generate the migration:**

   ```bash
   supaschema diff
   ```

   Zero-source-flag defaults come from `config.sources` and are printed to stderr. `sources.from: "auto"` resolves to the database, then valid `git:HEAD`, then `empty:`; `sources.to` points at the configured declarative tree. The file lands in `config.migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` only when the human wants a specific file name. The write is no-clobber and chain-gated. If it exits 2, read the diagnostic:
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

5. **Commit** the tree change, the generated migration, and refreshed generated outputs together. The diff/check/verify workflow never stages or applies; the migration runner (e.g. `supabase db push`) owns the database. TypeScript and Zod outputs come from the tree (`diff` creates or refreshes `database.types.ts` / `database.zod.ts` by default). When `workflow.type_usage` is `zod_validated`, use generated Zod validators for runtime parsing/validation instead of hand-authored database-shape validators — never wait for a deploy or run introspection-based typegen to get correct types.

## Operational Sync

`supaschema sync` is the optional apply gate, not the default generation workflow. With no `--local` or `--remote` flag it is a dry run that reconciles migration status and checks pending files. With `--local` or `--remote`, it runs the same gates and then delegates the actual apply/deploy to the Supabase CLI only when `workflow.migration_sync` is `explicit_request_only`. Do not run apply flags unless the human explicitly requested that operational action.

## Drift Detection

```bash
supaschema diff --fail-on-diff --quiet
```

Exit 3 means the live database and the tree have diverged; exit 0 means parity. Use this as a CI gate (`docs/guides/ci-github-actions.md` has the full pipeline recipe).

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
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`) and enum reordering/removal are hand-authored migrations — validate them with `check` and `verify`; the enum recipe is in `docs/configuration/hints.md`.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked in that mode and splits to a `.concurrent.sql` companion only under an explicit `transactionMode: "per-statement"` lane.
- Database URL resolution for CLI commands is flag (`$ENV` supported) > named `config.environments` via global `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`.
- `supaschema explain <SUPA_CODE>` decodes any diagnostic offline.
