---
name: code-atlas
description: Build and query the local Code Atlas before broad ownership, dependency, route, API, DB, worker, generated-surface, deploy, delete, rename, or move claims.
user-invocable: true
metadata:
  keywords:
    - code atlas
    - code map
  file-triggers:
    - scripts/code-atlas/**
    - scripts/guards/check-code-atlas.mjs
---

# Code Atlas Workflow

Code Atlas is the local, deterministic repo graph. It is scratch output under `.tmp/` and must not be committed. Normal queries refresh the graph before answering; use `--no-rebuild` only when intentionally reading the cached scratch file.

Before any broad owner, route, consumer, dependency, database, API, worker, generated-surface, or deploy claim, or before any delete, rename, or move:

1. Run the cheapest query that answers the next step: `pre-edit <target>` for first-touch edits, `trace-change <target>` for broader work planning, or `regression-scope [filter]` before choosing final regression guards.
2. Use `impact`, `consumers`, `file-owners`, `entrypoints`, `health`, `health --strict`, and `validate-coverage` as follow-up probes when the first query exposes risk.
3. Use cclsp for exact symbol behavior on the owner files returned by the atlas.
4. Read the source files before making a behavioral claim.

Live Code Atlas MCP output can supplement this flow, but it never replaces the local atlas, cclsp, and source as proof. `npx` fallback for the live tier requires explicit `CODEATLAS_MCP_ALLOW_NPX=1`.

If a change updates a source of atlas truth, update `scripts/code-atlas/build.mjs`, `scripts/code-atlas/build-python.py`, `scripts/code-atlas/lib/**`, `scripts/code-atlas/query.mjs`, `scripts/code-atlas/mcp-wrapper.mjs`, and `scripts/guards/check-code-atlas.mjs` together.

See:

- `references/query-contract.md`
- `references/mcp-tool-map.md`
