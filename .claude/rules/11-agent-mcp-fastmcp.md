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
- `supaschema` may expose whatever local read-only tools the server owns. The guard does not freeze the tool count or require a hard-coded catalog. Current core capabilities include `server_status`, repo context reads/search, local safety scan, and session-state inspection. Repo context tools must read/search non-secret repo files on a **deny-list** model (AGENTS instructions, rules, skills, source, schemas, tooling config) and return nearest agent instructions when supported. Safety-scan tools must run read-only `supaschema scan` through fixed argv (`node dist/cli.js scan --reporter json`, input-validated, no DB, no mutation); caller sources are limited to repo-contained forms (repo-relative `dir:`/`dump:`/`catalog:`/`migrations:` payloads resolved inside the repository with the same deny-list, plus `empty:`, `git:HEAD`, and `git:INDEX`), and a missing `dist/cli.js` returns an actionable build instruction instead of a raw subprocess error. Session-state tools may read the local agent-hook ledger without exposing writes and must redact secret-shaped values (URL passwords, SECRET/TOKEN/KEY-style env assignments) from recorded commands and summaries before returning them. Secrets/credentials (`.env*`, `*.key`/`*.pem`/`*.p12`/`*.pfx`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.dev.vars*`, `secrets/`), `.git`, caches/build output, and archived `plans/` stay blocked. No tool may expose live-database SQL, SQL mutation, a generic SQL engine, arbitrary shell execution, DB/API mutation, credential reads, external LLM calls, or proxy calls to other MCP servers.
- `fastmcp.json`, `.mcp.json`, `.codex/config.toml`, `services/agent-mcp/supaschema_agent_mcp/server.py`, `services/agent-mcp/tests/`, and `scripts/guards/fastmcp/check-fastmcp-agent.mjs` must stay aligned. `supaschema-docs` remains the separate remote/public Mintlify docs MCP.
- `.mcp.json` is the exact local server registry. `.codex/config.toml` is the exact checked-in Codex activation and wiring owner: every configured server must exist in the registry, shared transport/auth fields must agree, and registry-only entries must be explicitly disabled. The guard pins registry transport/auth fields, the Cloudflare input prompt and Codex bearer-token environment variable, local command/argv/env, remote URLs, approved Codex server keys, and fail-closed Codex approval settings. Claude discovers project servers from `.mcp.json`; `enableAllProjectMcpServers`, `enabledMcpjsonServers`, and `disabledMcpjsonServers` in `.claude/settings.json` are optional user or project approval preferences, not required repository invariants. When those preferences are absent, Claude uses its normal project-server approval flow. The guard must not add, require, or compare those optional Claude keys.
- `services/agent-mcp/**` is tracked maintainer tooling: the server, its config, and the guard ship in the repo so agents can see and verify them. `npm run guard:fastmcp` runs the full alignment check unconditionally.
- Use the FastMCP client CLI for local smoke checks: `npm run fastmcp:inspect`, `npm run fastmcp:list`, and `npm run fastmcp:status`. Use `fastmcp discover` only for local operator diagnostics because it can read user-level MCP client configs.
- Do not treat MCP output as final proof for repo decisions. `supaschema` shortens context gathering; repo guards, focused tests, configured language-server tooling, and source reads remain the reproducible evidence.

The detailed implementation and verification owner is `.claude/skills/fastmcp/SKILL.md` and `services/agent-mcp/supaschema_agent_mcp/server.py`.

STOP if `supaschema` gains write authority, live-database or mutating SQL, a generic SQL engine, raw command execution, secret/credential reads, reads outside the repository root, or proxy access to another MCP; if the approved registry or Codex activation set, transport, authentication, command wiring, or approval posture drifts; if a guard starts owning optional Claude project-server approval preferences; if canonical skill changes are not followed by `npm run sync:llm`; or if a FastMCP change ships without `npm run guard:fastmcp`, `npm run guard:agent`, and the relevant Python checks (Rule 04).

## Verification

After FastMCP server, MCP config, capability index, deny-list, or client CLI changes, run:

```bash
npm run guard:fastmcp
npm run guard:agent
npm run py:typecheck
npm run py:test
npm run fastmcp:status
```

Use `npm run fastmcp:list` or `npm run fastmcp:inspect` for smoke checks. Wiring verification is `npm run guard:fastmcp` returning `FASTMCP_AGENT_OK`.

## Failure behavior

Restore read-only, repo-root-contained behavior. Do not expose writes, live-database or mutating SQL, a generic SQL engine, shell execution, credential reads, external LLM calls, or proxy calls to other MCP servers.

## Done means

FastMCP surfaces, config, capability index, tests, and guards agree; `supaschema` stays read-only and non-secret; the registry and Codex wiring remain deterministic without overriding Claude's optional project-server approval preferences.
