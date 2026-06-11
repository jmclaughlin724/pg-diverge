---
name: pg-diverge
description: Generate, check, and verify replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs with pg-diverge. Use when schema changes are requested, migrations must be created or validated, schema drift needs detection, or a pg-diverge diagnostic (PD_*) blocks a plan.
---

# pg-diverge Migration Workflow

## Contract

This skill is a direct execution contract for producing schema migrations with pg-diverge. Follow the workflow in order; do not hand-author migration SQL for changes the declarative tree can express, and never edit a generated migration (the `-- pg-diverge: lineage` marker) by hand.

## Workflow

1. **Edit the declarative tree** (`supabase/schemas/**` or the project's configured tree) to express the desired end state. Use schema-qualified object names.
2. **Generate the migration:**

   ```bash
   pg-diverge diff --from git:HEAD --to dir:supabase/schemas \
     --name <snake_case_change> --migrations-dir supabase/migrations
   ```

   The write is no-clobber and chain-gated. If it exits 2, read the diagnostic:
   - `PD_PLAN_DESTRUCTIVE_HINT_REQUIRED` / `PD_PLAN_COLUMN_ALTER_HINT_REQUIRED` / `PD_PLAN_VIEW_REPLACE_INCOMPATIBLE` / `PD_PLAN_ROUTINE_RETURN_TYPE_CHANGED` — review the rendered `-- BLOCKED` section, then add the exact object key to `hints.destructive` in `pg-diverge.config.json` and regenerate. Never use `"*"` in committed config.
   - `PD_DIFF_LINEAGE_BROKEN` — a pending generated migration exists; diff from the post-migration state instead: `--from database:<db with pending applied>`.
   - `PD_DIFF_LINEAGE_DUPLICATE` — the transition is already pending; apply or remove the pending migration instead of regenerating.
   - Renames: declare `{ "from": "<key>", "to": "<key>" }` in `hints.renames`; renames are never inferred.

3. **Check replay safety:** `pg-diverge check <migration.sql>` — must exit 0 for generated and hand-authored migrations alike.
4. **Verify execution** (when any database is resolvable — the URL auto-resolves from `PG_DIVERGE_DATABASE_URL` or the nearest `supabase/config.toml`):

   ```bash
   pg-diverge verify --from git:HEAD --to dir:supabase/schemas --migration <migration.sql>
   ```

   Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks (e.g. `authenticated`). A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

5. **Commit** the tree change and the generated migration together. pg-diverge never stages or applies; the migration runner (e.g. `supabase db push`) owns the database.

## Drift Detection

```bash
pg-diverge diff --from "database:$DATABASE_URL" --to dir:supabase/schemas --fail-on-diff --quiet
```

Exit 3 means the live database and the tree have diverged; exit 0 means parity. Use this as a CI gate (`docs/ci.md` has the full pipeline recipe).

## Boundaries

- Sources for either side of a diff: `dir:<tree>`, `git:<ref>`, `database:<url|$ENV>`, `dump:<file.sql>`, `catalog:<snapshot.json>`.
- Data statements (`INSERT`/`UPDATE`/`DELETE`/`DO`) and enum reordering/removal are hand-authored migrations — validate them with `check` and `verify`; the enum recipe is in `docs/hints.md`.
- Keep `transactionMode: "per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked under `supabase-auto` and splits to a `.concurrent.sql` companion under `adapter: "postgres"`.
- `pg-diverge explain <PD_CODE>` decodes any diagnostic offline.
