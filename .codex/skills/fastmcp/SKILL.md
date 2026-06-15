---
name: fastmcp
description: Maintain the read-only FastMCP repo-context server and its fixed Code Atlas bridge.
user-invocable: true
---

# FastMCP Repo Context Server

The server lives in `services/agent-mcp/supaschema_agent_mcp/server.py` and is configured by `fastmcp.json`.

Non-negotiables:

- Read-only tools only.
- No arbitrary shell, raw SQL, DB/API mutation, credential reads, or external LLM calls.
- No proxying other MCP servers.
- Code Atlas access only through `code_atlas_query(kind, value)`, which shells to the fixed query CLI.
- Path reads must stay repo-relative, traversal-proof, and deny `.env`, secret suffixes, `secrets`, `plans`, `node_modules`, build output, and VCS internals.

Smoke commands:

```bash
uv sync
npm run fastmcp:inspect
npm run fastmcp:list
npm run fastmcp:status
npm run guard:fastmcp
```
