---
description: Generated-migration ownership and supaschema workflow policy for schema changes.
---

# supaschema Migration Policy

## Contract

This rule owns how schema migrations are produced and protected in a repo that uses supaschema: migrations are generated from the declarative tree, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. The repeatable command workflow lives in the `supaschema` skill; write-time enforcement is hook-owned.

## Rules

- Consumer migration policy must rely on project files, generated hook context, and supaschema command output. Repo-local maintainer tooling such as Code Atlas, cclsp, FastMCP, and context-enforcement hooks is not part of the published consumer install surface.
- Consumer setup is package install plus one explicit setup command with the consuming project's package manager. The agent install protocol lives at `.agents/prompts/supaschema-install.md`; it owns package-manager selection, workspace targeting, local runner commands, setup commands, and wrong-manager stop conditions. The installed config, schema/migration directories, supaschema consumer rule/skill/hook bundle, hook wiring, and tagged `AGENTS.md` / `CLAUDE.md` addendum are part of the package setup surface. Maintainer-only Claude/Codex optimization and context-enforcement tooling remains repo-local under Rule 13. `supaschema init` performs consumer setup through the shared scaffolder (`bin/scaffold.mjs`) — config, directories, agent bundle, hook wiring, and pending path-confirmation state when needed. Run it through the matching local runner from the schema-owning package directory after install. It is idempotent: existing JSON config files are left untouched unless explicit repair is requested, JavaScript config files are not loaded or converted, and the managed guidance block is upserted in place. Hook wiring preserves existing entries and appends missing supaschema hook entries at the end of the relevant event array; it only removes the known broken package-owned Claude script entries that passed `${CLAUDE_PROJECT_DIR}` script paths through `args`.
- Normal resolved installs do not create `.supaschema/`. If `.supaschema/install.json` exists and records `"pathConfirmationNeeded": true`, inspect the detected candidates, ask the user which `schemaPaths`, `sources.to`, and `migrationsDir` to use, and update `supaschema.config.json` before the first diff. Do not generate from the installer's guessed first candidate; `config validate`, `doctor`, and zero-source `diff` block until all three fields are explicit, and the PostToolUse hook must skip auto-diff until all three fields are explicit.
- `supaschema.config.json` owns four workflow decisions. Schema tree fields are `schemaPaths`, `sources.to`, and `migrationsDir`; `dir:` sources read nested `.sql` files recursively, and install writes `sources.to: "dir:<schemaPaths[0]>"`. Diff baseline fields are `sources.from` and `sources.to`; `sources.from: "auto"` resolves valid `git:HEAD`, then a database URL, then `empty:` for a first migration in a fresh repository. Generated contract fields are `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`; defaults create or refresh TypeScript and Zod outputs after `diff` and tell agents to use generated Zod validators at runtime boundaries. Apply policy fields are `workflow.migration_sync` and `sync.targets`; default `workflow.migration_sync: "auto"` keeps bare `supaschema sync` apply-capable, while `sync.targets.<name>.mode` decides selected targets and remote targets require approval variables. `adapter: "auto"` is provider-neutral and is not a Supabase switch. Provider-specific behavior is expressed through paths, managed schemas, transaction mode, excluded grant roles, sync targets, and explicit verify flags. Generic PostgreSQL installs use `managedSchemas: []` and reuse detected existing database URL environment variable names in `sync.targets` when present; Supabase installs seed the Supabase platform schema list and use the Supabase CLI runner by default.
- Schema intent changes only in the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`), such as `database/schemas/**`, `supabase/schemas/**`, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**`. Render the migration with `supaschema diff`; do not hand-author migration SQL for changes the tree can express.
- Do not run raw SQL DDL through Bash or database CLIs for structural changes that belong in the declarative schema tree. Edit the tree, run `supaschema diff`, then run `supaschema check`.
- SQL understanding is AST/model-owned. Classify, compare, or mutate DDL through PostgreSQL parse trees (`libpg-query`) and structured model helpers, not ad hoc regex. Regex is acceptable for outer transport concerns such as hook patch headers, file markers, or redaction, not SQL semantics.
- Any `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks direct edits, patch updates, move-target rewrites, and delete/add rewrites in both Claude and Codex runtimes. Deleting a stale generated migration is allowed only as deliberate recovery before regenerating from the tree.
- When the bundled PostToolUse hook is wired and workflow defaults are kept, a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check`; `diff` also creates or refreshes `typesFile` and `zodFile` under the default output policies. If `workflow.migration_sync` allows automatic sync, the hook first confirms every selected `sync.targets` entry is `mode: "auto"`, every database URL reference resolves, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync`, which owns diff, generated outputs, type/RLS safety gates, apply, and target reconciliation. Otherwise the hook stays on the non-mutating diff/check lane. If `check` or `sync` fails, the hook emits loop-continuation feedback; inspect the diagnostic, identify the canonical root source in the declarative tree, config, or generated migration chain, search for similar or correlated migration failures, fix the canonical owner, and rerun the failing command. Treat hook context as the authoritative workflow result, resolve any reported `SUPA_*` code before continuing, and do not re-run the diff by hand to "confirm" a clean result. The hook skips multi-root or path-confirmation cases that require human review.
- Never overwrite a migration file. supaschema writes no-clobber (`SUPA_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `SUPA_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `SUPA_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `supaschema check` on every generated or hand-authored migration. Run `supaschema verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked when `transactionMode` is `per-migration`; under `per-statement` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- `supaschema sync` is the operational apply path. Bare `sync` selects every configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply. `--target <name>` is the only public override path; do not use removed local/remote aliases. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`. Until target resolution, safety gates, and runner support have executed successfully, agents must not mutate a database.
- Database URLs resolve flag (`$ENV` indirection supported) > named `config.environments` entry via `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`. Do not hard-code connection strings in scripts, config, or CI, and do not create duplicate supaschema-only credential variables when the project already has a database URL variable or provider runner credential lane.
- Decode any `SUPA_*` diagnostic with `supaschema explain <CODE>`; recovery procedures live in `docs/configuration/hints.mdx`.

## Verification

For schema workflow changes or consumer migration guidance, prove the actual lane with the relevant command:

```bash
supaschema diff
supaschema check
supaschema verify
supaschema types
supaschema explain <SUPA_CODE>
```

When editing this repo's implementation, run the narrow source tests plus `npm run typecheck` and the relevant fixture/corpus checks.

## Failure behavior

Resolve `SUPA_*` diagnostics through `supaschema explain`, edit the declarative tree rather than generated migrations, and ask for explicit approval before any remote sync approval, apply flag outside configured automation, or `--no-check-chain` path.

## Done means

Schema intent is in the tree, generated migration/types/Zod outputs are current, generated artifacts were not hand-edited, destructive/rename intent is explicit, and check/verify evidence exists for the touched lane.
