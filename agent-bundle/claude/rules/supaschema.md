---
description: Generated-migration ownership and supaschema workflow policy for schema changes.
enforcement:
  type: enforced
  bindings:
    - rule: Generated migration edits are blocked before writes; schema-tree writes route through the supaschema hook-event workflow.
      hook: .claude/settings.json
      event: PreToolUse|PostToolUse
      matcher: Write|Edit|MultiEdit|apply_patch
      command: supaschema hook generated-migration-edit; supaschema hook schema-write
      status: enforced
paths:
  - supaschema.config.json
  - .claude/settings.json
  - .codex/hooks.json
  - database/schemas/**/*.sql
  - database/migrations/**/*.sql
  - supabase/schemas/**/*.sql
  - supabase/migrations/**/*.sql
  - neon/schemas/**/*.sql
  - neon/migrations/**/*.sql
  - aws-postgresql/schemas/**/*.sql
  - aws-postgresql/migrations/**/*.sql
  - cloud-sql/schemas/**/*.sql
  - cloud-sql/migrations/**/*.sql
  - alloydb/schemas/**/*.sql
  - alloydb/migrations/**/*.sql
  - azure-postgresql/schemas/**/*.sql
  - azure-postgresql/migrations/**/*.sql
---

# supaschema Migration Policy

## Contract

This rule owns how schema migrations are produced and protected in a repo that uses supaschema: migrations are generated from the declarative tree, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. The repeatable command workflow lives in the `supaschema` skill; write-time enforcement is hook-owned.

## Rules

