---
description: Generated-migration ownership and pg-diverge workflow policy for schema changes.
---

# pg-diverge Migration Policy

## Contract

This rule owns how schema migrations are produced and protected in a repo that uses pg-diverge: migrations are generated from the declarative tree, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. The repeatable command workflow lives in the `pg-diverge` skill; write-time enforcement is hook-owned.

## Rules

- Schema intent changes only in the declarative SQL tree (e.g. `supabase/schemas/**`). Render the migration with `pg-diverge diff`; do not hand-author migration SQL for changes the tree can express.
- Any `.sql` file containing the `-- pg-diverge: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks such edits in both Claude and Codex runtimes.
- Never overwrite a migration file. pg-diverge writes no-clobber (`PD_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `PD_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `PD_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `pg-diverge check` on every generated or hand-authored migration. Run `pg-diverge verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked under `adapter: "supabase-auto"`; under `adapter: "postgres"` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- Database URLs resolve flag (`$ENV` indirection supported) > `PG_DIVERGE_DATABASE_URL` > nearest `supabase/config.toml`. Do not hard-code connection strings in scripts, config, or CI.
- Decode any `PD_*` diagnostic with `pg-diverge explain <CODE>`; recovery procedures live in `docs/hints.md`.
