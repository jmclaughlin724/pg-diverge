#!/usr/bin/env node
import { assert, ok, readJson, readText } from "./lib/guard-utils.js";

const catalog = readJson("scripts/dependency-catalog.json");
const packageJson = readJson("package.json");

assert(catalog.packageManager === "npm", "dependency catalog must match this repo's npm contract");
assertEqualObject(packageJson.dependencies ?? {}, catalog.dependencies, "package dependencies");
assertEqualObject(
  packageJson.devDependencies ?? {},
  catalog.devDependencies,
  "package devDependencies"
);
assertEqualObject(packageJson.overrides ?? {}, catalog.overrides ?? {}, "package overrides");

const rootPyproject = readText("pyproject.toml");
for (const [name, version] of Object.entries(catalog.pythonWorkspaceDev ?? {})) {
  assert(
    rootPyproject.includes(`"${name}==${version}"`),
    `pyproject.toml missing catalog pin ${name}==${version}`
  );
}

const cclsp = readText(".claude/cclsp.json");
for (const [name, version] of Object.entries(catalog.devDependencies ?? {})) {
  if (name === "@arethetypeswrong/cli" || name === "@biomejs/biome") {
    continue;
  }
  if (!isLanguageServerDependency(name)) {
    continue;
  }
  assert(cclsp.includes(`${name}@${version}`), `.claude/cclsp.json missing ${name}@${version}`);
}

const agentPyproject = readText("services/agent-mcp/pyproject.toml");
assert(
  agentPyproject.includes('name = "supaschema-agent-mcp"'),
  "agent MCP package must use supaschema name"
);
for (const [name, version] of Object.entries(catalog.pythonAgentPackage ?? {})) {
  assert(
    agentPyproject.includes(`"${name}==${version}"`),
    `services/agent-mcp/pyproject.toml missing catalog pin ${name}==${version}`
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

ok("DEPENDENCY_CATALOG_OK");

function isLanguageServerDependency(name) {
  return (
    name.includes("language-server") ||
    name.includes("langservers") ||
    name === "@postgres-language-server/cli" ||
    name === "@taplo/cli"
  );
}

function assertEqualObject(actual, expected, label) {
  const actualText = JSON.stringify(sortObject(actual));
  const expectedText = JSON.stringify(sortObject(expected));
  assert(actualText === expectedText, `${label} must match scripts/dependency-catalog.json`);
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}
