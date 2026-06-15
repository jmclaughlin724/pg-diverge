---
name: upstream
description: "Audit a path, glob, or topic against official upstream sources for supaschema's core stack, then drive the verified DRY/elegant end state."
argument-hint: <path | glob | topic to investigate>
metadata:
  keywords:
    - upstream
    - upstream best practice
    - official docs
    - verified upstream source
  intent-patterns:
    - "upstream.*(?:best.practice|source|docs|standard)"
    - "(?:verify|audit|check).*upstream.*(?:docs|source|best.practice)"
    - "\\$upstream"
---

# Upstream — source-standard architecture audit

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

Audit the target against the actual upstream guidance for supaschema's real stack — Node/TypeScript (ESM, NodeNext), Zod v4, PostgreSQL via `libpg-query`/`pgsql-deparser`, Biome via Ultracite, Vitest, the Python `uv`/`ruff`/`mypy`/FastMCP/Pydantic side-service, Cloudflare Workers, and Mintlify docs — then drive it to that verified DRY `/elegant` end state. There is no Next.js, React, Supabase app, Turborepo, or pnpm in this repo; do not audit against those.

## Target

Use the invocation argument. If none was provided, ask for one path, glob, or topic — do not audit the whole repo by default.

## Mandate

Existing code, placement, naming, and docs describe the _current_ state, not the correct one (root `AGENTS.md`). Verify every best-practice claim against the actual upstream guidance directly **before** proposing or implementing. An unverified assertion is a blocker, not a finding (Rule 05). Source authority order, using the docs MCP servers configured in `.mcp.json`:

- Biome/Ultracite: the `ultracite` MCP, then https://biomejs.dev and https://docs.ultracite.ai.
- Zod: the `zod` MCP, then https://zod.dev.
- Mintlify docs-as-code: the `mintlify` MCP, then https://mintlify.com/docs.
- Cloudflare Workers: the `cloudflare-docs` MCP, then https://developers.cloudflare.com/workers.
- TypeScript / Python symbol behavior: the `cclsp` LSP.
- Node / npm packaging, PostgreSQL (`libpg-query`), Python (`uv`/`ruff`/`mypy`), FastMCP: official docs via `WebSearch`/`WebFetch`; `context7` (`resolve-library-id` → `query-docs`) as a second opinion.
- supaschema's own behavior: the `supaschema-docs` MCP, the project `docs/**`, `AGENTS.md`, and `.claude/rules/*`.
- The installed dependency itself when docs may have drifted.

If the needed MCP is unavailable, find the official website reference for that source first, then use `context7` as a second opinion. Never proceed from repo rules or local code alone.

## Generated types

supaschema **generates** `database.types.ts` and `database.zod.ts` from the declarative SQL tree and source model (`supaschema types`), not from live database introspection or a Supabase typed client (Rule 00 and `.claude/rules/supaschema.md`). When the target involves a DB-backed shape, the declarative tree plus `supaschema types` is the source of truth — do not hand-author or mirror generated shapes.

## Procedure

1. Load only the directly-owning rules + skills for the target surface; use owner MCP/docs lanes for external behavior.
2. Trace with Code Atlas (Rule 10), AST/LSP source inspection, and fixed-string prose evidence — never regex for source classification or mutation planning (Rule 07).
3. Review the full content of every in-scope file, folder, and subfolder before choosing the target shape.
4. Identify intent, dependencies, imports, exports, current consumers, the public package contract (Rule 13 — the `files` allowlist), generated outputs, tests, and owner briefs.
5. Identify gaps, inaccuracies (vs verified source), redundancies, consolidation opportunities, and ownership/organization per `AGENTS.md` and the per-concern rules.
6. Burn down conflicting consumers and imports in the same change instead of adding wrappers, aliases, or compatibility layers.

## Deliverable

Report in the `AGENTS.md` review order (controlling objective → invariants → evidence → conclusion → recommended action). Cite the upstream source per best-practice claim and split verified vs inferred. The recommended action must be owner-scoped and include an explicit `/elegant` DRY end state — not a compatibility patch over a workaround.

## Execution

Implement when the user asks for implementation or accepts a remediation scope. Investigate-and-propose only for explicit audit, recommendation, planning, or diagnosis-only prompts, or when the target owner is genuinely ambiguous. Keep the report task-only.
