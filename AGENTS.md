# pg-diverge Agent Brief

## Contract

This file is the operator brief for AI agents working in this repository or in a repository that uses pg-diverge. Durable policy lives in `.claude/rules/pg-diverge.md`; the repeatable workflow lives in `.claude/skills/pg-diverge/SKILL.md`; write-time enforcement lives in `.claude/hooks/**` and `.codex/hooks/**`.

pg-diverge generates deterministic, replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs. It is a generator and prover only: it never stages, commits, or applies to a tracked database.

## Invariants

- Migrations are generated, never hand-authored. Schema intent changes in the declarative tree (`supabase/schemas/**` or the project's tree); `pg-diverge diff` renders the migration.
- A `.sql` file containing the `-- pg-diverge: lineage` marker is a generated artifact. Never edit it by hand — change the source tree and regenerate. Hooks in both agent runtimes block such edits.
- Destructive intent is explicit. Drops, column type changes, and PostgreSQL-incompatible replacements stay blocked until the exact object key is added to `hints.destructive` after review. Never add `"*"` to committed config.
- Verification must match the runner: keep `transactionMode: "per-migration"` for `supabase db push`-style runners. Run `pg-diverge check` always and `pg-diverge verify` before merge when a database is reachable.
- Respect the lineage chain gate. When `diff` refuses with `PD_DIFF_LINEAGE_BROKEN` or `PD_DIFF_LINEAGE_DUPLICATE`, regenerate from the post-migration state (`--from database:<applied db>`); `--no-check-chain` is for explicit human-approved bypasses only.
- Database URLs are never hard-coded: flag (`$ENV` supported) > `PG_DIVERGE_DATABASE_URL` > auto-discovery from the nearest `supabase/config.toml`.
- `pg-diverge explain <CODE>` decodes any `PD_*` diagnostic offline; `docs/hints.md` has recovery steps for blocked plans.

## Common Commands

```bash
pg-diverge diff --from git:HEAD --to dir:supabase/schemas --name <change> --migrations-dir supabase/migrations
pg-diverge check <migration.sql>
pg-diverge verify --from git:HEAD --to dir:supabase/schemas --migration <migration.sql>
pg-diverge diff --from "database:$DATABASE_URL" --to dir:supabase/schemas --fail-on-diff --quiet   # CI drift gate (exit 3 on drift)
pg-diverge diff ... --summary            # blocked-plan triage: operation/diagnostic counts by kind and schema
pg-diverge diff ... --write-hints <file> # reviewable hints.destructive skeleton for gated keys
pg-diverge audit --from <source>         # support-matrix coverage + out-of-contract statements by code
pg-diverge selfcheck                     # cross-lane identity parity proof against a live catalog (PD_SELFCHECK_*)
pg-diverge migrations --migrations-dir supabase/migrations  # applied/pending/ghost/out-of-order vs history table
```

## Repository Development (pg-diverge itself)

- `npm run check` — lint + typecheck + tests + build; database-gated suites auto-resolve a URL or skip.
- `npm run fixture:verify` / `npm run benchmark` — execution proof and threshold-enforced performance lanes.
- Source is AST-only: statement classification and SQL mutation come from `libpg-query` parse trees, never regex over SQL.
