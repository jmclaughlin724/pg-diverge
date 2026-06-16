---
name: fastmcp-client-cli
description: Smoke-test FastMCP server tools and resources through the FastMCP CLI.
user-invocable: true
---

# FastMCP Client CLI

Use the repo scripts instead of ad hoc commands:

```bash
npm run fastmcp:inspect
npm run fastmcp:list
npm run fastmcp:status
```

Expected behavior:

- `fastmcp:status` returns `{"server":"supaschema","readonly":true,...}`.
- The list command may show a BM25-reduced tool set. That is expected when search transforms are active.
- Failures should be fixed in `services/agent-mcp/supaschema_agent_mcp/server.py`, `fastmcp.json`, or the uv workspace files.
