---
name: code-atlas
description: Build and query the local Code Atlas before broad ownership, dependency, route, API, DB, worker, generated-surface, deploy, delete, rename, or move claims.
user-invocable: true
---

# Code Atlas Workflow

Code Atlas is the local, deterministic repo graph. It is scratch output under `.tmp/` and must not be committed. Normal queries refresh the graph before answering; use `--no-rebuild` only when intentionally reading the cached scratch file.

Before any broad owner, route, consumer, dependency, database, API, worker, generated-surface, or deploy claim, or before any delete, rename, or move:

1. Query the relevant owner with `npm run code-atlas:query -- <kind> <value> --json` or `node scripts/code-atlas/query.mjs <kind> <value> --json`.
2. Prefer `trace-change`, `pre-edit`, `impact`, `consumers`, `file-owners`, `entrypoints`, `health`, and `validate-coverage` for agent workflow setup.
3. Use cclsp for exact symbol behavior on the owner files returned by the atlas.
4. Read the source files before making a behavioral claim.

Live Code Atlas MCP output can supplement this flow, but it never replaces the local atlas, cclsp, and source as proof. `npx` fallback for the live tier requires explicit `CODEATLAS_MCP_ALLOW_NPX=1`.

If a change updates a source of atlas truth, update `scripts/code-atlas/build.mjs`, `scripts/code-atlas/build-python.py`, `scripts/code-atlas/lib/**`, `scripts/code-atlas/query.mjs`, `scripts/code-atlas/mcp-wrapper.mjs`, and `scripts/guards/check-code-atlas.mjs` together.

See:

- `references/query-contract.md`
- `references/mcp-tool-map.md`
