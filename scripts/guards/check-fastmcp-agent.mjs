#!/usr/bin/env node
import { assert, exists, ok, readJson, readText } from "./lib/guard-utils.js";

const required = [
  "services/agent-mcp/supaschema_agent_mcp/server.py",
  "services/agent-mcp/pyproject.toml",
  "pyproject.toml",
  "fastmcp.json",
  ".mcp.json",
  ".codex/config.toml",
];

for (const file of required) {
  assert(exists(file), `missing ${file}`);
}

const server = readText("services/agent-mcp/supaschema_agent_mcp/server.py");
for (const token of [
  "readonly",
  "blocked_capabilities",
  "DENIED_PARTS",
  '".env"',
  '"secrets"',
  '"plans"',
  "SECRET_SUFFIXES",
  "code_atlas_query",
  '["node", "scripts/code-atlas/query.mjs"',
  "upstream_mcp_capabilities",
  "Pointer index only",
  "cloudflare-docs",
  "supaschema-docs",
  "from fastmcp.exceptions import ToolError",
  "raise ToolError(",
]) {
  assert(server.includes(token), `FastMCP server missing marker ${token}`);
}
assert(!server.includes("FastMCP.as_proxy"), "repo_context must not proxy other MCP servers");
assert(
  !server.includes("raise ValueError("),
  "FastMCP guards must raise ToolError (not bare ValueError) so messages survive mask_error_details"
);

const fastmcp = readJson("fastmcp.json");
assert(
  fastmcp.source?.path === "services/agent-mcp/supaschema_agent_mcp/server.py",
  "fastmcp source path drifted"
);
assert(fastmcp.source?.entrypoint === "mcp", "fastmcp entrypoint must be mcp");
assert(fastmcp.environment?.type === "uv", "fastmcp must use uv environment");
assert(fastmcp.deployment?.transport === "stdio", "fastmcp transport must be stdio");

const mcp = readJson(".mcp.json").mcpServers ?? {};
const expectedServers = [
  "cloudflare-api",
  "cloudflare-docs",
  "cclsp",
  "codeatlas",
  "repo_context",
  "context7",
  "mintlify",
  "next-devtools",
  "openaiDeveloperDocs",
  "sentry",
  "ultracite",
  "zod",
  "supaschema-docs",
];
for (const serverName of expectedServers) {
  assert(mcp[serverName], `.mcp.json missing ${serverName}`);
}
const settings = readJson(".claude/settings.json");
for (const serverName of expectedServers) {
  assert(
    settings.enabledMcpjsonServers?.includes(serverName),
    `.claude/settings.json must enable ${serverName}`
  );
}
const codexConfig = readText(".codex/config.toml");
for (const serverName of expectedServers) {
  assert(
    codexConfig.includes(`mcp_servers.${serverName}`),
    `.codex/config.toml missing ${serverName}`
  );
}

const packageJson = readJson("package.json");
for (const script of ["fastmcp:inspect", "fastmcp:list", "fastmcp:status", "guard:fastmcp"]) {
  assert(packageJson.scripts?.[script], `package.json missing script ${script}`);
}

ok("FASTMCP_AGENT_OK");
