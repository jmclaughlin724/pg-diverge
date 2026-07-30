# Supaschema Agent Bundle

This package ships the AI-agent enforcement files that `supaschema init` installs into the consuming repo by default. Use this file to audit what was installed or to repair files that init reported as skipped.

## Default

Run normal setup first:

```bash
supaschema init
```

This creates or repairs `supaschema.config.json`, configured schema directories, configured migration directories, canonical `supaschema:*` package scripts when `package.json` exists, active `.agents`, `.claude`, and `.codex` enforcement surfaces, and path-confirmation state only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories. Supabase inventory or `_bootstrap` projects still receive a working config, with schema diff and migration sync set to manual workflow policy. It does not write `AGENTS.md` or `CLAUDE.md`.

The package keeps its complete offline MDX reference under `node_modules/supaschema/agent-bundle/docs/`; start with `docs/index.md`. These documentation files remain inside `node_modules` and are not copied into the consumer project. `skills-manifest.json` is the ordered install inventory for the curated `supaschema` skill.

If `.supaschema/install.json` exists and says `pathConfirmationNeeded: true`, follow its `agentInstructions`, choose the owning paths from the detected candidates, and create or update `supaschema.config.json` with explicit `schemaPaths`, `sources.from`, and `migrationsDir`. After config exists, run:

```bash
supaschema config validate --json
```

## Installed Surfaces

`supaschema init` installs missing text files and merges hook registration JSON. Existing non-identical text files are preserved and listed in the init result. Existing malformed or non-mergeable hook JSON is skipped and listed so the agent can repair it.

On upgrade, init removes retired package-owned surface-sync and general Bash-guard registrations. Byte-identical retired surface-sync scripts are deleted after their registrations are removed; modified scripts and historical Bash-policy files are preserved but left unregistered.

Shared files:

- `agent-bundle/agents/prompts/supaschema-install.md` to `.agents/prompts/supaschema-install.md`
- `agent-bundle/agents/skills/supaschema` recursively to the matching `.agents/skills/**` directories

Claude files:

- `agent-bundle/claude/rules/supaschema.md` to `.claude/rules/supaschema.md`
- `agent-bundle/claude/skills/supaschema` recursively to the matching `.claude/skills/**` directories
- the matching `agent-bundle/claude/settings.<manager>.json` entries into `.claude/settings.json`

Codex files:

- `agent-bundle/codex/rules/supaschema.rules` to `.codex/rules/supaschema.rules`
- the matching `agent-bundle/codex/hooks.<manager>.json` entries into `.codex/hooks.json`

The merged hook settings contain only `supaschema hook generated-artifact-edit` and `supaschema hook schema-write`. The generated-artifact hook protects lineage-marked migrations and the configured `typesFile` / `zodFile`, including bounded Bash write targets, and fails closed when config or hook input cannot be classified; it is not a general shell-policy hook. The repository's general Bash, Git, secret, branch, worktree, and deletion policy is not part of the consumer bundle. No `.codex/skills/**` directory is installed. Existing non-identical Agent or Claude skill files, including references, are preserved and reported individually.

Use the package manager that owns the project:

- npm: `settings.npm.json` and `hooks.npm.json`
- pnpm: `settings.pnpm.json` and `hooks.pnpm.json`
- Yarn: `settings.yarn.json` and `hooks.yarn.json`
- Bun: `settings.bun.json` and `hooks.bun.json`

Merge JSON files. Do not overwrite existing user hooks or settings. Do not register duplicate direct hooks.

## Verify

After installation or repair, run the consumer repo's context checks through the package manager selected above when those scripts exist:

```bash
npm run claude:check
npm run rules:check
npm run skills:check
```

Use the matching `pnpm run`, `yarn run`, or `bun run` prefix for pnpm, Yarn, or Bun projects.

If those commands do not exist, run:

```bash
supaschema config validate --json
supaschema --version
```
