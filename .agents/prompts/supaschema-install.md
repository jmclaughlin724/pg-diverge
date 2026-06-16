# supaschema Agent Install Prompt

Use this prompt when an AI agent is asked to install, initialize, inspect, or use supaschema in a consuming project.

## Role

You are working in the consuming project, not in the supaschema source repository.

Do not clone `jmclaughlin724/supaschema` into the project, run `npm ci` in a nested supaschema checkout, or validate supaschema by running its internal fixture suite unless the user explicitly asks you to develop supaschema itself. For normal use, install the npm package in the target project and work from that project root.

## Install Command

If supaschema is not installed, run this from the project root:

```bash
npm install supaschema
```

If install scripts did not run, or setup needs to be repaired, run:

```bash
npx supaschema init
```

Use `npx supaschema init --dry-run` when you need to preview setup before writing files.

## What Install Provides

The npm package provides:

- the `supaschema` CLI and typed ESM library exports;
- PostgreSQL parser/deparser runtime dependencies;
- `supaschema-config.schema.json` for editor and config validation;
- the shared agent prompt at `.agents/prompts/supaschema-install.md`;
- the supaschema workflow skill at `.agents/skills/supaschema/SKILL.md`;
- the Claude workflow skill at `.claude/skills/supaschema/SKILL.md`;
- Claude rule, skill, and hooks under `.claude/`;
- Codex rule, hook scripts, and hook registration under `.codex/`.

Public docs and examples are hosted in the supaschema documentation and source repository. They are not part of the normal `node_modules/supaschema` install payload, and you should not clone the source repository just to read them during consumer setup.

The installer or `supaschema init` writes or merges these project files:

- `supaschema.config.json` when the project does not already have one;
- configured schema and migration directories;
- `.supaschema/install.json` only when detected paths need confirmation;
- `AGENTS.md` and `CLAUDE.md` managed supaschema guidance blocks;
- `.agents/prompts/supaschema-install.md`;
- `.agents/skills/supaschema/SKILL.md`;
- `.claude/rules/supaschema.md`, `.claude/skills/supaschema/SKILL.md`, and the three supaschema Claude hooks;
- `.claude/settings.json` hook wiring;
- `.codex/rules/supaschema.rules`, the three supaschema Codex hooks, and `.codex/hooks.json`.

Install does not edit schema files, generate migrations, connect to a database, apply migrations, install maintainer editor/MCP/FastMCP tooling, run `npx skills`, or copy supaschema source/test infrastructure into the consumer project. The package scaffold installs the supaschema skill directly into `.agents/skills/supaschema` and `.claude/skills/supaschema`; the public `npx skills` source is only for portable skill context without project setup.

## First Tasks After Install

1. Read the supaschema managed block in `AGENTS.md` or `CLAUDE.md`.
2. Read `.agents/skills/supaschema/SKILL.md` and the matching rule file for the active agent runtime: `.claude/rules/supaschema.md` or `.codex/rules/supaschema.rules`.
3. Inspect `supaschema.config.json`.
4. If `.supaschema/install.json` exists and has `pathConfirmationNeeded: true`, stop before diffing. Ask the user which detected schema and migration paths to use, then update `supaschema.config.json`.
5. Run `npx supaschema --version`.
6. Run `npx supaschema config validate --json` after config exists or paths are confirmed.

## Schema Change Workflow

For schema changes, edit only the configured declarative SQL tree from `schemaPaths`. Then run:

```bash
npx supaschema diff
npx supaschema check
```

If installed hooks are trusted and fire after a schema-tree write, treat their returned migration name or `SUPA_*` diagnostic as authoritative. If they do not fire, run the commands manually.

Generated migrations containing `-- supaschema: lineage` are artifacts. Do not hand-edit them; change the schema tree and regenerate.

Do not run `npx supaschema sync --local` or `npx supaschema sync --remote` unless the user explicitly asks to apply migrations.

## Completion Report

When reporting installation or setup, summarize:

- package install or `init` command used;
- whether config exists and which schema/migration paths are configured;
- whether path confirmation is pending;
- `npx supaschema --version` result;
- `npx supaschema config validate --json` result or why it was not run;
- the next schema-change command.

Do not include internal supaschema source checkout details, internal fixture diff output, or package development test output unless the user asked to work on supaschema itself.
