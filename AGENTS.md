# supaschema repository map

## Purpose

This file is the root route map for AI agents working in this repository. Apply a closer `AGENTS.md` when one exists. Durable policy lives in `.claude/rules/**`; repeatable workflows live in `.claude/skills/**`; deterministic enforcement lives in hooks, guards, and tests; public product explanation lives in `README.md` and `docs/**`.

supaschema is a Node 22.12+ TypeScript CLI and library that generates deterministic, replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs.

## Project map

| Concern | Owner |
| --- | --- |
| Source code | `src/**` |
| CLI entry points | `src/cli.ts`, `src/cli-diff.ts`, `src/cli-reports.ts`, `src/cli-tools.ts` |
| Library exports | `src/index.ts` |
| Config semantics | `src/config.ts`, `src/config-contract.ts` |
| Generated config artifacts | `supaschema-config.schema.json`, `bin/config-contract.mjs` |
| Tests and fixtures | `tests/**`, `tests/fixtures/**`, `corpus/**` |
| Python FastMCP side service | `services/agent-mcp/**` |
| Public docs | `docs/**`, `README.md` |
| npm package boundary | `package.json#files` |
| Generated build output | `dist/**` |

## Rule map

| Concern | Rule owner |
| --- | --- |
| Compatibility migration pointer | `.claude/rules/00-supaschema.md` |
| Operating discipline | `.claude/rules/01-operating-rules.md` |
| Docs writing and Mintlify components | `.claude/rules/02-mintlify-writing-standards.md`, `.claude/rules/03-mintlify-component-reference.md` |
| Python and FastMCP toolchain | `.claude/rules/04-python-toolchain.md`, `.claude/rules/11-agent-mcp-fastmcp.md` |
| Decision protocol | `.claude/rules/05-decision-protocol.md` |
| Multi-language LSP and formatter ownership | `.claude/rules/06-multi-language-toolchain.md` |
| AST-over-regex | `.claude/rules/07-ast-over-regex.md` |
| Biome and Ultracite | `.claude/rules/08-biome-ultracite-policy.md` |
| CI/CD and release | `.claude/rules/09-ci-cd-efficiency-governance.md` |
| Code Atlas | `.claude/rules/10-code-atlas.md` |
| Hook context and skill loading | `.claude/rules/12-skill-loading-enforcement.md` |
| npm package boundary | `.claude/rules/13-npm-package-boundary.md` |
| Worktree and git safety | `.claude/rules/14-editing-worktree-git.md` |
| Security | `.claude/rules/15-security.md` |
| File size and composition | `.claude/rules/16-file-size-and-composition.md` |
| Prompt and context authoring | `.claude/rules/17-prompt-craft-standards.md`, `.claude/rules/18-context-surface-sync.md` |
| Migration policy | `.claude/rules/supaschema.md` |

## Workflow map

| Workflow | Owner |
| --- | --- |
| supaschema schema-change workflow | `.claude/skills/supaschema/SKILL.md` |
| Code Atlas workflow | `.claude/skills/code-atlas/SKILL.md` |
| FastMCP workflow | `.claude/skills/fastmcp/SKILL.md`, `.claude/skills/fastmcp-client-cli/SKILL.md` |
| Ultracite workflow | `.claude/skills/ultracite/SKILL.md` |
| Agent surface sync | `scripts/skills/sync-llm.mjs` |
| Consumer scaffold | `bin/scaffold.mjs` |

## Command map

Supaschema CLI:

```bash
supaschema diff
supaschema check
supaschema verify
supaschema types
supaschema diff --fail-on-diff --quiet
supaschema diff --summary
supaschema diff --write-hints <file>
supaschema audit --from <source>
supaschema selfcheck
supaschema migrations
supaschema sync
supaschema corpus
```

Repository development:

```bash
npm run check
npm run lint
npm run format
npm run typecheck
npm test
npm run build
npm run check:package
npm run pack:dry
npm run fixture:verify
npm run corpus:check
npm run benchmark
npm run docs:check
npm run guard
```

Python/FastMCP:

```bash
npm run py:format:check
npm run py:lint
npm run py:typecheck
npm run py:test
npm run guard:fastmcp
npm run fastmcp:status
```

## Verification map

| Change area | Usual proof |
| --- | --- |
| Core SQL extraction, planning, rendering, checking, verification, typegen, CLI defaults | Targeted tests plus `npm run typecheck` |
| Package, release, or bundled agent surfaces | `npm run check:package`, `npm run pack:dry`, or `npm pack --dry-run --json` |
| Docs pages, navigation, components, or images | `npm run docs:check` |
| Python or FastMCP surfaces | Python checks plus FastMCP guards |
| Hooks, rules, skills, or context surfaces | `npm run sync:llm`, `npm run hooks:check`, `npm run guard:agent`, or `npm run guard` |
