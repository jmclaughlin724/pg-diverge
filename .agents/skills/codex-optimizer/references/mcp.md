# MCP Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/config-reference

## Intent

Use MCP when Codex needs live external context, project tools, hosted services, or APIs that should be tool-called instead of guessed. Add the smallest server/tool surface that delivers the workflow.

## Design Steps

1. Define the job the MCP server should make possible.
2. Choose STDIO for local processes and streamable HTTP for hosted servers.
3. Decide whether the server is required for the task or optional enhancement.
4. Limit tool exposure with `enabled_tools` or `disabled_tools` when the server is broad.
5. Set timeout and approval defaults based on latency, side effects, and data sensitivity.
6. For HTTP servers, store bearer tokens in env vars and use `bearer_token_env_var`.

## Deferred Tool Discovery

- Broad MCP servers can be configured and still have tools deferred from the current model context. When a configured MCP tool is needed but not callable, use `tool_search` for the exact namespace/tool before reporting it missing.
- For docs-critical workflows, prefer a narrow docs-only MCP server when MCP registry changes are in scope; keep broad project/database servers for project operations.
- Supabase docs follow the upstream Supabase docs lane: prefer the docs-only `search_docs` tool when present, fall back to `supabase-main` while registered, and use exact `tool_search` before any official-web fallback.

## Config Shape

- STDIO: `command`, `args`, `env`, `env_vars`, `cwd`, `experimental_environment`.
- HTTP: `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`.
- Shared: `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `required`, tool allow/deny lists, and approval settings.
- OAuth: callback port or URL plus scopes when the server requires delegated auth.

## Approval Policy

- Side-effecting tools should prompt unless the workflow has strong guardrails.
- Read-only tools can usually be less noisy, but only after confirming they are actually read-only.
- Plugin-provided MCP servers can carry their own policy under plugin config. Do not silently override it without checking intent.

## supaschema Delivery Pattern

- `.mcp.json` owns the repo MCP registry.
- Generated Codex MCP config comes from sync.
- Do not hand-copy MCP server entries across config files.
- If a registry entry changes, update the owner and run the repo sync path.
