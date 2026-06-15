# FastMCP Upstream Notes

Canonical references verified June 3, 2026:

- Installation: <https://gofastmcp.com/getting-started/installation>
- MCP client install and generated MCP JSON: <https://gofastmcp.com/cli/install-mcp>
- Tools: <https://gofastmcp.com/servers/tools>
- Resources: <https://gofastmcp.com/servers/resources>
- Prompts: <https://gofastmcp.com/servers/prompts>
- Context: <https://gofastmcp.com/servers/context>
- Tool Search: <https://gofastmcp.com/servers/transforms/tool-search>
- Code Mode: <https://gofastmcp.com/servers/transforms/code-mode>
- Sandboxed agents: <https://gofastmcp.com/deployment/sandboxed-agents>
- Project configuration: <https://gofastmcp.com/deployment/server-configuration>
- Testing: <https://gofastmcp.com/servers/testing>
- FastMCP client CLI skill: <https://github.com/PrefectHQ/fastmcp/blob/main/skills/fastmcp-client-cli/SKILL.md>

Implementation defaults for this repo:

- Pin FastMCP exactly because upstream documents that minor releases may carry breaking changes.
- Prefer `fastmcp.json` as the portable server source/environment/deployment owner.
- Use local stdio for repo-agent context servers.
- Use HTTP plus short-lived scoped credentials only for future sandboxed or remote operational gateways.
- Prefer narrow capability tools over raw access. FastMCP's sandbox guidance explicitly warns against pushing privileged raw access into an agent sandbox.
- Use `BM25SearchTransform` when natural-language tool discovery is desired; pin an always-visible status/help tool.
- Test with `fastmcp.client.Client` and async pytest.
- Use the FastMCP client CLI for quick local capability checks: list tools/resources/prompts, call `server_status`, and discover local client registrations when needed.
