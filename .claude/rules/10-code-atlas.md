---
description: Code Atlas repo graph ownership, commands, proof standard, and MCP/local atlas split.
paths:
  - "scripts/code-atlas/**"
  - "scripts/guards/code-atlas/**"
---

# Rule 10 — Code Atlas repo graph

## Contract

This rule owns the deterministic repo-wide Code Atlas graph and proof standard used before broad owner, route, dependency, DB, API, worker, generated-surface, or rollout claims.

Code Atlas is the canonical repo-wide graph for agents. Use it to map owners, routes, imports, consumers, package edges, DB objects, DB policies, API routers, worker jobs, generated surfaces, and deploy surfaces before broad source claims or multi-surface edits.

For codebase and repo research, make Code Atlas or the `supaschema` repo MCP the first move before broad shell searches or source walks. Known-file reads are fine when the target is already explicit; ownership, dependency, consumer, route, DB, API, worker, generated-surface, or rollout claims still require Code Atlas/cclsp/source evidence before reporting.

Supaschema uses one Code Atlas model: `scripts/code-atlas/**` is deterministic, local-only maintainer tooling outside the public package. There is no browser, daemon, editor extension, hosted review path, snapshot SQL surface, upstream MCP registration, or runtime package. Do not add one as a second graph owner.

Code Atlas consumes repository path policy from `scripts/lib/repo-files.mjs`. That shared module, not Code Atlas, owns the local file inventory, active-local formatter paths, and deny segments. Rule 11 and the FastMCP guard own local MCP registry/client alignment. Do not recreate either map in the Atlas builder, query, or guard.

The canonical change workflow lives in `.claude/skills/code-atlas/references/change-workflows.md`. It defines local pre-edit context, regression prioritization, host review, targeted repository resources, and Supaschema safety/session closeout. Only the local CLI or `mcp__supaschema__code_atlas_query` records authoritative `code-atlas-query` evidence.

## Canonical commands

- `node scripts/code-atlas/build.mjs` regenerates `.tmp/code-atlas/atlas.json`.
- `node scripts/code-atlas/query.mjs <kind> <value> --json` answers focused graph questions and refreshes the graph before answering. Use `--no-rebuild` only when intentionally reading the scratch cache.
- Use `pre-edit <target>` as the cheap first-touch edit query, `trace-change <target>` as the wider agent work pack, and `regression-scope [filter]` to derive verification scope from the actual changed-file set.
- Use `impact`, `consumers`, `file-owners`, `entrypoints`, `health`, `health --strict`, and `validate-coverage` for follow-up probes.
- `validate-coverage` checks graph metadata, graph/package ownership, and stale guidance; it does not validate MCP client configuration.
- `node scripts/code-atlas/query.mjs health --strict --json` reports atlas health and coupling risks.

The generated `.tmp/code-atlas/atlas.json` file is scratch output. Do not commit or hand-edit it.

## Required use

Run Code Atlas before:

- starting codebase or repo research that would otherwise require broad `rg`, `find`, directory walks, or cross-surface source inspection
- claiming module/export ownership, consumers, or generated-surface provenance
- deleting, moving, privatizing, or renaming exported files, package subpaths, route files, generated surfaces, API routers, worker commands, DB objects, or DB policies
- estimating blast radius across `src/`, `services/agent-mcp/`, `scripts/`, `bin/`, or `tests/`
- replacing broad `rg` source hunts with an agent-facing entry point
- preparing task lists, implementation waves, or review scopes that depend on exact owners, dependencies, consumers, or generated outputs

When an MCP client needs deterministic code-map access, use `supaschema.code_atlas_query` for the same fixed query shape as the local CLI. Rule 11 owns MCP-surface alignment; this rule owns the Code Atlas query contract and proof standard. Use the atlas for graph-derived consumers and impact, not as the owner of local editor/server configuration.

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
- Rule 11 owns alignment between the read-only `supaschema` server and the local query surface; this rule owns the graph build/query guard.
- `scripts/lib/repo-files.mjs` owns repository file inclusion and denial policy; Atlas `lib/files.mjs` must import it rather than maintaining parallel lists.
- Changes to tracked Code Atlas behavior must update the same-change owner set: `scripts/code-atlas/build.mjs`, `scripts/code-atlas/build-python.py`, `scripts/code-atlas/lib/**`, `scripts/code-atlas/query.mjs`, and this rule when operator guidance changes. Refresh local skill overlays with `npm run sync:llm`; never hand-edit generated `.agents` mirrors.

STOP if a broad owner, route, consumer, DB, API, worker, generated-surface, or rollout claim is made without Code Atlas or cclsp/source evidence; if a browser, daemon, editor extension, hosted review path, snapshot SQL surface, upstream MCP registration, or runtime package is reintroduced; if generated atlas output is committed; if regex/string heuristics replace available AST/model data; or if the Atlas regains an MCP/client-config or duplicate repository-inventory owner; or if the atlas guard is weakened instead of fixing the graph source.

## Verification

Run `node scripts/code-atlas/build.mjs`, the relevant `node scripts/code-atlas/query.mjs <kind> <value> --json`, and `node scripts/code-atlas/query.mjs health --strict --json` after graph behavior changes. Use cclsp/direct reads after the atlas narrows the worklist. Public clean-checkout verification is `npm run guard:code-atlas` returning `CODE_ATLAS_SKIPPED_LOCAL_ONLY`.

## Failure behavior

Fix the local atlas builder/query path. Do not commit `.tmp/code-atlas` or replace the local atlas with hosted output.

## Done means

Broad claims cite local atlas/cclsp/source evidence, generated graph output remains scratch, no second graph runtime or registration exists, tracked atlas changes update their canonical owners, shared repository inventory stays outside Atlas, MCP/client alignment stays with FastMCP, and local skill overlays are synced.
