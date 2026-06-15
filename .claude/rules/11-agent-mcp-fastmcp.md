# Rule 11 — Agent MCP FastMCP

Repo-local agent MCP servers are governed surfaces, not throwaway helpers.

- `repo_context` is the canonical supaschema FastMCP server (`services/agent-mcp`, package `supaschema-agent-mcp`) for local repo-agent context. It stays read-only and local stdio.
- `repo_context` reads and searches any non-secret repo file on a **deny-list** model (AGENTS instructions, rules, skills, source, schemas, tooling config) plus the full local Code Atlas query surface and a read-only upstream MCP capability index. Secrets/credentials (`.env*`, `*.key`/`*.pem`/`*.p12`/`*.pfx`, `secrets/`), `.git`, caches/build output, and archived `plans/` stay blocked. It must not expose raw SQL, arbitrary shell execution, DB/API mutation, credential reads, external LLM calls, or proxy calls to other MCP servers.
- `fastmcp.json`, `.mcp.json`, `.codex/config.toml`, `.claude/settings.json`, `services/agent-mcp/supaschema_agent_mcp/server.py`, `services/agent-mcp/tests/`, and `scripts/guards/check-fastmcp-agent.mjs` must stay aligned. The capability index the server advertises must match the docs/research MCP servers actually configured in `.mcp.json`.
- Use the FastMCP client CLI for local smoke checks: `npm run fastmcp:inspect`, `npm run fastmcp:list`, and `npm run fastmcp:status`. Use `fastmcp discover` only for local operator diagnostics because it can read user-level MCP client configs.
- Do not treat MCP output as final proof for repo decisions. `repo_context` shortens context gathering; repo guards, focused tests, local Code Atlas queries, cclsp, and source reads remain the reproducible evidence.

The detailed implementation and verification owner is `.claude/skills/fastmcp/SKILL.md` and `services/agent-mcp/supaschema_agent_mcp/server.py`.

STOP if `repo_context` gains write authority, raw command execution, secret/credential reads, reads outside the repository root, or unguarded client wiring; if FastMCP surfaces drift without `npm run sync:llm`; or if a FastMCP change ships without `npm run guard:fastmcp`, `npm run guard:agent`, and the relevant Python checks (Rule 04).
