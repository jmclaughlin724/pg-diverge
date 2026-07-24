---
description: Repo-local FastMCP agent server contract, read-only tool surface, deny-list, and alignment checks.
paths:
  - "services/agent-mcp/**"
  - "fastmcp.json"
  - ".mcp.json"
  - ".codex/config.toml"
  - ".claude/settings.json"
  - "scripts/guards/fastmcp/**"
---

# Rule 11 — Agent MCP FastMCP

## Contract

This rule owns the repo-local FastMCP agent server surface: local stdio, read-only, no credential reads, no shell or mutation authority, and alignment across MCP config, server code, tests, and guards.

Repo-local agent MCP servers are governed surfaces, not throwaway helpers.

- `supaschema` is the canonical supaschema FastMCP server (`services/agent-mcp`, package `supaschema-agent-mcp`) for local repo-agent context. It stays read-only and local stdio.
- `supaschema` may expose whatever local read-only tools the server owns. The guard does not freeze the tool count or require a hard-coded catalog. Current core capabilities include `server_status`, Code Atlas access, discoverable Code Atlas affordance tools, repo context reads/search, local safety scan, and session-state inspection. Rule 10 owns the Code Atlas query contract; affordance tools must delegate to fixed local query kinds instead of adding a second graph engine. Repo context tools must read/search non-secret repo files on a **deny-list** model (AGENTS instructions, rules, skills, source, schemas, tooling config) and return nearest agent instructions when supported. Safety-scan tools must run read-only `supaschema scan` through fixed argv (`node dist/cli.js scan --reporter json`, input-validated, no DB, no mutation). Session-state tools may read the local agent-hook ledger without exposing writes. Secrets/credentials (`.env*`, `*.key`/`*.pem`/`*.p12`/`*.pfx`, `secrets/`), `.git`, caches/build output, and archived `plans/` stay blocked. No tool may expose live-database SQL, SQL mutation, a generic SQL engine, arbitrary shell execution, DB/API mutation, credential reads, external LLM calls, or proxy calls to other MCP servers.
- `fastmcp.json`, `.mcp.json`, `.codex/config.toml`, `.claude/settings.json`, `services/agent-mcp/supaschema_agent_mcp/server.py`, `services/agent-mcp/tests/`, and `scripts/guards/fastmcp/check-fastmcp-agent.mjs` must stay aligned. Deterministic local Code Atlas access is exposed only through `supaschema`. No separate Code Atlas MCP, browser, daemon, snapshot SQL, or hosted review surface may be configured. `supaschema-docs` remains the separate remote/public Mintlify docs MCP.
- `.mcp.json` is the local server registry. Claude's enabled-server list and Codex's configured servers are runtime activation subsets: every activated server must exist in the registry, and their shared activation/wiring must agree. The registry set is exact: the approved active servers plus the registry-only Stripe entry. Claude and active Codex sets must exactly equal the approved active set; a registry-only Codex entry must be explicitly disabled. The guard pins registry transport/auth fields, the Cloudflare input prompt and Codex bearer-token environment variable, local command/argv/env, remote URLs, approved Codex server keys, and fail-closed approval settings. The FastMCP guard is the sole executable owner of this alignment and of rejecting unsupported/legacy client configs; Code Atlas must not duplicate those checks.
- `services/agent-mcp/**` is ignored as local maintainer tooling. `npm run guard:fastmcp` runs the full alignment check when the server exists. In a clean public checkout where the server is absent by design, the guard MUST emit `FASTMCP_AGENT_SKIPPED_LOCAL_ONLY` and pass.
- Use the FastMCP client CLI for local smoke checks: `npm run fastmcp:inspect`, `npm run fastmcp:list`, and `npm run fastmcp:status`. Use `fastmcp discover` only for local operator diagnostics because it can read user-level MCP client configs.
- Do not treat MCP output as final proof for repo decisions. `supaschema` shortens context gathering; repo guards, focused tests, local Code Atlas queries, cclsp, and source reads remain the reproducible evidence.

The detailed implementation and verification owner is `.claude/skills/fastmcp/SKILL.md` and `services/agent-mcp/supaschema_agent_mcp/server.py`.

STOP if `supaschema` gains write authority, live-database or mutating SQL, a generic SQL engine, raw command execution, secret/credential reads, reads outside the repository root, or proxy access to another MCP; if a separate Code Atlas MCP or UI surface appears; if the approved registry/activation set, transport, authentication, command wiring, or approval posture drifts; if Code Atlas regains client-config validation; if canonical skill changes are not followed by `npm run sync:llm`; or if a FastMCP change ships without `npm run guard:fastmcp`, `npm run guard:agent`, and the relevant Python checks (Rule 04).

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

Restore read-only, repo-root-contained behavior. Do not expose writes, live-database or mutating SQL, a generic SQL engine, shell execution, credential reads, external LLM calls, or proxy calls to other MCP servers.

## Done means

FastMCP surfaces, config, capability index, tests, and guards agree; `supaschema` remains the only local Code Atlas MCP access path and stays read-only and non-secret.
