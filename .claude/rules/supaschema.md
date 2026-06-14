---
description: Generated-migration ownership and supaschema workflow policy for schema changes.
---

# supaschema Migration Policy

## Contract

This rule owns how schema migrations are produced and protected in a repo that uses supaschema: migrations are generated from the declarative tree, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. The repeatable command workflow lives in the `supaschema` skill; write-time enforcement is hook-owned.

## Rules

- Schema intent changes only in the declarative SQL tree (e.g. `supabase/schemas/**`). Render the migration with `supaschema diff`; do not hand-author migration SQL for changes the tree can express.
- Any `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks such edits in both Claude and Codex runtimes.
- When the bundled PostToolUse hook is wired, a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check` and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as agent context. Treat that context as the authoritative diff result, resolve any reported `SUPA_*` code before continuing, and do not re-run the diff by hand to "confirm" a clean result. The hook generates and proves; it never applies to a database.
- Never overwrite a migration file. supaschema writes no-clobber (`SUPA_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `SUPA_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `SUPA_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `supaschema check` on every generated or hand-authored migration. Run `supaschema verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked under `adapter: "supabase-auto"`; under `adapter: "postgres"` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- `supaschema sync` is an explicit operational handoff. With no apply flag it is a dry run; with `--local` or `--remote` it runs migration status and replay-safety gates, then delegates the actual apply/deploy to the Supabase CLI. Agents must not use apply flags without an explicit human request.
- Database URLs resolve flag (`$ENV` indirection supported) > named `config.environments` entry via `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`. Do not hard-code connection strings in scripts, config, or CI.
- Decode any `SUPA_*` diagnostic with `supaschema explain <CODE>`; recovery procedures live in `docs/configuration/hints.md`.
