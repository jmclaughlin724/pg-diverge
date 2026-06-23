#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, edgeKey, exists, ok, ROOT, readJson, readText, run } from "../lib/guard-utils.js";

export function check(root = ROOT) {
  if (
    process.env.SUPASCHEMA_PUBLIC_CHECKOUT === "1" ||
    !exists("scripts/code-atlas/build.mjs", root)
  ) {
    return "CODE_ATLAS_SKIPPED_LOCAL_ONLY";
  }

  run("node", ["scripts/code-atlas/build.mjs"], {}, root);

  const atlas = readJson(".tmp/code-atlas/atlas.json", root);
  const nodes = new Map(atlas.nodes.map((node) => [node.id, node]));
  const edges = new Set(atlas.edges.map(edgeKey));

  function hasNode(id) {
    assert(nodes.has(id), `atlas missing node ${id}`);
  }

  function hasEdge(from, to, type) {
    assert(
      [...edges].some((key) => key.startsWith(`${from}\0${to}\0${type}\0`)),
      `atlas missing edge ${from} -> ${to} ${type}`
    );
  }

  function query(kind, value, extraArgs = []) {
    const args = ["scripts/code-atlas/query.mjs", kind];
    if (value) {
      args.push(value);
    }
    args.push(...extraArgs);
    args.push("--json");
    return JSON.parse(run("node", args, {}, root).stdout);
  }

  function assertUnknownTargetFails() {
    const result = spawnSync(
      "node",
      ["scripts/code-atlas/query.mjs", "impact", "definitely-not-a-real-target", "--json"],
      {
        cwd: root,
        encoding: "utf8",
      }
    );
    assert(result.status !== 0, "unknown impact target must fail");
    const payload = JSON.parse(result.stdout);
    assert(
      payload.error?.includes("target not found"),
      "unknown target failure must be actionable"
    );
  }

  assert(atlas.schemaVersion === 2, "atlas schemaVersion must be 2");
  assert(atlas.cacheFormat === "supaschema-code-atlas@2", "atlas cacheFormat drifted");
  assert(atlas.metadata?.inputDigest, "atlas missing inputDigest");
  assert(atlas.metadata?.gitHead, "atlas missing gitHead");
  assert(atlas.summary?.byEdgeType?.imports_file > 0, "atlas summary missing byEdgeType");

  hasNode("file:src/cli.ts");
  hasNode("file:tsconfig.json");
  hasNode("file:tsconfig.src.json");
  hasNode("file:tsconfig.tools.json");
  hasNode("package:supaschema");
  hasNode("package_script:supaschema#code-atlas:query");
  hasNode("external_package:commander");
  hasNode("file:biome.jsonc");
  hasNode("file:scripts/code-atlas/lib/config.mjs");
  hasNode("file:scripts/code-atlas/lib/files.mjs");
  hasNode("file:scripts/code-atlas/lib/graph.mjs");
  hasNode("file:scripts/code-atlas/lib/resolve.mjs");
  assert(
    nodes.get("file:src/cli.ts").language === "typescript",
    "file nodes must include language"
  );
  assert(nodes.get("file:src/cli.ts").contentDigest, "file nodes must include contentDigest");
  hasEdge("package:supaschema", "external_package:commander", "depends_on");
  hasEdge("package:supaschema", "package_script:supaschema#code-atlas:query", "defines_script");
  hasEdge(
    "package_script:supaschema#code-atlas:query",
    "file:scripts/code-atlas/query.mjs",
    "runs_file"
  );
  hasEdge("file:src/cli.ts", "file:src/cli/diff.ts", "imports_file");
  hasEdge(
    "file:services/agent-mcp/supaschema_agent_mcp/server.py",
    "file:scripts/code-atlas/query.mjs",
    "references_file"
  );
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

  const mcp = readJson(".mcp.json", root);
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
  const codexConfig = readText(".codex/config.toml", root);
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
  const impact = query("impact", "src/cli/diff.ts");
  assert(
    impact.impactedFiles.some((node) => node.id === "file:src/cli.ts"),
    "impact query must include importer src/cli.ts"
  );
  const health = query("health");
  assert(Array.isArray(health.issues), "health query must return issues array");
  assert(typeof health.ok === "boolean", "health query must return ok boolean");
  assert(
    health.issues.every((issue) => ["error", "info", "warning"].includes(issue.severity)),
    "health issues must include ranked severities"
  );
  const strictHealth = query("health", "", ["--strict"]);
  assert(strictHealth.strict === true, "health --strict must report strict mode");
  assert(typeof strictHealth.ok === "boolean", "health --strict must return ok boolean");
  const coverage = query("validate-coverage");
  assert(coverage.ok === true, "validate-coverage query must pass");
  const regressionScope = query("regression-scope");
  assert(Array.isArray(regressionScope.changedFiles), "regression-scope must return changedFiles");
  assert(
    regressionScope.verification?.commands?.includes("npm run guard:code-atlas"),
    "regression-scope must include code-atlas guard verification"
  );
  const traceChange = query("trace-change", "scripts/code-atlas/build.mjs");
  assert(
    traceChange.consumers.some((node) => node.id === "package_script:supaschema#code-atlas:build"),
    "trace-change must include package-script consumers"
  );
  assert(
    traceChange.owners.some((owner) => owner.instructions.length > 0),
    "trace-change missing owners"
  );
  const fileOwners = query("file-owners", "scripts/code-atlas/query.mjs");
  assert(fileOwners.owners.length > 0, "file-owners query missing owners");
  const queryConsumers = query("consumers", "scripts/code-atlas/query.mjs");
  assert(
    queryConsumers.nodes.some(
      (node) => node.id === "file:services/agent-mcp/supaschema_agent_mcp/server.py"
    ),
    "consumers query must include FastMCP bridge"
  );
  assert(
    queryConsumers.nodes.some((node) => node.id === "package_script:supaschema#code-atlas:query"),
    "consumers query must include package script"
  );
  const mcpStatus = query("mcp-status");
  assert(mcpStatus.localAtlas?.nodes > 0, "mcp-status must report local atlas nodes");
  assert(
    mcpStatus.liveMcp?.launcher === "scripts/code-atlas/mcp-launcher.mjs",
    "mcp launcher drifted"
  );
  assert(mcpStatus.liveMcp?.source !== "npx", "mcp-status must not use npx fallback by default");
  assert(
    mcpStatus.liveMcp?.npxFallbackEnabled === false,
    "mcp-status must report npx fallback disabled by default"
  );
  assertUnknownTargetFails();

  return "CODE_ATLAS_OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ok(check());
}
