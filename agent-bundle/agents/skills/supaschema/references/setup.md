# Setup and Configuration

## Install lanes

There are two distinct lanes. They install different things.

**npm package (project enforcement).** Install with the consuming project's package manager from the package directory that owns the schema workflow, then run setup:

```bash
npm install supaschema
npm exec -- supaschema init
```

Both steps are required. The published package deliberately defines no `preinstall`, `install`, `postinstall`, or `prepare` script, so installing alone leaves the consumer with downloaded files and no config, directories, hooks, or agent surfaces. Run `init` explicitly every time. Use the consuming project's own runner — `npm exec --`, `pnpm exec`, `yarn`, or `bunx` — so the locally installed version runs; bare `npx` can fetch a different version.

`supaschema init` writes or repairs `supaschema.config.json`, the configured schema and migration directories, safe focused package scripts when `package.json` exists (`supaschema:diff`, `supaschema:stage`, `supaschema:types`, `supaschema:check`), and package-owned active AI enforcement under `.agents`, `.claude`, and `.codex`. It copies missing package-bundled prompt/rule/skill/hook files, merges the package-manager-specific `.claude/settings.json` and `.codex/hooks.json` entries, preserves existing non-identical files, and reports skipped non-mergeable hook config so the gap can be repaired. It does **not** write `AGENTS.md`, `CLAUDE.md`, backup directories, maintainer tooling, or apply-capable package scripts.

Use those scaffolded scripts or direct `supaschema` commands. Do not create `db:migration:generate` or another parallel generation alias.

**`npx skills` (portable context only).** If this skill arrived through the Skills CLI, treat it as workflow context. Agent Skills installs `SKILL.md`-based folders into a user-selected location; it does not create `supaschema.config.json`, schema or migration directories, rule files, hook scripts, or hook registration. The npm package is the activation path for the bundled `.agents`, `.claude`, and `.codex` enforcement files.

## Supabase and provider defaults

Supabase projects whose owner brief marks `supabase/schemas/**` as inventory, or whose schema tree contains `_bootstrap`, still get a working config: `workflow.schema_diff` and `workflow.migration_sync` are set to `manual`, Supabase-managed schemas are seeded into `schemas.exclude`, and `_bootstrap` directories are skipped by schema-source readers. Supabase installs use the Supabase CLI runner by default; other PostgreSQL installs reuse detected existing database URL environment variable names in `sync.targets`.

## Pending install handoff

`.supaschema/install.json` is created only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories. When it exists with `"pathConfirmationNeeded": true`:

1. Read `agentInstructions`.
2. Choose from the candidate `schemaPaths` and `migrationsDirs`.
3. Write explicit `schemaPaths` and `migrationsDir` into `supaschema.config.json`.
4. Only then run validation or workflow commands.

Resolved installs remove `.supaschema/`. If no pending manifest exists, inspect `supaschema.config.json` directly.

## Offline documentation

The installed package contains an offline, byte-exact copy of every public MDX page under `node_modules/supaschema/agent-bundle/docs/`. Start at `agent-bundle/docs/index.md` when hosted documentation is unavailable. These files stay inside `node_modules`; `init` does not copy them into the project.

## Config reference

Read `supaschema.config.json` before editing schemas. Four decisions are the agent-facing source of truth.

### Schema tree — `schemaPaths`, `migrationsDir`

Edit only the configured schema roots; nested `.sql` files are merged into one model. Zero-source-flag `diff`, `plan`, and `verify` target `dir:<schemaPaths[0]>`; pass `--to` for an explicit alternate target. Generated migrations write to `migrationsDir`, and existing generated lineage there proves the migration-tree baseline.

Do not create a parallel schema tree, a second migrations directory, duplicate database credentials, or a new config unless the user explicitly asks to change project layout.

### Diff baseline — `sources.from`

`sources.from` owns the before-state; `schemaPaths` owns the after-state. Install writes `sources.from: "auto"`. For generation, `auto` resolves a proven staged closure as `git:INDEX` before trying `git:HEAD`, and the chosen snapshot must match generated migration lineage when migrations exist. A `migrations:` before-state is allowed only when it resolves to `migrationsDir` and replay succeeds; it is never a generation target. Use explicit `--from` or `--to` for `dump:`, `dir:`, `git:`, `catalog:`, `empty:`, or `database:` inputs outside those defaults.

### Generated contracts — `typesFile`, `zodFile`, `zodTypesImportPath`, `workflow.type_generation`, `workflow.zod_generation`, `workflow.type_usage`

