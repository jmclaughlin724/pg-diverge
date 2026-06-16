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
  "repo_context_query",
  '["node", "scripts/code-atlas/query.mjs"',
  "upstream_mcp_capabilities",
  "Pointer index only",
  "cloudflare-docs",
  "supaschema-docs",
  "from fastmcp.exceptions import ToolError",
  "raise ToolError(",
  '"server": "supaschema"',
]) {
  assert(server.includes(token), `FastMCP server missing marker ${token}`);
}
assert(!server.includes("FastMCP.as_proxy"), "supaschema must not proxy other MCP servers");
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
  "supaschema",
  "context7",
  "mintlify",
  "next-devtools",
  "openaiDeveloperDocs",
  "ultracite",
  "zod",
  "supaschema-docs",
];
const disallowedServers = ["MCP_DOCKER", "render", "sentry"];
for (const serverName of expectedServers) {
  assert(mcp[serverName], `.mcp.json missing ${serverName}`);
}
for (const serverName of disallowedServers) {
  assert(!mcp[serverName], `.mcp.json must not expose ${serverName} MCP`);
}
assert(!mcp.codeatlas, ".mcp.json must not expose standalone codeatlas MCP");
assert(!mcp.repo_context, ".mcp.json must not expose legacy repo_context MCP");
assert(
  mcp["supaschema-docs"]?.url === "https://supaschema.com/docs/mcp",
  ".mcp.json supaschema-docs must use /docs/mcp"
);
const settings = readJson(".claude/settings.json");
for (const serverName of expectedServers) {
  assert(
    settings.enabledMcpjsonServers?.includes(serverName),
    `.claude/settings.json must enable ${serverName}`
  );
}
for (const serverName of disallowedServers) {
  assert(
    !settings.enabledMcpjsonServers?.includes(serverName),
    `.claude/settings.json must not enable ${serverName}`
  );
}
assert(
  !settings.enabledMcpjsonServers?.includes("codeatlas"),
  ".claude/settings.json must not enable standalone codeatlas"
);
assert(
  !settings.enabledMcpjsonServers?.includes("repo_context"),
  ".claude/settings.json must not enable legacy repo_context"
);
const codexConfig = readText(".codex/config.toml");
for (const serverName of expectedServers) {
  assert(
    codexConfig.includes(`mcp_servers.${serverName}`),
    `.codex/config.toml missing ${serverName}`
  );
}
for (const serverName of disallowedServers) {
  assert(
    !codexConfig.includes(`[mcp_servers.${serverName}]`),
    `.codex/config.toml must not expose ${serverName} MCP`
  );
}
assert(
  !codexConfig.includes("mcp_servers.codeatlas"),
  ".codex/config.toml must not expose standalone codeatlas"
);
assert(
  !codexConfig.includes("mcp_servers.repo_context"),
  ".codex/config.toml must not expose legacy repo_context"
);
assert(
  codexConfig.includes('url = "https://supaschema.com/docs/mcp"'),
  ".codex/config.toml supaschema-docs must use /docs/mcp"
);

const packageJson = readJson("package.json");
for (const script of ["fastmcp:inspect", "fastmcp:list", "fastmcp:status", "guard:fastmcp"]) {
  assert(packageJson.scripts?.[script], `package.json missing script ${script}`);
}

ok("FASTMCP_AGENT_OK");
