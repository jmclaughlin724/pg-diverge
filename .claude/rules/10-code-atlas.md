---
description: Code Atlas repo graph ownership, commands, proof standard, and MCP/local atlas split.
paths:
  - "scripts/code-atlas/**"
  - "scripts/guards/code-atlas/**"
  - ".codeatlas*/**"
---

# Rule 10 — Code Atlas repo graph

## Contract

This rule owns the deterministic repo-wide Code Atlas graph and proof standard used before broad owner, route, dependency, DB, API, worker, generated-surface, or rollout claims.

Code Atlas is the canonical repo-wide graph for agents. Use it to map owners, routes, imports, consumers, package edges, DB objects, DB policies, API routers, worker jobs, generated surfaces, and deploy surfaces before broad source claims or multi-surface edits.

For codebase and repo research, make Code Atlas or the `supaschema` repo MCP the first move before broad shell searches or source walks. Known-file reads are fine when the target is already explicit; ownership, dependency, consumer, route, DB, API, worker, generated-surface, or rollout claims still require Code Atlas/cclsp/source evidence before reporting.

The repo uses a two-tier Code Atlas model. `scripts/code-atlas/**` is the deterministic local-only atlas and remains outside the public package surface. CodeAtlas-Live is an optional MCP/editor accelerator for live context packs, impact analysis, health reports, and snapshot queries when installed; use the public docs at `https://www.codeatlas.live/docs`, the VS Code Marketplace listing `codeatlaslive.codeatlas-live`, and the npm package `@codeatlas/mcp` as the upstream reference surfaces. The live tier is never authoritative, and `npx` fallback requires explicit `CODEATLAS_MCP_ALLOW_NPX=1`.

## Canonical commands

- `node scripts/code-atlas/build.mjs` regenerates `.tmp/code-atlas/atlas.json`.
- `node scripts/code-atlas/query.mjs <kind> <value> --json` answers focused graph questions and refreshes the graph before answering. Use `--no-rebuild` only when intentionally reading the scratch cache.
- Use `pre-edit <target>` as the cheap first-touch edit query, `trace-change <target>` as the wider agent work pack, and `regression-scope [filter]` to derive verification scope from the actual changed-file set.
- Use `impact`, `consumers`, `file-owners`, `entrypoints`, `health`, `health --strict`, `validate-coverage`, and `mcp-status` for follow-up probes.
- `node scripts/code-atlas/query.mjs mcp-status --json` reports optional CodeAtlas-Live MCP availability without requiring the editor extension or `npx` in CI.
- `node scripts/code-atlas/query.mjs health --strict --json` reports atlas health and coupling risks.

The generated `.tmp/code-atlas/atlas.json` file is scratch output. `.codeatlas/` is local graph-cache state when an editor or MCP-backed tool creates it. Do not commit or hand-edit either surface.

## Required use

Run Code Atlas before:

- starting codebase or repo research that would otherwise require broad `rg`, `find`, directory walks, or cross-surface source inspection
- claiming module/export ownership, consumers, or generated-surface provenance
- deleting, moving, privatizing, or renaming exported files, package subpaths, route files, generated surfaces, API routers, worker commands, DB objects, or DB policies
- estimating blast radius across `src/`, `services/agent-mcp/`, `scripts/`, `bin/`, or `tests/`
- replacing broad `rg` source hunts with an agent-facing entry point
- preparing task lists, implementation waves, or review scopes that depend on exact owners, dependencies, consumers, or generated outputs

When an MCP client needs code-map access, use `supaschema.code_atlas_query` for the same fixed query shape as the local CLI. Do not add or auto-install a standalone `codeatlas` MCP server in repo config. Rule 11 owns the local MCP wiring; this rule owns the Code Atlas query contract and proof standard. Reproduce plan-owned inventory with the local atlas before editing or reporting final scope.

When an MCP client needs repo-context reads or search, use the `supaschema` repo MCP before broad manual file scanning. The MCP path is a context-gathering accelerator; direct source reads remain the final proof for behavior and text-sensitive claims.

Use cclsp for precise symbol navigation and diagnostics after Code Atlas has identified the likely owner files. Use direct source reads for the final claim.

## What Code Atlas must include

`scripts/code-atlas/build.mjs` composes:

- TypeScript AST imports, resolved files, exported symbols, file-reference literals, package-script file consumers, and generated Database type consumers
- Postgres schema declarations and row-level security policies from the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`)
- Python AST module, import, FastMCP server evidence, and subprocess/file-reference consumers from `services/agent-mcp`
- Fingerprint metadata (`cacheFormat`, `schemaVersion`, `metadata.inputDigest`, `metadata.gitHead`) and `summary.byKind` / `summary.byEdgeType`

Do not replace this with a hosted-only index. External graph tools may supplement investigation, but repo-local decisions must be reproducible from the atlas, cclsp, manifests, and source in this repository.

## Enforcement

- `scripts/code-atlas/**` is ignored by git and protected by the public-surface guard as local-only maintainer tooling.
- `npm run guard:code-atlas` runs the local atlas checks when `scripts/code-atlas/build.mjs` exists. In a clean public checkout where `scripts/code-atlas/**` is absent by design, the guard MUST emit `CODE_ATLAS_SKIPPED_LOCAL_ONLY` and pass.
- Rule 11 owns the local MCP registry wiring for Code Atlas access; this rule owns the graph build/query guard and CodeAtlas-Live diagnostic launcher contract.
- Changes to tracked Code Atlas behavior must update the same-change owner set: `scripts/code-atlas/build.mjs`, `scripts/code-atlas/build-python.py`, `scripts/code-atlas/lib/**`, `scripts/code-atlas/query.mjs`, `scripts/code-atlas/mcp-launcher.mjs`, and this rule when operator guidance changes. Local maintainer skill overlays such as `.claude/skills/code-atlas/**` and generated `.agents/skills/code-atlas/**` are advisory DX surfaces; refresh them with `npm run sync:llm` when present, but do not make ignored local skills a tracked branch owner.

STOP if a broad owner, route, consumer, DB, API, worker, generated-surface, or rollout claim is made without Code Atlas or cclsp/source evidence; if live MCP output is treated as a final replacement for local atlas/source proof; if generated atlas/cache output is committed; if regex/string heuristics are added where AST/model data is available; or if the atlas guard is weakened instead of fixing the graph source. Do not use CodeAtlas-Live AI review/fix tools unless the user explicitly approves external LLM calls, API spend, and data exposure.

## Verification

Run `node scripts/code-atlas/build.mjs`, the relevant `node scripts/code-atlas/query.mjs <kind> <value> --json`, and `node scripts/code-atlas/query.mjs health --strict --json` after graph behavior changes. Use cclsp/direct reads after the atlas narrows the worklist. Public clean-checkout verification is `npm run guard:code-atlas` returning `CODE_ATLAS_SKIPPED_LOCAL_ONLY`.

## Failure behavior

Fix the local atlas builder/query path. Do not commit `.tmp/code-atlas` or `.codeatlas`, replace the local atlas with hosted output, or treat live MCP output as final proof.

## Done means

Broad claims cite local atlas/cclsp/source evidence, generated graph output remains scratch, tracked atlas changes include builder, query, and rule updates when guidance changed, and local skill overlays are refreshed only when present.