`supaschema types` creates or refreshes TypeScript and Zod outputs from the configured schema source, including schema-defined views, materialized views, view-on-view dependencies, functions, enums, and composites. `workflow.type_usage: "zod_validated"` means agents should use the generated Zod validators at runtime boundaries.

If a view depends on an extension-owned relation outside the configured schema source, fix the supported source or model — do not patch consumers with casts, aliases, or local contract copies. If a modeled relation, function, extension, or expression should resolve but stays `unknown`, fix that owner. Unsupported PostgreSQL scalars that upstream maps to `unknown` are intentional and must not gain local mappings.

### Apply policy — `workflow.migration_sync`, `sync.targets`

| Setting | Effect on bare `supaschema sync` |
| --- | --- |
| `migration_sync: "auto"` (default) | apply-capable for exactly one target with `mode: "auto"` |
| `migration_sync: "manual"` | stays on the dry-run gate; requires explicit `--target <name>` |
| `migration_sync: "disabled"` | refuses apply; non-mutating lanes still run |

Set an individual target to `mode: "manual"` to omit it from bare sync. Multiple automatic targets are refused because cross-target apply is not atomic. Remote automatic targets must also set `requireApprovalEnv` and have that runtime variable present, for example `SUPASCHEMA_REMOTE_SYNC_APPROVED=1`.

### Deploy-safety policy — `workflow.rls_safety`, `workflow.type_safety`

Both default to `report_only` and accept `disabled`, `report_only`, or `deploy_blocking`. `rls_safety` governs the RLS and grant rule packs; `type_safety` governs type-contract diagnostics. `deploy_blocking` turns findings into a refusal at the `sync` deploy-safety step; `disabled` short-circuits the gate entirely. Full behavior in [safety.md](safety.md).

### Generation and check policy — `workflow.schema_diff`, `workflow.migration_check`

These drive the bundled hooks. `schema_diff` accepts `disabled`, `manual`, or `on_schema_write` (default). `migration_check` accepts `manual`, `after_schema_diff` (default), or `required_before_complete`. Setting either to `manual` stops the automatic lane without disabling the command.

`required_before_complete` currently behaves identically to `after_schema_diff`: the packaged bundle installs only the schema-write `PostToolUse` hook and the generated-migration `PreToolUse` hook, and no consumer `Stop` hook reads the policy. Treat it as another post-diff check mode, not as a gate that withholds agent completion.

### Supporting fields

- `managedSchemas` blocks externally owned schemas; Supabase installs mirror those names into `schemas.exclude`.
- `transactionMode` mirrors the apply runner. Keep `"per-migration"` for transactional runners; `CREATE INDEX CONCURRENTLY` is blocked in that mode and splits to a `.concurrent.sql` companion only under an explicit `"per-statement"` lane.
- `environments` optionally holds extra `$ENV_NAME` URL references, selected with the global `--env`.
- `adapter: "auto"` is a provider-neutral sentinel, not workflow consent.
- `hints.destructive` and `hints.renames` unblock reviewed destructive operations and declare renames. Never use `"*"` in committed config; renames are never inferred.

## Database URL resolution

Precedence for every CLI command:

1. `--database-url` (accepts `$ENV`)
2. named `config.environments` entry via global `--env`
3. `SUPASCHEMA_DATABASE_URL`
4. the nearest `supabase/config.toml`

## Bundled hook behavior

When the bundled `PostToolUse` hook is wired (`.claude/settings.json` / `.codex/hooks.json`) and `workflow.schema_diff` / `workflow.migration_check` keep their defaults, writing a schema-tree `.sql` file auto-runs `diff` then `check <generated migration path...>`, returning the generated migration name or a blocking `SUPA_*` diagnostic.

If `workflow.migration_sync` allows automatic sync, the hook first confirms exactly one `sync.targets` entry is selected with `mode: "auto"`, its database URL reference resolves when its runner needs one, and any remote target has its configured approval variable set. Only then does it delegate to `supaschema sync`. If `check` or `sync` fails, inspect the diagnostic, fix the canonical source, and rerun the failing command.

The registered commands are `supaschema hook schema-write` and `supaschema hook generated-migration-edit`. They are hidden internal entrypoints that read a hook payload on stdin — the settings templates wire them, and you should never invoke them by hand. To exercise the behavior, edit a schema file or attempt a generated-migration edit and observe the hook result.
