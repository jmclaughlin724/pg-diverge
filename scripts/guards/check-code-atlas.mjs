#!/usr/bin/env node
import { assert, edgeKey, ok, readJson, readText, run } from "./lib/guard-utils.js";

run("node", ["scripts/code-atlas/build.mjs"]);

const atlas = readJson(".tmp/code-atlas/atlas.json");
const nodes = new Map(atlas.nodes.map((node) => [node.id, node]));
const edges = new Set(atlas.edges.map(edgeKey));

hasNode("file:src/cli.ts");
hasNode("file:tsconfig.json");
hasNode("file:tsconfig.src.json");
hasNode("file:tsconfig.tools.json");
hasNode("package:supaschema");
hasNode("external_package:commander");
hasNode("file:biome.jsonc");
hasEdge("package:supaschema", "external_package:commander", "depends_on");
hasEdge("file:src/cli.ts", "file:src/cli-diff.ts", "imports_file");
hasNode("db_object:table:app.accounts");
hasNode("db_policy:app.accounts.accounts_select");
hasNode("worker_job:supaschema-docs");
hasEdge("worker_job:supaschema-docs", "file:cloudflare/mintlify-docs-worker.js", "runs_module");

for (const node of atlas.nodes) {
  if (node.kind === "file") {
    assert(!node.path.includes("node_modules/"), "atlas scanned node_modules");
    assert(!node.path.includes(".next/"), "atlas scanned .next");
    assert(!node.path.includes("plans/"), "atlas scanned plans");
  }
}

const mcp = readJson(".mcp.json");
assert(
  !mcp.mcpServers?.codeatlas,
  ".mcp.json must not expose standalone codeatlas; use supaschema.code_atlas_query"
);
assert(
  mcp.mcpServers?.supaschema?.command === "uv",
  ".mcp.json supaschema must use the uv FastMCP server"
);
assert(
  mcp.mcpServers?.supaschema?.args?.includes("fastmcp.json"),
  ".mcp.json supaschema must run fastmcp.json"
);
const codexConfig = readText(".codex/config.toml");
assert(
  !codexConfig.includes("[mcp_servers.codeatlas]"),
  ".codex/config.toml must not expose standalone codeatlas"
);
assert(
  codexConfig.includes("[mcp_servers.supaschema]"),
  ".codex/config.toml missing local supaschema server"
);

const entrypoints = query("entrypoints");
assert(
  entrypoints.nodes.some((node) => node.id === "worker_job:supaschema-docs"),
  "entrypoints query must include Cloudflare worker"
);
const policy = query("policy", "accounts_select");
assert(
  policy.nodes.some((node) => node.id === "db_policy:app.accounts.accounts_select"),
  "policy query missing anchor"
);
const search = query("search", "supaschema-docs");
assert(
  search.nodes.some((node) => node.id === "worker_job:supaschema-docs"),
  "search query missing worker"
);
const impact = query("impact", "src/cli-diff.ts");
assert(
  impact.impactedFiles.some((node) => node.id === "file:src/cli.ts"),
  "impact query must include importer src/cli.ts"
);
const health = query("health");
assert(Array.isArray(health.issues), "health query must return issues array");
const mcpStatus = query("mcp-status");
assert(mcpStatus.localAtlas?.nodes > 0, "mcp-status must report local atlas nodes");
assert(mcpStatus.liveMcp?.wrapper === "scripts/code-atlas/mcp-wrapper.mjs", "mcp wrapper drifted");

ok("CODE_ATLAS_OK");

function hasNode(id) {
  assert(nodes.has(id), `atlas missing node ${id}`);
}

function hasEdge(from, to, type) {
  assert(
    [...edges].some((key) => key.startsWith(`${from}\0${to}\0${type}\0`)),
    `atlas missing edge ${from} -> ${to} ${type}`
  );
}

function query(kind, value) {
  const args = ["scripts/code-atlas/query.mjs", kind];
  if (value) {
    args.push(value);
  }
  args.push("--json");
  return JSON.parse(run("node", args).stdout);
}
