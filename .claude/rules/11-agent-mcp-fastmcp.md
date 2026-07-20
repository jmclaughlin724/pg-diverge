---
description: Repo-local FastMCP agent server contract, read-only tool surface, deny-list, and alignment checks.
paths:
  - "services/agent-mcp/**"
  - "fastmcp.json"
  - ".mcp.json"
  - ".codex/config.toml"
  - "scripts/guards/fastmcp/**"
---

# Rule 11 — Agent MCP FastMCP

## Contract

This rule owns the repo-local FastMCP agent server surface: local stdio, read-only, no credential reads, no shell or mutation authority, and alignment across MCP config, server code, tests, and guards.

Repo-local agent MCP servers are governed surfaces, not throwaway helpers.

- `supaschema` is the canonical supaschema FastMCP server (`services/agent-mcp`, package `supaschema-agent-mcp`) for local repo-agent context. It stays read-only and local stdio.
- `supaschema` may expose whatever local read-only tools the server owns. The guard does not freeze the tool count or require a hard-coded catalog. Current core capabilities include `server_status`, Code Atlas access, discoverable Code Atlas affordance tools, repo context reads/search, local safety scan, and session-state inspection. Rule 10 owns the Code Atlas query contract; affordance tools must delegate to fixed local query kinds instead of adding a second graph engine. Repo context tools must read/search non-secret repo files on a **deny-list** model (AGENTS instructions, rules, skills, source, schemas, tooling config) and return nearest agent instructions when supported. Safety-scan tools must run read-only `supaschema scan` through fixed argv (`node dist/cli.js scan --reporter json`, input-validated, no DB, no mutation). Session-state tools may read the local agent-hook ledger without exposing writes. Secrets/credentials (`.env*`, `*.key`/`*.pem`/`*.p12`/`*.pfx`, `secrets/`), `.git`, caches/build output, and archived `plans/` stay blocked. No tool may expose raw SQL, arbitrary shell execution, DB/API mutation, credential reads, external LLM calls, or proxy calls to other MCP servers.
- `fastmcp.json`, `.mcp.json`, `.codex/config.toml`, `.claude/settings.json`, `services/agent-mcp/supaschema_agent_mcp/server.py`, `services/agent-mcp/tests/`, and `scripts/guards/fastmcp/check-fastmcp-agent.mjs` must stay aligned. Local Code Atlas access is exposed only through `supaschema`, not a standalone `codeatlas` MCP entry; `supaschema-docs` remains the separate remote/public Mintlify docs MCP. The capability index the server advertises must match the docs/research MCP servers actually configured in `.mcp.json`.
- `services/agent-mcp/**` is ignored as local maintainer tooling. `npm run guard:fastmcp` runs the full alignment check when the server exists. In a clean public checkout where the server is absent by design, the guard MUST emit `FASTMCP_AGENT_SKIPPED_LOCAL_ONLY` and pass.
- Use the FastMCP client CLI for local smoke checks: `npm run fastmcp:inspect`, `npm run fastmcp:list`, and `npm run fastmcp:status`. Use `fastmcp discover` only for local operator diagnostics because it can read user-level MCP client configs.
- Do not treat MCP output as final proof for repo decisions. `supaschema` shortens context gathering; repo guards, focused tests, local Code Atlas queries, cclsp, and source reads remain the reproducible evidence.

The detailed implementation and verification owner is `.claude/skills/fastmcp/SKILL.md` and `services/agent-mcp/supaschema_agent_mcp/server.py`.

STOP if `supaschema` gains write authority, raw command execution, secret/credential reads, reads outside the repository root, or unguarded client wiring; if FastMCP surfaces drift without `npm run sync:llm`; or if a FastMCP change ships without `npm run guard:fastmcp`, `npm run guard:agent`, and the relevant Python checks (Rule 04).

## Verification

After FastMCP server, MCP config, capability index, deny-list, or client CLI changes, run:

```bash
npm run guard:fastmcp
npm run guard:agent
npm run py:typecheck
npm run py:test
npm run fastmcp:status
```

Use `npm run fastmcp:list` or `npm run fastmcp:inspect` for smoke checks. Public clean-checkout verification is `npm run guard:fastmcp` returning `FASTMCP_AGENT_SKIPPED_LOCAL_ONLY`.

## Failure behavior

Restore read-only, repo-root-contained behavior. Do not expose writes, raw SQL, shell execution, credential reads, external LLM calls, or proxy calls to other MCP servers.

## Done means

FastMCP surfaces, config, capability index, tests, and guards agree; the server remains local, read-only, and non-secret.
