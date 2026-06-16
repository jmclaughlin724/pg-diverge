---
name: fastmcp
description: Maintain the read-only local supaschema FastMCP server and its fixed Code Atlas bridge.
user-invocable: true
---

# FastMCP Supaschema Server

The server lives in `services/agent-mcp/supaschema_agent_mcp/server.py` and is configured by `fastmcp.json`.

Non-negotiables:

- Rule 11 (`.claude/rules/11-agent-mcp-fastmcp.md`) owns the durable local MCP contract.
- Keep implementation changes in `services/agent-mcp/supaschema_agent_mcp/server.py` and aligned tests/guards.
- Refresh generated skill mirrors with `npm run sync:llm`.

Smoke commands:

```bash
uv sync
npm run fastmcp:inspect
npm run fastmcp:list
npm run fastmcp:status
npm run guard:fastmcp
```
