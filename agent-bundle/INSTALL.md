# Supaschema Agent Bundle

This package ships raw AI-agent context files here for review and opt-in manual installation. `supaschema init` does not install these files.

## Default

Run normal setup first:

```bash
supaschema init
supaschema config validate --json
```

This creates or repairs `supaschema.config.json`, configured schema directories, configured migration directories, canonical `supaschema:*` package scripts when `package.json` exists, and path-confirmation state when needed. It does not write `.agents`, `.claude`, `.codex`, `AGENTS.md`, or `CLAUDE.md`.

## Install On Demand

Install these files only after the user asks for AI-agent enforcement or approves the bundle.

Copy the shared files:

- `agent-bundle/agents/prompts/supaschema-install.md` to `.agents/prompts/supaschema-install.md`
- `agent-bundle/agents/skills/supaschema` to `.agents/skills/supaschema`

For Claude, copy these files:

- `agent-bundle/claude/rules/supaschema.md` to `.claude/rules/supaschema.md`
- `agent-bundle/claude/skills/supaschema` to `.claude/skills/supaschema`
- `agent-bundle/claude/hooks/guards/bash-policy-checks.mjs` to `.claude/hooks/guards/bash-policy-checks.mjs`
- `agent-bundle/claude/hooks/sync-llm-on-claude-surface-change.mjs` to `.claude/hooks/sync-llm-on-claude-surface-change.mjs`
- the matching `agent-bundle/claude/settings.<manager>.json` entries into `.claude/settings.json`

For Codex, copy these files:

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

After opt-in installation, run the consumer repo's context checks when they exist:

```bash
pnpm run claude:check
pnpm run rules:check
pnpm run skills:check
```

If those commands do not exist, run:

```bash
supaschema config validate --json
supaschema --version
```
