#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ATLAS_PATH = path.join(ROOT, ".tmp", "code-atlas", "atlas.json");
const ENTRYPOINT_KINDS = new Set([
  "next_route",
  "api_router",
  "openapi_endpoint",
  "api_endpoint",
  "render_service",
  "worker_job",
]);

const args = process.argv.slice(2);
const json = takeFlag(args, "--json");
const help = takeFlag(args, "--help") || args.length === 0;

if (help) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const [kind, value] = args;
const optionalValueKinds = new Set(["entrypoints", "health", "mcp-status"]);
if (!(kind && (value || optionalValueKinds.has(kind)))) {
  printUsage();
  process.exit(1);
}

const atlas = loadAtlas();
const indexes = buildIndexes(atlas);
const result = runQuery(kind, value ?? "", atlas, indexes);
if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  printHuman(result);
}

function runQuery(kind, value, sourceAtlas, indexes) {
  switch (kind) {
    case "route":
    case "file":
    case "package":
    case "symbol":
    case "db":
    case "policy":
    case "api":
    case "worker":
      return {
        kind,
        value,
        nodes: resolveNodes(kind, value, sourceAtlas),
      };
    case "search":
      return search(value, sourceAtlas);
    case "consumers":
      return consumers(value, sourceAtlas, indexes);
    case "entrypoints":
      return entrypoints(value, sourceAtlas);
    case "impact":
      return impact(value, sourceAtlas, indexes);
    case "pre-edit":
      return preEdit(value, sourceAtlas, indexes);
    case "health":
      return health(value, sourceAtlas, indexes);
    case "mcp-status":
      return mcpStatus(sourceAtlas);
    default:
      return {
        kind,
        value,
        error: `unknown query kind: ${kind}`,
        usage: usageText(),
      };
  }
}

function consumers(value, sourceAtlas, indexes) {
  const files = resolveNodes("file", value, sourceAtlas);
  const importerIds = new Set();
  for (const file of files) {
    const fileNodeId = file.id;
    for (const edge of indexes.incoming.get(fileNodeId) ?? []) {
      if (edge.type === "imports_file") {
        importerIds.add(edge.from);
      }
      if (edge.type === "resolves_to_file") {
        for (const importEdge of indexes.incoming.get(edge.from) ?? []) {
          if (importEdge.type === "imports_module") {
            importerIds.add(importEdge.from);
          }
        }
      }
    }
  }
  return {
    kind: "consumers",
    value,
    targetFiles: files,
    nodes: [...importerIds]
      .map((id) => indexes.nodes.get(id))
      .filter(Boolean)
      .sort(sortById),
  };
}

function impact(value, sourceAtlas, indexes) {
  const targets = resolveTarget(value, sourceAtlas);
  const ownerFiles = ownerFileIds(targets, indexes);
  const impactedFiles = bfsImporters(ownerFiles, indexes, 3);
  const rolledUp = rollupImpact(impactedFiles, indexes);
  return {
    kind: "impact",
    value,
    targets,
    ownerFiles: [...ownerFiles]
      .map((id) => indexes.nodes.get(id))
      .filter(Boolean)
      .sort(sortById),
    impactedFiles: [...impactedFiles]
      .map((id) => indexes.nodes.get(id))
      .filter(Boolean)
      .sort(sortById),
    affected: rolledUp,
  };
}

function preEdit(value, sourceAtlas, indexes) {
  const base = impact(value, sourceAtlas, indexes);
  const targetIds = new Set(base.targets.map((node) => node.id));
  const incoming = [];
  const outgoing = [];
  for (const targetId of targetIds) {
    incoming.push(...(indexes.incoming.get(targetId) ?? []));
    outgoing.push(...(indexes.outgoing.get(targetId) ?? []));
  }
  return {
    ...base,
    kind: "pre-edit",
    immediate: {
      incoming: incoming.slice(0, 40),
      outgoing: outgoing.slice(0, 40),
    },
  };
}

