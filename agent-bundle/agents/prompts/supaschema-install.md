# supaschema Agent Install Prompt

Use this prompt when an AI agent is asked to install, initialize, inspect, or use supaschema in a consuming project.

## Role

You are working in the consuming project, not in the supaschema source repository.

Do not clone `jmclaughlin724/supaschema` into the project, run `npm ci` in a nested supaschema checkout, or validate supaschema by running its internal fixture suite unless the user explicitly asks you to develop supaschema itself. For normal use, install the npm package in the target project and work from that project root.

## Identify the Package Manager

Before installing, identify the package manager from this evidence, in order:

1. `packageManager` in `package.json`.
2. `devEngines.packageManager` in `package.json`.
3. Lockfile and workspace evidence: `package-lock.json` or `npm-shrinkwrap.json` means npm, `pnpm-lock.yaml` or `pnpm-workspace.yaml` means pnpm, `yarn.lock` means Yarn, and `bun.lock` or `bun.lockb` means Bun.

STOP IF package-manager signals conflict, the owning workspace package is unclear, or Node is below 22.12. Do not run npm in a pnpm, Yarn, or Bun project. Do not create a second lockfile.

For workspaces, `cd` into the owning member package before install and setup unless the workspace root owns `supaschema.config.json` and the schema workflow. Dependency-targeting flags can update a member manifest while `supaschema init` still writes setup files in the command's current directory. With pnpm, `pnpm add supaschema` targets the package in the current directory; use `pnpm add -w supaschema` only when the workspace root owns the schema workflow. pnpm 11 defaults `minimumReleaseAge` to one day, so keep that protection for normal installs. Use `--config.minimumReleaseAge=0` only when troubleshooting an immediate install of a just-published supaschema version.

## Install Command

| Manager | First install | Setup |
| --- | --- | --- |
| npm | `npm install supaschema` | `npm exec -- supaschema init` |
| pnpm | `pnpm add supaschema` | `pnpm exec supaschema init` |
| Yarn | `yarn add supaschema` | `yarn exec supaschema init` |
| Bun | `bun add supaschema` | `./node_modules/.bin/supaschema init` |

Use the matching local runner for every command after install:

| Manager | Local runner |
| --- | --- |
| npm | `npm exec -- supaschema <cmd>` |
| pnpm | `pnpm exec supaschema <cmd>` |
| Yarn | `yarn exec supaschema <cmd>` |
| Bun | `./node_modules/.bin/supaschema <cmd>` |

Always run the matching explicit setup command from the owning package directory after install. The command is idempotent and leaves existing config intact. Default `supaschema init` combines the consuming repo's detected package manager, workspace owner, provider markers, schema paths, migration paths, focused non-apply package scripts, and active AI-agent enforcement bundle. It installs missing package-owned `.agents`, `.claude`, and `.codex` prompt/rule/skill/hook files, merges package-manager-specific `.claude/settings.json` and `.codex/hooks.json`, preserves existing non-identical files, and reports skipped non-mergeable hook config. It does not write `AGENTS.md`, `CLAUDE.md`, backup directories, maintainer tooling, or apply-capable package scripts.

```bash
npm exec -- supaschema init
pnpm exec supaschema init
yarn exec supaschema init
./node_modules/.bin/supaschema init
```

Use `<local-runner> init --dry-run --json` when you need to preview setup before writing files.

After setup, use package scripts from the owning package for focused non-apply lanes:

| Manager | Diff | Stage | Types | Check |
| --- | --- | --- | --- | --- |
| npm | `npm run supaschema:diff` | `npm run supaschema:stage` | `npm run supaschema:types` | `npm run supaschema:check` |
| pnpm | `pnpm supaschema:diff` | `pnpm supaschema:stage` | `pnpm supaschema:types` | `pnpm supaschema:check` |
| Yarn | `yarn supaschema:diff` | `yarn supaschema:stage` | `yarn supaschema:types` | `yarn supaschema:check` |
| Bun | `bun run supaschema:diff` | `bun run supaschema:stage` | `bun run supaschema:types` | `bun run supaschema:check` |

Use direct CLI commands for setup diagnostics, full sync, apply, and database execution verification:

```bash
<local-runner> config validate --json
<local-runner> sync
<local-runner> apply
<local-runner> verify
```

## What Install Provides

The package provides:

