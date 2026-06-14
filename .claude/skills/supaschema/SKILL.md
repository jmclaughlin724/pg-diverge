---
name: supaschema
description: Generate, check, and verify replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs with supaschema. Use when schema changes are requested, migrations must be created or validated, schema drift needs detection, or a supaschema diagnostic (SUPA_*) blocks a plan.
---

# supaschema Migration Workflow

## Contract

This skill is a direct execution contract for producing schema migrations with supaschema. Follow the workflow in order; do not hand-author migration SQL for changes the declarative tree can express, and never edit a generated migration (the `-- supaschema: lineage` marker) by hand.

When the bundled PostToolUse hook is wired (`.claude/settings.json` / `.codex/hooks.json`), a write to a schema-tree `.sql` file auto-runs steps 2–3 — `diff` then `check` — and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as context. Read that context as the diff result and act on any reported code. The commands below are the same workflow for CI, hand runs, `verify`, and any step the hook reports as blocked; the hook never applies to a database.

## Workflow

1. **Edit the declarative tree** (`supabase/schemas/**` or the project's configured tree) to express the desired end state. Use schema-qualified object names.
2. **Generate the migration:**

   ```bash
   supaschema diff
   ```

   Zero-flag defaults (printed to stderr; flags override): `--from` resolves to the database (then `git:HEAD`), `--to` to the config schema tree, and the file lands in `config.migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` to control the name. The write is no-clobber and chain-gated. If it exits 2, read the diagnostic:
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

   Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks (e.g. `authenticated`). Use `--ensure-environment` when a plain PostgreSQL verification server needs Supabase-provisioned surfaces; it is the default under `adapter: "supabase-auto"`. A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

5. **Commit** the tree change, the generated migration, and the refreshed types file together. The diff/check/verify workflow never stages or applies; the migration runner (e.g. `supabase db push`) owns the database. TypeScript types come from the tree (`supaschema types` creates `database.types.ts`; every later `diff` refreshes it) — never wait for a deploy or run introspection-based typegen to get correct types.

## Operational Sync

`supaschema sync` is the optional apply gate, not the default generation workflow. With no `--local` or `--remote` flag it is a dry run that reconciles migration status and checks pending files. With `--local` or `--remote`, it runs the same gates and then delegates the actual apply/deploy to the Supabase CLI. Do not run apply flags unless the human explicitly requested that operational action.

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

## Boundaries

- Sources for either side of a diff: `dir:<tree>`, `git:<ref>`, `database:<url|$ENV>`, `dump:<file.sql>`, `catalog:<snapshot.json>`.
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`) and enum reordering/removal are hand-authored migrations — validate them with `check` and `verify`; the enum recipe is in `docs/configuration/hints.md`.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked under `supabase-auto` and splits to a `.concurrent.sql` companion under `adapter: "postgres"`.
- Database URL resolution for CLI commands is flag (`$ENV` supported) > named `config.environments` via global `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`.
- `supaschema explain <SUPA_CODE>` decodes any diagnostic offline.
