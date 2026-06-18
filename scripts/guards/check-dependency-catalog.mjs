#!/usr/bin/env node

import { assert, ok, readJson, readText } from "./lib/guard-utils.js";

const catalog = readJson("scripts/dependency-catalog.json");
const packageJson = readJson("package.json");

assert(catalog.packageManager === "npm", "dependency catalog must match this repo's npm contract");

const cclsp = readText(".claude/cclsp.json");
for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
  if (!isLanguageServerDependency(name)) {
    continue;
  }
  assert(
    cclsp.includes(`${name}@${version}`),
    `.claude/cclsp.json must pin ${name}@${version} to match package.json devDependencies`
  );
}

const mcp = readJson(".mcp.json");
assert(
  mcp.mcpServers?.cclsp?.args?.includes(`cclsp@${catalog.mcpTools.cclsp}`),
  ".mcp.json cclsp version must come from dependency catalog"
);
assert(
  mcp.mcpServers?.["next-devtools"]?.args?.includes(
    `next-devtools-mcp@${catalog.mcpTools["next-devtools-mcp"]}`
  ),
  ".mcp.json next-devtools version must come from dependency catalog"
);

const launcher = readText("scripts/code-atlas/mcp-launcher.mjs");
assert(
  launcher.includes(`@codeatlas/mcp@${catalog.mcpTools["@codeatlas/mcp"]}`),
  "Code Atlas launcher fallback must use dependency catalog version"
);

const codexConfig = readText(".codex/config.toml");
for (const token of [
  `cclsp@${catalog.mcpTools.cclsp}`,
  `next-devtools-mcp@${catalog.mcpTools["next-devtools-mcp"]}`,
]) {
  assert(codexConfig.includes(token), `.codex/config.toml missing catalog token ${token}`);
}

const rootPyproject = readText("pyproject.toml");
const agentPyproject = readText("services/agent-mcp/pyproject.toml");
assert(
  agentPyproject.includes('name = "supaschema-agent-mcp"'),
  "agent MCP package must use supaschema name"
);
const rootAsyncio = pinnedVersion(rootPyproject, "pytest-asyncio");
const agentAsyncio = pinnedVersion(agentPyproject, "pytest-asyncio");
assert(
  rootAsyncio !== undefined && rootAsyncio === agentAsyncio,
  `pytest-asyncio must pin the same version in both pyproject.toml files (root=${rootAsyncio}, agent=${agentAsyncio})`
);

ok("DEPENDENCY_CATALOG_OK");

function isLanguageServerDependency(name) {
  return (
    name.includes("language-server") ||
    name.includes("langservers") ||
    name === "@postgres-language-server/cli" ||
    name === "@taplo/cli"
  );
}

function pinnedVersion(pyproject, name) {
  const marker = `"${name}==`;
  const start = pyproject.indexOf(marker);
  if (start === -1) {
    return;
  }
  const from = start + marker.length;
  const end = pyproject.indexOf('"', from);
  return end === -1 ? undefined : pyproject.slice(from, end);
}
