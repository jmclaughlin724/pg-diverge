---
description: Generated-migration ownership and supaschema workflow policy for schema changes.
enforcement:
  type: enforced
  bindings:
    - rule: Generated migration edits are blocked before writes.
      hook: .claude/settings.json
      event: PreToolUse
      matcher: Write|Edit|MultiEdit|apply_patch
      command: supaschema hook generated-migration-edit
      status: enforced
    - rule: Schema-tree writes route through the supaschema hook-event workflow.
      hook: .claude/settings.json
      event: PostToolUse
      matcher: Write|Edit|MultiEdit|apply_patch
      command: supaschema hook schema-write
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

This rule owns how schema migrations are produced and protected in a repo that uses supaschema: migrations are generated from the declarative end-state plus migration-derived source intent, generated artifacts are never hand-edited, destructive intent is hint-gated, and verification mirrors the migration runner. Existing migrations are source intent for the planner, not only history files. The repeatable command workflow lives in the `supaschema` skill; write-time enforcement is hook-owned.

## Rules

- Consumer migration policy must rely on project files, generated hook context, and supaschema command output. Repo-local maintainer tooling such as Code Atlas, cclsp, FastMCP, and context-enforcement hooks is not part of the published consumer install surface.
- Consumer setup is package install plus one explicit setup command with the consuming project's package manager. Default `supaschema init` writes config, configured schema directories, configured migration directories, safe generated package scripts when `package.json` exists, package-owned active AI enforcement under `.agents`, `.claude`, and `.codex`, and pending path-confirmation state. Those scripts are focused non-apply lanes: `supaschema:diff` for `supaschema diff`, `supaschema:stage` for `supaschema stage`, `supaschema:types` for `supaschema types`, and `supaschema:check` for `supaschema check`; setup diagnostics, full sync, apply, and database execution verification stay on direct CLI commands (`supaschema config validate`, `supaschema sync`, `supaschema apply`, and `supaschema verify`). It copies missing bundled prompt/rule/skill/hook files, merges package-manager-specific Claude and Codex hook registration, preserves existing non-identical files, and reports skipped non-mergeable hook config for agent repair. It does not write `AGENTS.md`, `CLAUDE.md`, backup directories, maintainer tooling, or apply-capable package scripts. Maintainer-only Claude/Codex optimization and context-enforcement tooling remains repo-local under Rule 13. `supaschema init` is idempotent: existing JSON config files and existing `supaschema:*` package scripts are left untouched unless explicit repair is requested, and JavaScript config files are not loaded or converted.
- Normal resolved installs do not create `.supaschema/`. Supabase projects with an existing `_bootstrap` schema inventory or a `supabase/AGENTS.md` owner brief marking `supabase/schemas/**` as non-generator inventory are resolved installs when the standard Supabase paths are detected: `supaschema init` writes `supaschema.config.json` with explicit `schemaPaths`, `sources.to`, and `migrationsDir`, then sets `workflow.schema_diff` and `workflow.migration_sync` to manual. If `.supaschema/install.json` exists and records `"pathConfirmationNeeded": true`, inspect the detected candidates, ask the user which `schemaPaths`, `sources.to`, and `migrationsDir` to use, and update `supaschema.config.json` before the first diff. Do not generate from the installer's guessed first candidate in genuinely ambiguous path-ownership cases; `config validate`, `doctor`, and zero-source `diff` block until all three fields are explicit, and the PostToolUse hook must skip auto-diff until all three fields are explicit.
- `supaschema.config.json` owns four workflow decisions. Schema tree fields are `schemaPaths`, `sources.to`, and `migrationsDir`; `dir:` sources read nested `.sql` files recursively, and install writes `sources.to: "dir:<schemaPaths[0]>"`. Diff baseline fields are `sources.from` and `sources.to`; `sources.from: "auto"` resolves valid `git:HEAD`, then a database URL, then `empty:` for a first migration in a fresh repository. Generated contract fields are `typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, and `workflow.type_usage`; `supaschema types` creates or refreshes TypeScript and Zod outputs from the configured schema source and agents use generated Zod validators at runtime boundaries when `workflow.type_usage` is `zod_validated`. Schema-diff hook-trigger fields are `workflow.schema_diff`, `workflow.migration_check`, and `workflow.migration_verify`; their defaults make a schema-tree write auto-run `diff` then `check`. Apply policy fields are `workflow.migration_sync` and `sync.targets`; default `workflow.migration_sync: "auto"` keeps bare `supaschema sync` apply-capable for one target whose `sync.targets.<name>.mode` is `"auto"`, and multiple selected targets are refused because cross-target apply is not atomic. Remote targets require approval variables. `adapter: "auto"` is provider-neutral and is not a Supabase switch. Provider-specific behavior is expressed through paths, managed schemas, transaction mode, excluded grant roles, sync targets, and explicit verify flags. Generic PostgreSQL installs use `managedSchemas: []` and reuse detected existing database URL environment variable names in `sync.targets` when present; Supabase installs seed the Supabase platform schema list and use the Supabase CLI runner by default.
- Schema end-state changes belong in the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`), such as `database/schemas/**`, `supabase/schemas/**`, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**`. Existing migrations in `migrationsDir` are the operational source-intent corpus for facts the end-state tree cannot express by shape alone: row backfills, explicit DML/`DO` workflows, enum rewrite recipes, Vault references or placeholder names, workload-proven index intent, reviewed routine drops, and provider bootstrap constraints. Planning must inspect and structurally model that corpus before reporting missing intent. Render the migration with `supaschema diff`; do not hand-author migration SQL for changes the tree and migration-intent lane can express.
- Migration-derived intent is explicit, not guessed. supaschema may preserve or transform row backfills, Vault secret references, and query-workload indexes only when the intent is present in declarative SQL, existing migrations, config, checked workload artifacts, or reviewed hints. It must never invent row values, Vault secret material, tenant predicates, data conversion expressions, or indexes from table shape alone. When intent is absent, the planner or diagnostic must name the missing source and tell the agent where to add it.
- The implementation lane for diff/plan/sync is: resolve configured `schemaPaths`, `sources`, and `migrationsDir`; extract parser-backed `from` and `to` schema models; extract a structured migration-intent model from existing migrations; pass both schema models and intent into planning/rendering; then check, verify, and reconcile against migration history. Existing migrations cannot be used only for lineage/history while the planner ignores their contents.
- Do not run raw SQL DDL through Bash or database CLIs for structural changes that belong in the declarative schema tree. Edit the tree, run `supaschema diff`, then run `supaschema check`.
- SQL understanding is AST/model-owned. Classify, compare, or mutate DDL through PostgreSQL parse trees (`libpg-query`) and structured model helpers, not ad hoc regex. Regex is acceptable for outer transport concerns such as hook patch headers, file markers, or redaction, not SQL semantics.
- PostgreSQL support claims are executable contracts, not prose. Any object or statement described as supported in docs, skills, or agents must be wired through the model boundary in `src/sql/support.ts` plus the applicable extractor, catalog extractor, planner, renderer, checker, audit report, and focused tests. Any documented unsupported boundary must also be listed in `unsupportedStatementSupport` so parser-backed diagnostics name the boundary instead of falling through generic text.
- Any `.sql` file containing the `-- supaschema: lineage` marker is a generated artifact. Never edit it; edit the tree and regenerate. The PreToolUse hook blocks direct edits, patch updates, move-target rewrites, and delete/add rewrites in both Claude and Codex runtimes. Deleting a stale generated migration is allowed only as deliberate recovery before regenerating from the tree.
- When the bundled PostToolUse hook is wired and workflow defaults are kept, a write to a schema-tree `.sql` file auto-runs `supaschema diff` then `supaschema check <generated migration path...>`. If `workflow.migration_sync` allows automatic sync, the hook first confirms exactly one `sync.targets` entry is selected with `mode: "auto"`, its database URL reference resolves when its runner needs one, and any remote target has its configured approval variable set; only then does it delegate to `supaschema sync`, which owns the full ordered workflow: enforce apply policy, resolve sources, generate diff, select exactly one target when a target is configured, reconcile migration history, check pending migrations, refresh generated TypeScript/Zod contracts according to workflow policy, stage generated migrations when Git is available, run deploy safety gates, verify pending migrations against a disposable database, run the selected target runner when a target is selected, and reconcile or dry-run report. Otherwise the hook stays on the non-mutating diff/check lane and tells agents to run `supaschema sync` when they need the full workflow. If the generated-migration `check` or `sync` fails, the hook emits loop-continuation feedback; inspect the diagnostic, identify the canonical root source in the declarative tree, config, or generated migration chain, search for similar or correlated migration failures, fix the canonical owner, and rerun the failing command. Treat hook context as the authoritative workflow result, resolve any reported `SUPA_*` code before continuing, and do not re-run the diff by hand to "confirm" a clean result. The hook skips multi-root or path-confirmation cases that require human review.
- Never overwrite a migration file. supaschema writes no-clobber (`SUPA_DIFF_OUTPUT_EXISTS`); a stale file is deleted deliberately, not clobbered.
- Honor the lineage chain gate: `SUPA_DIFF_LINEAGE_BROKEN` means diff from the post-migration state (`--from database:<applied db>`), `SUPA_DIFF_LINEAGE_DUPLICATE` means the change is already pending. `--no-check-chain` requires explicit human approval.
- Destructive operations (drops, table/type replacements, column drops, column type changes, incompatible view/routine replacements) stay blocked until the exact object key is added to `hints.destructive` after reviewing the rendered SQL. `"*"` never lands in committed config. Migration-intent destructive comments are disclosure/audit evidence, not an additional blocker after the planner has allowed the operation. A hinted table replace is not data-preserving; prefer the column ALTER lane the planner renders for identity, default, not-null, generated-expression, additive-column, and constraint-only changes.
- Dropped parent objects own the state PostgreSQL removes with them. Gate the parent drop key and suppress separately rendered child grants, comments, RLS, policies, triggers, constraints, and indexes that are owned by that dropped object. Privilege replacements must revoke the previous privilege state before granting the target state, and removing a modeled `REVOKE` must render the reverse `GRANT`.
- Renames are declared in `hints.renames`, never inferred. Kind changes and cross-schema moves are unsupported by design.
- Run `supaschema check` on every generated or hand-authored migration. Run `supaschema verify` before merge when a database is reachable; keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`.
- `CREATE INDEX CONCURRENTLY` is blocked when `transactionMode` is `per-migration`; under `per-statement` it lands in the `.concurrent.sql` companion, which runs outside a transaction through an operational lane.
- `supaschema sync` is the canonical one-command workflow. It generates the diff, selects at most one configured target, reconciles migration history, gates replay safety, refreshes generated TypeScript/Zod contracts according to workflow policy, stages generated migrations when Git is available, runs deploy safety gates, verifies the ordered pending migration set against a disposable database, applies through the selected runner when a target is selected, and performs final reconciliation or dry-run reporting. It also refreshes generated contracts and runs the local stage lane when no migration is pending. `supaschema diff`, `supaschema stage`, `supaschema apply`, `supaschema types`, and `supaschema check` remain explicit lanes for focused operation: `diff` writes migrations, `stage` git-stages changed generated migration files, `apply` applies already-generated pending migrations, `types` regenerates TypeScript/Zod contracts, and `check` gates replay safety. Bare `sync` may select one configured `sync.targets.<name>` entry with `mode: "auto"` when `workflow.migration_sync` is `"auto"`; multiple automatic targets are refused because cross-target apply is not atomic. `workflow.migration_sync: "manual"` leaves bare `sync` on the dry-run gate and allows explicit `--target <name>` overrides. `workflow.migration_sync: "disabled"` refuses apply while allowing non-mutating sync lanes. Remote automatic targets must require a runtime approval variable such as `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`. Until target resolution, safety gates, verify, and runner support have executed successfully, agents must not mutate a database.
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

Schema end-state is in the tree, migration-derived source intent has been extracted or a missing-intent diagnostic names the required source, generated migration/types/Zod outputs are current, generated artifacts were not hand-edited, destructive/rename intent is explicit or disclosed according to the planner decision, and check/verify evidence exists for the touched lane.
