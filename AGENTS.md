# supaschema Agent Brief

## Contract

This file is the operator brief for AI agents working in this repository or in a repository that uses supaschema. Durable policy lives in `.claude/rules/supaschema.md`; the repeatable workflow lives in `.claude/skills/supaschema/SKILL.md`; write-time enforcement lives in `.claude/hooks/**` and `.codex/hooks/**`.

supaschema generates deterministic, replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs. It is a generator and prover only: it never stages, commits, or applies to a tracked database.

## Invariants

- Migrations are generated, never hand-authored. Schema intent changes in the declarative tree (`supabase/schemas/**` or the project's tree); `supaschema diff` renders the migration.
- A `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it by hand — change the source tree and regenerate. The PreToolUse hook blocks such edits in both agent runtimes.
- The bundle also wires a PostToolUse hook in both runtimes: a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check` and returns the generated migration name, or the blocking `SUPA_*` diagnostic, as context. Treat that as the authoritative diff result and act on any reported code; the hook generates and proves but never applies to a database.
- Destructive intent is explicit. Drops, column type changes, and PostgreSQL-incompatible replacements stay blocked until the exact object key is added to `hints.destructive` after review. Never add `"*"` to committed config.
- Verification must match the runner: keep `transactionMode: "per-migration"` for `supabase db push`-style runners. Run `supaschema check` always and `supaschema verify` before merge when a database is reachable.
- Respect the lineage chain gate. When `diff` refuses with `SUPA_DIFF_LINEAGE_BROKEN` or `SUPA_DIFF_LINEAGE_DUPLICATE`, regenerate from the post-migration state (`--from database:<applied db>`); `--no-check-chain` is for explicit human-approved bypasses only.
- Database URLs are never hard-coded: flag (`$ENV` supported) > named `config.environments` entry via `--env` > `SUPASCHEMA_DATABASE_URL` > auto-discovery from the nearest `supabase/config.toml`.
- `supaschema explain <CODE>` decodes any `SUPA_*` diagnostic offline; `docs/configuration/hints.md` has recovery steps for blocked plans.

## Common Commands

Zero-flag defaults: `--from` resolves to the database (then `git:HEAD`), `--to` to the config schema tree, output to `config.migrationsDir` with a derived name, `check` to the whole migrations directory, `verify --migration` to the newest pending file. Applied defaults print to stderr; flags override.

```bash
supaschema diff                          # render the migration from applied state -> schema tree (refreshes the types file when present)
supaschema check                         # replay-safety gate for the migrations directory
supaschema verify                        # apply-twice proof for the newest pending migration
supaschema types                         # Supabase-compatible TypeScript types + Zod validators from the tree; no database or introspection
supaschema diff --fail-on-diff --quiet   # CI drift gate (exit 3 on drift)
supaschema diff --summary                # blocked-plan triage: operation/diagnostic counts by kind and schema
supaschema diff --write-hints <file>     # reviewable hints.destructive skeleton for gated keys
supaschema audit --from <source>         # support-matrix coverage + out-of-contract statements by code
supaschema selfcheck                     # cross-lane identity parity proof against a live catalog (SUPA_SELFCHECK_*)
supaschema migrations                    # applied/pending/ghost/out-of-order vs history table
```

## Repository Development (supaschema itself)

- `npm run check` — lint + typecheck + tests + build; database-gated suites auto-resolve a URL or skip.
- `npm run fixture:verify` / `npm run benchmark` — execution proof and threshold-enforced performance lanes.
- Source is AST-only: statement classification and SQL mutation come from `libpg-query` parse trees, never regex over SQL.