- Consumer migration policy must rely on project files, generated hook context, and supaschema command output. Repo-local maintainer tooling such as Code Atlas, cclsp, FastMCP, and context-enforcement hooks is not part of the published consumer install surface.
- Consumer setup is package install plus one explicit setup command with the consuming project's package manager. Default `supaschema init` writes only config, configured schema directories, configured migration directories, and pending path-confirmation state. It does not write active AI-agent rules, hooks, skills, settings, `AGENTS.md`, or `CLAUDE.md`. The raw AI-agent bundle ships separately under `node_modules/supaschema/agent-bundle/`; install it only after the user asks for AI-agent enforcement or approves the bundle. The on-demand bundle install path is `supaschema init --agent-bundle` or a manual install from `agent-bundle/INSTALL.md`. Maintainer-only Claude/Codex optimization and context-enforcement tooling remains repo-local under Rule 13. `supaschema init` is idempotent: existing JSON config files are left untouched unless explicit repair is requested, JavaScript config files are not loaded or converted, and default setup leaves existing active agent surfaces untouched. When `--agent-bundle` is explicitly passed, existing hook script files are created only when missing, the managed guidance block is upserted only in `AGENTS.md`, pointer-style `CLAUDE.md` files stay `@AGENTS.md`, and retired generated backup directories such as `.agents/skills.__backup_<timestamp>` and `.codex/rules.__backup_<timestamp>` are removed from checked context surfaces. Hook wiring preserves existing entries and appends missing supaschema hook entries at the end of the relevant event array. When an existing Codex config already owns `PreToolUse` or `PostToolUse` through `.codex/hooks/tool-gate.mjs`, or `Stop` through `.codex/hooks/stop.mjs`, the installer treats that dispatcher as the event owner and removes package-owned direct hooks for that event instead of duplicating them. It only removes the known broken package-owned Claude script entries that passed `${CLAUDE_PROJECT_DIR}` script paths through `args`.
- Normal resolved installs do not create `.supaschema/`. If `.supaschema/install.json` exists and records `"pathConfirmationNeeded": true`, inspect the detected candidates, ask the user which `schemaPaths`, `sources.to`, and `migrationsDir` to use, and update `supaschema.config.json` before the first diff. Supabase projects with an existing `_bootstrap` schema inventory or a `supabase/AGENTS.md` owner brief marking `supabase/schemas/**` as non-generator inventory require this confirmation even when only one standard-looking schema path exists. Do not generate from the installer's guessed first candidate; `config validate`, `doctor`, and zero-source `diff` block until all three fields are explicit, and the PostToolUse hook must skip auto-diff until all three fields are explicit.
- `supaschema.config.json` owns four workflow decisions. Schema tree fields are `schemaPaths`, `sources.to`, and `migrationsDir`; `dir:` sources read nested `.sql` files recursively, and install writes `sources.to: "dir:<schemaPaths[0]>"`. Diff baseline fields are `sources.from` and `sources.to`; `sources.from: "auto"` resolves valid `git:HEAD`, then a database URL, then `empty:` for a first migration in a fresh repository. Generated contract fields are `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`; defaults create or refresh TypeScript and Zod outputs after `diff` and tell agents to use generated Zod validators at runtime boundaries. Apply policy fields are `workflow.migration_sync` and `sync.targets`; default `workflow.migration_sync: "auto"` keeps bare `supaschema sync` apply-capable, while `sync.targets.<name>.mode` decides selected targets and remote targets require approval variables. `adapter: "auto"` is provider-neutral and is not a Supabase switch. Provider-specific behavior is expressed through paths, managed schemas, transaction mode, excluded grant roles, sync targets, and explicit verify flags. Generic PostgreSQL installs use `managedSchemas: []` and reuse detected existing database URL environment variable names in `sync.targets` when present; Supabase installs seed the Supabase platform schema list and use the Supabase CLI runner by default.
- Schema intent changes only in the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`), such as `database/schemas/**`, `supabase/schemas/**`, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**`. Render the migration with `supaschema diff`; do not hand-author migration SQL for changes the tree can express.
- Do not run raw SQL DDL through Bash or database CLIs for structural changes that belong in the declarative schema tree. Edit the tree, run `supaschema diff`, then run `supaschema check`.
- SQL understanding is AST/model-owned. Classify, compare, or mutate DDL through PostgreSQL parse trees (`libpg-query`) and structured model helpers, not ad hoc regex. Regex is acceptable for outer transport concerns such as hook patch headers, file markers, or redaction, not SQL semantics.
- Any `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks direct edits, patch updates, move-target rewrites, and delete/add rewrites in both Claude and Codex runtimes. Deleting a stale generated migration is allowed only as deliberate recovery before regenerating from the tree.
- When the bundled PostToolUse hook is wired and workflow defaults are kept, a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check <generated migration path...>`; `diff` also creates or refreshes `typesFile` and `zodFile` under the default output policies. If `workflow.migration_sync` allows automatic sync, the hook first confirms every selected `sync.targets` entry is `mode: "auto"`, every database URL reference resolves, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync`, which owns the ordered lane sequence: enforce apply policy, resolve sources, generate diff and outputs, select targets, reconcile migration history, check pending migrations, run deploy safety gates, run the selected target runner when a target is selected, and reconcile or dry-run report. Otherwise the hook stays on the non-mutating diff/check lane. If the generated-migration `check` or `sync` fails, the hook emits loop-continuation feedback; inspect the diagnostic, identify the canonical root source in the declarative tree, config, or generated migration chain, search for similar or correlated migration failures, fix the canonical owner, and rerun the failing command. Treat hook context as the authoritative workflow result, resolve any reported `SUPA_*` code before continuing, and do not re-run the diff by hand to "confirm" a clean result. The hook skips multi-root or path-confirmation cases that require human review.
- Never overwrite a migration file. supaschema writes no-clobber (`SUPA_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `SUPA_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `SUPA_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `supaschema check` on every generated or hand-authored migration. Run `supaschema verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked when `transactionMode` is `per-migration`; under `per-statement` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- `supaschema sync` is the operational apply path and the single ordered lane runner for apply-capable workflows. Individual actions remain available through their own commands (`diff`, `check`, `verify`, `types`, `migrations`), and `sync` composes the required actions in order instead of requiring users or agents to assemble apply steps manually. Bare `sync` selects every configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply. `--target <name>` is the only public override path; do not use removed local/remote aliases. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`. Until target resolution, safety gates, and runner support have executed successfully, agents must not mutate a database.
- Database URLs resolve flag (`$ENV` indirection supported) > named `config.environments` entry via `--env` > `SUPASCHEMA_DATABASE_URL` > nearest `supabase/config.toml`. Do not hard-code connection strings in scripts, config, or CI, and do not create duplicate supaschema-only credential variables when the project already has a database URL variable or provider runner credential lane.
- Decode any `SUPA_*` diagnostic with `supaschema explain <CODE>` and use the emitted diagnostic guidance as the recovery procedure.

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
