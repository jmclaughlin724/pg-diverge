#!/usr/bin/env node
// Cross-surface version reconciliation.
//
// package.json (+ package-lock.json) is the single source of truth for npm
// dependencies, and pyproject.toml owns the Python pins. This guard does NOT
// mirror those manifests — adding or bumping an ordinary dependency is a single
// package.json (or pyproject.toml) edit. It only reconciles versions that are
// DUPLICATED across surfaces npm/uv cannot keep in sync:
//   - language-server pins echoed in .claude/cclsp.json (source: package.json)
//   - the npx-invoked MCP tool versions in .mcp.json / .codex/config.toml / the
//     Code Atlas wrapper (source: the catalog's mcpTools — they have no manifest)
//   - the one Python pin shared by both pyproject.toml files (pytest-asyncio)
import { assert, ok, readJson, readText } from "./lib/guard-utils.js";

const catalog = readJson("scripts/dependency-catalog.json");
const packageJson = readJson("package.json");

assert(catalog.packageManager === "npm", "dependency catalog must match this repo's npm contract");

// Language servers are declared in package.json (the source) and echoed with a
// pinned `name@version` in .claude/cclsp.json. Reconcile cclsp.json against the
// live package.json devDependency version — not a hand-maintained copy.
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

// npx-invoked MCP tools have no package.json/pyproject manifest, so the catalog
// is their single source. Reconcile .mcp.json, the Code Atlas wrapper fallback,
// and .codex/config.toml against it.
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

const wrapper = readText("scripts/code-atlas/mcp-wrapper.mjs");
assert(
  wrapper.includes(`@codeatlas/mcp@${catalog.mcpTools["@codeatlas/mcp"]}`),
  "Code Atlas wrapper fallback must use dependency catalog version"
);

const codexConfig = readText(".codex/config.toml");
for (const token of [
  `cclsp@${catalog.mcpTools.cclsp}`,
  `next-devtools-mcp@${catalog.mcpTools["next-devtools-mcp"]}`,
]) {
  assert(codexConfig.includes(token), `.codex/config.toml missing catalog token ${token}`);
}

// pyproject.toml owns the Python pins; the only cross-surface invariant is that
// the workspace root and the member package agree on pytest-asyncio (the one
// pin declared in both). The agent package keeps its published identity.
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
