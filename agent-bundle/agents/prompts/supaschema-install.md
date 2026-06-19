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

For workspaces, `cd` into the owning member package before install and setup unless the workspace root owns `supaschema.config.json` and the schema workflow. Dependency-targeting flags can update a member manifest while `supaschema init` still writes setup files in the command's current directory. With pnpm, `pnpm add supaschema` targets the package in the current directory; use `pnpm add -w supaschema` only when the workspace root owns the schema workflow.

## Install Command

| Manager | First install | Setup |
| --- | --- | --- |
| npm | `npm install supaschema` | `npm exec -- supaschema init` |
| pnpm | `pnpm add supaschema` | `pnpm exec supaschema init` |
| Yarn | `yarn add supaschema` | `yarn exec supaschema init` |
| Bun | `bun add supaschema` | `bunx --no-install supaschema init` |

Use the matching local runner for every command after install:

| Manager | Local runner |
| --- | --- |
| npm | `npm exec -- supaschema <cmd>` |
| pnpm | `pnpm exec supaschema <cmd>` |
| Yarn | `yarn exec supaschema <cmd>` |
| Bun | `bunx --no-install supaschema <cmd>` |

Always run the matching explicit setup command from the owning package directory after install. The command is idempotent and leaves existing config intact. Default `supaschema init` combines the consuming repo's detected package manager, workspace owner, provider markers, schema paths, and migration paths with the packaged config contract only. It does not install active AI-agent rules, hooks, skills, prompts, or settings. When the user explicitly approves AI-agent enforcement, `<local-runner> init --agent-bundle` installs the reviewed raw bundle, preserves existing hook entries, appends missing supaschema hook entries at the end of the relevant event array, and refreshes the managed agent surfaces.

```bash
npm exec -- supaschema init
pnpm exec supaschema init
yarn exec supaschema init
bunx --no-install supaschema init
```

Use `<local-runner> init --dry-run --json` when you need to preview setup before writing files.

## What Install Provides

The package provides:

- the `supaschema` CLI and typed ESM library exports;
- PostgreSQL parser/deparser runtime dependencies;
- `supaschema-config.schema.json` for editor and config validation;
- raw AI-agent rules, hooks, skills, prompts, and settings under `node_modules/supaschema/agent-bundle/`.

Public docs and examples are hosted in the supaschema documentation and source repository. They are not part of the normal `node_modules/supaschema` install payload, and you should not clone the source repository just to read them during consumer setup.

Default `supaschema init` writes or merges these project files into the consuming repo:

- `supaschema.config.json` when the project does not already have one;
- configured schema and migration directories;
- `.supaschema/install.json` only when detected paths need confirmation.

Install does not edit schema files, generate migrations, connect to a database, apply migrations, write real database credentials, create duplicate supaschema-only database credential files, install active AI-agent rules/hooks/skills/settings by default, install maintainer editor/MCP/FastMCP tooling, run `npx skills`, or copy supaschema source/test infrastructure into the consumer project. To install AI-agent enforcement on demand, review `node_modules/supaschema/agent-bundle/INSTALL.md` and run `<local-runner> init --agent-bundle` only when the user approves the bundle.

## First Tasks After Install

1. Inspect `supaschema.config.json`.
2. If `.supaschema/install.json` exists and has `pathConfirmationNeeded: true`, stop before diffing. Ask the user which detected schema and migration paths to use, then update `supaschema.config.json` with explicit `schemaPaths`, `sources.to`, and `migrationsDir`; `config validate`, `doctor`, and zero-source `diff` block until those fields are explicit.
3. For Supabase projects, use the configured Supabase CLI runner and the existing Supabase project link/authentication lane. For other PostgreSQL providers, use detected existing database URL environment variable names in `sync.targets` when present.
4. Run `<local-runner> --version`.
5. Run `<local-runner> config validate --json` after config exists or paths are confirmed.
6. If the user asks for AI-agent enforcement, read `node_modules/supaschema/agent-bundle/INSTALL.md`, then install the raw agent bundle on demand.

## Schema Change Workflow

For schema changes, edit only the configured declarative SQL tree from `schemaPaths`. Then run:

```bash
<local-runner> diff
<local-runner> check
```

If installed hooks are trusted and fire after a schema-tree write, treat their returned migration name or `SUPA_*` diagnostic as authoritative. If they do not fire, run the commands manually.

Generated migrations containing `-- supaschema: lineage` are artifacts. Do not hand-edit them; change the schema tree and regenerate.

Use bare `<local-runner> sync` for the configured workflow. Do not run `<local-runner> sync --target <name>` unless the user explicitly asks to override target selection. `sync.targets.<name>.mode` decides automatic target selection. Never set a remote approval variable on the user's behalf.

## Completion Report

When reporting installation or setup, summarize:

- package install or `init` command used;
- whether config exists and which schema/migration paths are configured;
- whether path confirmation is pending;
- `<local-runner> --version` result;
- `<local-runner> config validate --json` result or why it was not run;
- the next schema-change command.

Do not include internal supaschema source checkout details, internal fixture diff output, or package development test output unless the user asked to work on supaschema itself.
