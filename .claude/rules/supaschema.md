---
description: Generated-migration ownership and supaschema workflow policy for schema changes.
---

# supaschema Migration Policy

## Contract

This rule owns how schema migrations are produced and protected in a repo that uses supaschema: migrations are generated from the declarative tree, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. The repeatable command workflow lives in the `supaschema` skill; write-time enforcement is hook-owned.

## Rules

- Consumer setup is one package install. The installed config, schema/migration directories, rule files, skill files, hook scripts, hook wiring, and tagged `AGENTS.md` / `CLAUDE.md` addendum are part of the package surface. `supaschema init` is a recovery/recreate command, not a required second setup step.
- If `.supaschema/install.json` records `"pathConfirmationNeeded": true`, inspect the detected candidates, ask the user which `schemaPaths` and `migrationsDir` to use, and update `supaschema.config.json` before the first diff. Do not generate from the installer's guessed first candidate; the PostToolUse hook must skip auto-diff until confirmation is resolved.
- Schema intent changes only in the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`), such as `database/schemas/**`, `supabase/schemas/**`, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**`. Render the migration with `supaschema diff`; do not hand-author migration SQL for changes the tree can express.
- SQL understanding is AST/model-owned. Classify, compare, or mutate DDL through PostgreSQL parse trees (`libpg-query`) and structured model helpers, not ad hoc regex. Regex is acceptable for outer transport concerns such as hook patch headers, file markers, or redaction, not SQL semantics.
- Any `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks direct edits, patch updates, move-target rewrites, and delete/add rewrites in both Claude and Codex runtimes. Deleting a stale generated migration is allowed only as deliberate recovery before regenerating from the tree.
- When the bundled PostToolUse hook is wired, a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check` and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as agent context. Treat that context as the authoritative diff result, resolve any reported `SUPA_*` code before continuing, and do not re-run the diff by hand to "confirm" a clean result. The hook generates and proves; it never applies to a database, and it skips multi-root or path-confirmation cases that require human review.
- Never overwrite a migration file. supaschema writes no-clobber (`SUPA_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `SUPA_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `SUPA_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `supaschema check` on every generated or hand-authored migration. Run `supaschema verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked under `adapter: "auto"`; under `adapter: "postgres"` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- `supaschema sync` is an explicit operational handoff. With no apply flag it is a dry run; with `--local` or `--remote` it runs migration status and replay-safety gates, then delegates the actual apply/deploy to the Supabase CLI. Agents must not use apply flags without an explicit human request.
- Database URLs resolve flag (`$ENV` indirection supported) > named `config.environments` entry via `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`. Do not hard-code connection strings in scripts, config, or CI.
- Decode any `SUPA_*` diagnostic with `supaschema explain <CODE>`; recovery procedures live in `docs/configuration/hints.md`.