function health(filter, sourceAtlas, indexes) {
  const issues = [];
  for (const node of sourceAtlas.nodes.filter((candidate) => candidate.kind === "file")) {
    const importCount = (indexes.outgoing.get(node.id) ?? []).filter((edge) =>
      ["imports_file", "imports_module", "imports_package"].includes(edge.type)
    ).length;
    if (importCount >= 10) {
      issues.push({
        type: "high_coupling_file",
        node,
        importCount,
      });
    }
  }
  for (const route of sourceAtlas.nodes.filter((node) => node.kind === "next_route")) {
    const owners = (indexes.incoming.get(route.id) ?? []).filter((edge) =>
      ["owns_route", "wraps_route"].includes(edge.type)
    );
    if (owners.length === 0) {
      issues.push({ type: "route_without_owner", node: route });
    }
  }
  for (const router of sourceAtlas.nodes.filter((node) => node.kind === "api_router")) {
    const registrations = indexes.incoming.get(router.id) ?? [];
    if (!registrations.some((edge) => edge.type === "registers_api_router")) {
      issues.push({ type: "api_router_missing_framework_registration", node: router });
    }
  }
  for (const worker of sourceAtlas.nodes.filter((node) => node.kind === "worker_job")) {
    const outgoing = indexes.outgoing.get(worker.id) ?? [];
    const incoming = indexes.incoming.get(worker.id) ?? [];
    if (
      !(
        outgoing.some((edge) => edge.type === "runs_module") ||
        incoming.some((edge) => edge.type === "declares_worker_job")
      )
    ) {
      issues.push({ type: "worker_job_missing_module", node: worker });
    }
  }
  const filtered = filter
    ? issues.filter((issue) => JSON.stringify(issue).toLowerCase().includes(filter.toLowerCase()))
    : issues;
  return {
    kind: "health",
    value: filter,
    ok: filtered.length === 0,
    issues: filtered,
  };
}

function entrypoints(filter, sourceAtlas) {
  const nodes = sourceAtlas.nodes
    .filter((node) => ENTRYPOINT_KINDS.has(node.kind))
    .filter((node) => !filter || JSON.stringify(node).toLowerCase().includes(filter.toLowerCase()))
    .sort(sortById);
  return {
    kind: "entrypoints",
    value: filter,
    nodes,
  };
}

function search(value, sourceAtlas) {
  const needle = value.toLowerCase();
  const nodes = sourceAtlas.nodes
    .filter((node) =>
      [node.id, node.name, node.path, node.route]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    )
    .slice(0, 50)
    .sort(sortById);
  return {
    kind: "search",
    value,
    nodes,
  };
}

