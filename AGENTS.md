# Agent route map

This file is the repository instruction entrypoint and route map. Durable operator policy lives in `.claude/rules/**`; closer scoped `AGENTS.md` files add local context for their directories.

## Instruction scope

- Follow all higher-priority instructions and any closer scoped `AGENTS.md`.
- Follow the latest user direction while preserving earlier requirements that do not conflict.
- Do not ask for information already available in the active context.

## Rule owners

- Operating discipline, gates, `$elegant`, enforcement closure, npm-only toolchain, and closeout: `.claude/rules/01-operating-rules.md`
- Migration and generated-surface policy: `.claude/rules/supaschema.md`
- Code Atlas graph proof standard: `.claude/rules/10-code-atlas.md`
- Agent MCP/FastMCP surface: `.claude/rules/11-agent-mcp-fastmcp.md`
- Package and public consumer boundary: `.claude/rules/13-npm-package-boundary.md`
- Worktree and git operations: `.claude/rules/14-editing-worktree-git.md`
- Context-surface source of truth: `.claude/rules/18-context-surface-sync.md`
- Agent-surface sync ownership: `.claude/rules/22-agent-surface-sync-ownership.md`

## Code map

Use Code Atlas when Rule 10 requires it: broad owner, route, consumer, dependency, DB, API, worker, generated-surface, rollout, delete, move, rename, or implementation-wave claims that depend on exact ownership. Use `node scripts/code-atlas/query.mjs` and the project MCP `supaschema` tools when they materially improve grounding. When local `scripts/code-atlas/**` exists, rebuild with `node scripts/code-atlas/build.mjs` after changing indexed source or agent guidance.

## Agent surfaces

`.claude/**` is the canonical maintainer authoring surface for rules, skills, hooks, and agents. `.agents/**` and `.codex/**` are generated or native runtime targets only where Rule 18 or Rule 22 names them as owners. Do not hand-edit generated mirrors as policy owners.

For hook, context, rule, sync, generated-surface, or package-template changes, include the enforcement closure ledger required by Rule 01 in the task record or closeout: rule owner, runtime or hook path, guard, focused test or validation, generated mirrors, consumer or package disposition, and Claude/Codex disposition.

## Public package

`README.md` is the npm package landing page, `docs/**` is the Mintlify site, and `skills/supaschema` is the only public `npx skills` source. The published npm package boundary is the `package.json` `files` allowlist and Rule 13.
