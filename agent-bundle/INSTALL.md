# Supaschema Agent Bundle

This package ships the AI-agent enforcement files that `supaschema init` installs into the consuming repo by default. Use this file to audit what was installed or to repair files that init reported as skipped.

## Default

Run normal setup first:

```bash
supaschema init
```

This creates or repairs `supaschema.config.json`, configured schema directories, configured migration directories, canonical `supaschema:*` package scripts when `package.json` exists, active `.agents`, `.claude`, and `.codex` enforcement surfaces, and path-confirmation state only when multiple detected paths still need an agent or operator to choose the owning schema and migration directories. Supabase inventory or `_bootstrap` projects still receive a working config, with schema diff and migration sync set to manual workflow policy. It does not write `AGENTS.md` or `CLAUDE.md`.

If `.supaschema/install.json` exists and says `pathConfirmationNeeded: true`, follow its `agentInstructions`, choose the owning paths from the detected candidates, and create or update `supaschema.config.json` with explicit `schemaPaths`, `sources.to`, and `migrationsDir`. After config exists, run:

```bash
supaschema config validate --json
```

## Installed Surfaces

`supaschema init` installs missing text files and merges hook registration JSON. Existing non-identical text files are preserved and listed in the init result. Existing malformed or non-mergeable hook JSON is skipped and listed so the agent can repair it.

Shared files:

- `agent-bundle/agents/prompts/supaschema-install.md` to `.agents/prompts/supaschema-install.md`
- `agent-bundle/agents/skills/supaschema` to `.agents/skills/supaschema`

Claude files:

- `agent-bundle/claude/rules/supaschema.md` to `.claude/rules/supaschema.md`
- `agent-bundle/claude/skills/supaschema` to `.claude/skills/supaschema`
- `agent-bundle/claude/hooks/guards/bash-policy-checks.mjs` to `.claude/hooks/guards/bash-policy-checks.mjs`
- `agent-bundle/claude/hooks/sync-llm-on-claude-surface-change.mjs` to `.claude/hooks/sync-llm-on-claude-surface-change.mjs`
- the matching `agent-bundle/claude/settings.<manager>.json` entries into `.claude/settings.json`

Codex files:

- `agent-bundle/codex/rules/supaschema.rules` to `.codex/rules/supaschema.rules`
- `agent-bundle/codex/hooks/general-guard.mjs` to `.codex/hooks/general-guard.mjs`
- `agent-bundle/codex/hooks/guards/bash-policy-checks.mjs` to `.codex/hooks/guards/bash-policy-checks.mjs`
- `agent-bundle/codex/hooks/sync-llm-on-claude-surface-change.mjs` to `.codex/hooks/sync-llm-on-claude-surface-change.mjs`
- the matching `agent-bundle/codex/hooks.<manager>.json` entries into `.codex/hooks.json`

Use the package manager that owns the project:

- npm: `settings.npm.json` and `hooks.npm.json`
- pnpm: `settings.pnpm.json` and `hooks.pnpm.json`
- Yarn: `settings.yarn.json` and `hooks.yarn.json`
- Bun: `settings.bun.json` and `hooks.bun.json`

Merge JSON files. Do not overwrite existing user hooks or settings. Do not register duplicate direct hooks. If the project already owns a Codex dispatcher such as `.codex/hooks/tool-gate.mjs` or `.codex/hooks/stop.mjs`, keep the dispatcher as the owner and route supaschema checks through that dispatcher instead of registering duplicate direct hooks.

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