function mcpStatus(sourceAtlas) {
  const result = spawnSync("node", ["scripts/code-atlas/mcp-wrapper.mjs", "--status"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    kind: "mcp-status",
    localAtlas: sourceAtlas.summary,
    liveMcp: safeJson(result.stdout) ?? {
      available: false,
      error: (result.stderr || result.stdout || "").slice(0, 2000),
    },
  };
}

function resolveTarget(value, sourceAtlas) {
  const direct =
    resolveNodes("file", value, sourceAtlas).length > 0
      ? resolveNodes("file", value, sourceAtlas)
      : sourceAtlas.nodes.filter((node) => node.id === value);
  if (direct.length > 0) {
    return direct;
  }
  return search(value, sourceAtlas).nodes;
}

function resolveNodes(kind, value, sourceAtlas) {
  const needle = value.toLowerCase();
  const byKind = {
    api: new Set(["api_router", "api_endpoint", "openapi_endpoint"]),
    db: new Set(["db_object"]),
    file: new Set(["file"]),
    package: new Set(["package", "external_package", "python_package"]),
    policy: new Set(["db_policy"]),
    route: new Set(["next_route"]),
    symbol: new Set(["ts_symbol", "python_symbol"]),
    worker: new Set(["worker_job", "worker_command_group"]),
  }[kind];
  if (!byKind) {
    return [];
  }
  return sourceAtlas.nodes
    .filter((node) => byKind.has(node.kind))
    .filter((node) => {
      const haystack = [node.id, node.name, node.path, node.route, node.schema, node.table]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort(sortById);
}

function ownerFileIds(nodes, indexes) {
  const out = new Set();
  for (const node of nodes) {
    if (node.kind === "file") {
      out.add(node.id);
    }
    if (node.path) {
      const fileNode = indexes.nodes.get(`file:${node.path}`);
      if (fileNode) {
        out.add(fileNode.id);
      }
    }
    for (const edge of indexes.incoming.get(node.id) ?? []) {
      if (
        [
          "declares_symbol",
          "declares_module",
          "declares_db_object",
          "declares_db_policy",
          "declares_api_router",
          "owns_route",
          "owns_worker_job",
        ].includes(edge.type)
      ) {
        out.add(edge.from);
      }
    }
  }
  return out;
}

function bfsImporters(startIds, indexes, maxDepth) {
  const visited = new Set(startIds);
  let frontier = [...startIds];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = [];
    for (const fileId of frontier) {
      for (const edge of indexes.incoming.get(fileId) ?? []) {
        if (edge.type !== "imports_file" || visited.has(edge.from)) {
          continue;
        }
        visited.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
    if (frontier.length === 0) {
      break;
    }
  }
  return visited;
}

function rollupImpact(fileIds, indexes) {
  const buckets = {
    routes: new Map(),
    apis: new Map(),
    workers: new Map(),
    db: new Map(),
    packages: new Map(),
  };
  for (const fileId of fileIds) {
    for (const edge of indexes.outgoing.get(fileId) ?? []) {
      const node = indexes.nodes.get(edge.to);
      rollupOutgoingEdge(edge, node, buckets);
    }
    for (const edge of indexes.incoming.get(fileId) ?? []) {
      const node = indexes.nodes.get(edge.from);
      rollupIncomingEdge(node, buckets);
    }
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [key, [...bucket.values()].sort(sortById)])
  );
}

function rollupOutgoingEdge(edge, node, buckets) {
  if (!node) {
    return;
  }
  if (edge.type === "owns_route" || node.kind === "next_route") {
    buckets.routes.set(node.id, node);
    return;
  }
  if (["api_router", "api_endpoint", "openapi_endpoint"].includes(node.kind)) {
    buckets.apis.set(node.id, node);
    return;
  }
  if (["worker_job", "worker_command_group"].includes(node.kind)) {
    buckets.workers.set(node.id, node);
    return;
  }
  if (node.kind === "db_object" || node.kind === "db_policy") {
    buckets.db.set(node.id, node);
    return;
  }
  if (["package", "external_package", "python_package"].includes(node.kind)) {
    buckets.packages.set(node.id, node);
  }
}

function rollupIncomingEdge(node, buckets) {
  if (node?.kind === "worker_job") {
    buckets.workers.set(node.id, node);
  }
}

function buildIndexes(sourceAtlas) {
  const nodes = new Map(sourceAtlas.nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of sourceAtlas.edges) {
    if (!incoming.has(edge.to)) {
      incoming.set(edge.to, []);
    }
    if (!outgoing.has(edge.from)) {
      outgoing.set(edge.from, []);
    }
    incoming.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
  }
  return { nodes, incoming, outgoing };
}

function loadAtlas() {
  if (!fs.existsSync(ATLAS_PATH)) {
    const result = spawnSync("node", ["scripts/code-atlas/build.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || "code atlas build failed");
      process.exit(result.status ?? 1);
    }
  }
  return JSON.parse(fs.readFileSync(ATLAS_PATH, "utf8"));
}

function takeFlag(targetArgs, flag) {
  const index = targetArgs.indexOf(flag);
  if (index === -1) {
    return false;
  }
  targetArgs.splice(index, 1);
  return true;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

function sortById(left, right) {
  return left.id.localeCompare(right.id);
}

function printHuman(result) {
  if (result.error) {
    process.stderr.write(`${result.error}\n${result.usage}\n`);
    process.exit(1);
  }
  const nodes = result.nodes ?? result.impactedFiles ?? result.issues ?? [];
  process.stdout.write(`${result.kind.toUpperCase()} ${nodes.length} result(s)\n`);
  for (const node of nodes.slice(0, 80)) {
    if (node.node) {
      process.stdout.write(`- ${node.type}: ${node.node.id}\n`);
    } else {
      process.stdout.write(`- ${node.id}${node.path ? ` (${node.path})` : ""}\n`);
    }
  }
  if (result.affected) {
    for (const [bucket, bucketNodes] of Object.entries(result.affected)) {
      process.stdout.write(`${bucket}: ${bucketNodes.length}\n`);
    }
  }
}

function printUsage() {
  process.stdout.write(`${usageText()}\n`);
}

function usageText() {
  return `Usage: node scripts/code-atlas/query.mjs <kind> [value] [--json]

Kinds:
  route <value>       Find Next route nodes.
  file <path>         Find file nodes.
  package <value>     Find package or external dependency nodes.
  symbol <value>      Find TypeScript/Python symbols.
  db <value>          Find database object nodes.
  policy <value>      Find RLS policy nodes.
  api <value>         Find API router or endpoint nodes.
  worker <value>      Find worker job nodes.
  search <value>      Search all nodes.
  consumers <file>    Find files importing a file.
  entrypoints [value] List routes, APIs, workers, and deploy services.
  impact <target>     Resolve owner files and importer impact to depth 3.
  pre-edit <target>   Impact plus immediate incoming/outgoing edges.
  health [value]      Report atlas consistency risks.
  mcp-status [value]  Report optional live Code Atlas MCP status.`;
}