- the `supaschema` CLI and typed ESM library exports;
- PostgreSQL parser/deparser runtime dependencies;
- `supaschema-config.schema.json` for editor and config validation;
- active AI-agent rules, hooks, skills, prompts, and settings under `node_modules/supaschema/agent-bundle/`.

Public docs and examples are hosted in the supaschema documentation and source repository. They are not part of the normal `node_modules/supaschema` install payload, and you should not clone the source repository just to read them during consumer setup.

Default `supaschema init` writes or merges these project files into the consuming repo:

- `supaschema.config.json` when the project does not already have one;
- configured schema and migration directories;
- focused non-apply `supaschema:*` package scripts when `package.json` exists: `supaschema:diff`, `supaschema:stage`, `supaschema:types`, and `supaschema:check`;
- missing package-owned `.agents`, `.claude`, and `.codex` enforcement files, plus merged `.claude/settings.json` and `.codex/hooks.json` hook entries;
- `.supaschema/install.json` only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories.

For Supabase projects whose owner brief marks `supabase/schemas/**` as inventory, or whose schema tree contains `_bootstrap`, `supaschema init` still writes a working config from the detected Supabase paths. In that profile, `workflow.schema_diff` and `workflow.migration_sync` are set to `manual`, so setup is complete but automatic schema-write diffing/apply is not assumed.

Install does not edit schema files, generate migrations, connect to a database, apply migrations, write real database credentials, create duplicate supaschema-only database credential files, write `AGENTS.md` or `CLAUDE.md`, create backup directories, install maintainer editor/MCP/FastMCP tooling, run `npx skills`, or copy supaschema source/test infrastructure into the consumer project. If init reports skipped agent-bundle files or hook config, review `node_modules/supaschema/agent-bundle/INSTALL.md`, repair the skipped surface, then rerun `supaschema init`.

## First Tasks After Install

1. Inspect `.supaschema/install.json` first when it exists.
2. If `.supaschema/install.json` has `pathConfirmationNeeded: true`, stop before diffing or validation. Read `agentInstructions`, choose the owning path values from `candidates.schemaPaths` and `candidates.migrationsDirs`, then create or update `supaschema.config.json` with explicit `schemaPaths`, `sources.to`, and `migrationsDir`; `config validate`, `doctor`, and zero-source `diff` block until those fields are explicit.
3. If no pending install manifest exists, inspect `supaschema.config.json`.
4. For Supabase projects, use the configured Supabase CLI runner and the existing Supabase project link/authentication lane. For other PostgreSQL providers, use detected existing database URL environment variable names in `sync.targets` when present.
5. Run `<local-runner> --version`.
6. Run `<local-runner> config validate --json` after config exists or paths are confirmed.
7. If init reports skipped agent-bundle files or hook config, read `node_modules/supaschema/agent-bundle/INSTALL.md`, repair the skipped surface, then rerun `<local-runner> init`.

## Schema Change Workflow

For schema changes, edit only the configured declarative SQL tree from `schemaPaths`. Then run the one-command workflow:

```bash
<local-runner> sync
```

`sync` owns the full reconcile path: diff, target selection, migration-history reconciliation, check, generated contracts, stage, safety gates, verify, selected-runner apply, and final reconciliation or dry-run reporting. Bare `sync` selects at most one `sync.targets.<name>` entry with `mode: "auto"`; multiple automatic targets are refused because cross-target apply is not atomic.

If installed hooks are trusted and fire after a schema-tree write, treat their returned migration name or `SUPA_*` diagnostic as authoritative. If they do not fire, run the commands manually.

Generated migrations containing `-- supaschema: lineage` are artifacts. Do not hand-edit them; change the schema tree and regenerate.

Use `<local-runner> diff`, `<local-runner> check`, `<local-runner> types`, `<local-runner> stage`, or `<local-runner> apply` only when the user asks for that focused lane. Do not run `<local-runner> sync --target <name>` unless the user explicitly asks to override target selection. Never set a remote approval variable on the user's behalf.

## Completion Report

When reporting installation or setup, summarize:

- package install or `init` command used;
- whether config exists and which schema/migration paths are configured;
- whether path confirmation is pending;
- `<local-runner> --version` result;
- `<local-runner> config validate --json` result or why it was not run;
- the next schema-change command.

Do not include internal supaschema source checkout details, internal fixture diff output, or package development test output unless the user asked to work on supaschema itself.
