# Rule 10 — Code Atlas repo graph

Code Atlas is the canonical repo-wide graph for agents. Use it to map owners, routes, imports, consumers, package edges, DB objects, DB policies, API routers, worker jobs, generated surfaces, and deploy surfaces before broad source claims or multi-surface edits.

The repo uses a two-tier Code Atlas model. `scripts/code-atlas/**` is the deterministic, guard-enforced atlas. CodeAtlas-Live is an optional MCP/editor accelerator for live context packs, impact analysis, health reports, and snapshot queries when installed; use the public docs at `https://www.codeatlas.live/docs`, the VS Code Marketplace listing `codeatlaslive.codeatlas-live`, and the npm package `@codeatlas/mcp` as the upstream reference surfaces.

## Canonical commands

- `npm run code-atlas:build` regenerates `.tmp/code-atlas/atlas.json`.
- `npm run code-atlas:query <kind> <value>` answers focused graph questions. Use `pre-edit`, `impact`, `entrypoints`, `health`, and `mcp-status` for agent workflows.
- `npm run code-atlas:mcp:status` reports optional CodeAtlas-Live MCP availability without requiring the editor extension in CI.
- `npm run guard:code-atlas` runs the acceptance probes that keep the graph useful.

The generated `.tmp/code-atlas/atlas.json` file is scratch output. `.codeatlas/` is local graph-cache state when an editor or MCP-backed tool creates it. Do not commit or hand-edit either surface.

## Required use

Run Code Atlas before:

- claiming module/export ownership, consumers, or generated-surface provenance
- deleting, moving, privatizing, or renaming exported files, package subpaths, route files, generated surfaces, API routers, worker commands, DB objects, or DB policies
- estimating blast radius across `src/`, `services/agent-mcp/`, `scripts/`, `bin/`, or `tests/`
- replacing broad `rg` source hunts with an agent-facing entry point
- preparing task lists, implementation waves, or review scopes that depend on exact owners, dependencies, consumers, or generated outputs

When an MCP client needs code-map access, use `supaschema.code_atlas_query` for the same fixed query shape as the local CLI. Rule 11 owns the local MCP wiring; this rule owns the Code Atlas query contract and proof standard. Reproduce plan-owned inventory with the local atlas before editing or reporting final scope.

Use cclsp for precise symbol navigation and diagnostics after Code Atlas has identified the likely owner files. Use direct source reads for the final claim.

## What Code Atlas must include

`scripts/code-atlas/build.mjs` composes:

- TypeScript AST imports, resolved files, exported symbols, and generated Database type consumers
- Postgres schema declarations and row-level security policies from the configured declarative SQL tree (`schemaPaths` in `supaschema.config.json`)
- Python AST module, import, and FastMCP server evidence from `services/agent-mcp`

Do not replace this with a hosted-only index. External graph tools may supplement investigation, but repo-local decisions must be reproducible from the atlas, cclsp, manifests, and source in this repository.

## Enforcement

- `scripts/guards/check-code-atlas.mjs` is part of `npm run guard` through `scripts/guards/check-all.mjs`.
- lefthook runs `npm run guard:code-atlas` before commit.
- Rule 11 owns the local MCP registry wiring for Code Atlas access; this rule owns the graph build/query guard and CodeAtlas-Live diagnostic wrapper contract.
- Changes to Code Atlas behavior must update `scripts/code-atlas/AGENTS.md`, `.claude/skills/code-atlas/**`, and this rule when operator guidance changes.

STOP if a broad owner, route, consumer, DB, API, worker, generated-surface, or rollout claim is made without Code Atlas or cclsp/source evidence; if live MCP output is treated as a final replacement for local atlas/source proof; if generated atlas/cache output is committed; or if the atlas guard is weakened instead of fixing the graph source. Do not use CodeAtlas-Live AI review/fix tools unless the user explicitly approves external LLM calls, API spend, and data exposure.
