#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCodeAtlas } from "./build.mjs";
import { fileId, OUTPUT_PATH, ROOT } from "./lib/config.mjs";
import { atomicWriteJson, readCachedAtlas, readText, safeJson } from "./lib/files.mjs";

const ENTRYPOINT_KINDS = new Set([
  "next_route",
  "api_router",
  "openapi_endpoint",
  "api_endpoint",
  "render_service",
  "worker_job",
]);
const CONSUMER_EDGE_TYPES = new Set(["imports_file", "references_file", "runs_file"]);
const OWNER_RULES = [
  {
    prefix: "scripts/code-atlas/",
    owners: [
      ".claude/rules/10-code-atlas.md",
      ".claude/skills/code-atlas/SKILL.md",
      ".claude/skills/code-atlas/references/query-contract.md",
      ".claude/skills/code-atlas/references/mcp-tool-map.md",
    ],
  },
  {
    prefix: "services/agent-mcp/",
    owners: [".claude/rules/11-agent-mcp-fastmcp.md", ".claude/skills/fastmcp/SKILL.md"],
  },
  {
    prefix: "docs/",
    owners: [".claude/rules/13-npm-package-boundary.md"],
  },
];

const args = process.argv.slice(2);
const json = takeFlag(args, "--json");
const noRebuild = takeFlag(args, "--no-rebuild");
const strict = takeFlag(args, "--strict");
const help = takeFlag(args, "--help") || args.length === 0;

if (help) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const [kind, value] = args;
const optionalValueKinds = new Set([
  "entrypoints",
  "health",
  "mcp-status",
  "regression-scope",
  "validate-coverage",
]);
if (!(kind && (value || optionalValueKinds.has(kind)))) {
  printUsage();
  process.exit(1);
}

try {
  const atlas = await loadAtlas({ noRebuild });
  const indexes = buildIndexes(atlas);
  const result = runQuery(kind, value ?? "", atlas, indexes, { strict });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.error) {
      process.exit(1);
    }
  } else {
    printHuman(result);
  }
} catch (error) {
  const payload = {
    kind,
    value: value ?? "",
    error: error instanceof Error ? error.message : String(error),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`${payload.error}\n`);
  }
  process.exit(1);
}

function runQuery(kind, value, sourceAtlas, indexes, options = {}) {
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
    case "trace-change":
      return traceChange(value, sourceAtlas, indexes);
    case "file-owners":
      return fileOwners(value, sourceAtlas, indexes);
    case "regression-scope":
      return regressionScope(value, sourceAtlas, indexes);
    case "validate-coverage":
      return validateCoverage(sourceAtlas);
    case "health":
      return health(value, sourceAtlas, indexes, options);
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
      if (CONSUMER_EDGE_TYPES.has(edge.type)) {
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
  if (targets.length === 0) {
    return {
      kind: "impact",
      value,
      error: `target not found: ${value}`,
      targets: [],
      ownerFiles: [],
      impactedFiles: [],
      affected: emptyImpact(),
    };
  }
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
  if (base.error) {
    return { ...base, kind: "pre-edit" };
  }
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

function traceChange(value, sourceAtlas, indexes) {
  const base = preEdit(value, sourceAtlas, indexes);
  if (base.error) {
    return { ...base, kind: "trace-change" };
  }
  return {
    ...base,
    kind: "trace-change",
    consumers: consumers(value, sourceAtlas, indexes).nodes,
    owners: fileOwners(value, sourceAtlas, indexes).owners,
    verification: verificationPlan(value, base),
  };
}

function regressionScope(filter, sourceAtlas, indexes) {
  const changedFiles = changedRepoFiles(filter).map((filePath) => ({
    node: indexes.nodes.get(fileId(filePath)) ?? null,
    path: filePath,
  }));
  const ownerFileIds = new Set();
  const impactedFileIds = new Set();
  const ownerRecords = [];
  const changedNodeIds = new Set();
  for (const item of changedFiles) {
    if (!item.node) {
      continue;
    }
    changedNodeIds.add(item.node.id);
    const preEditResult = preEdit(item.path, sourceAtlas, indexes);
    for (const node of preEditResult.ownerFiles ?? []) {
      ownerFileIds.add(node.id);
    }
    for (const node of preEditResult.impactedFiles ?? []) {
      impactedFileIds.add(node.id);
    }
    ownerRecords.push(...fileOwners(item.path, sourceAtlas, indexes).owners);
  }
  const changedNodes = [...changedNodeIds]
    .map((id) => indexes.nodes.get(id))
    .filter(Boolean)
    .sort(sortById);
  const ownerFiles = [...ownerFileIds]
    .map((id) => indexes.nodes.get(id))
    .filter(Boolean)
    .sort(sortById);
  const impactedFiles = [...impactedFileIds]
    .map((id) => indexes.nodes.get(id))
    .filter(Boolean)
    .sort(sortById);
  return {
    affected: rollupImpact(impactedFileIds, indexes),
    changedFiles,
    changedNodes,
    filter,
    impactedFiles,
    kind: "regression-scope",
    ownerFiles,
    owners: uniqueOwners(ownerRecords),
    verification: regressionVerificationPlan(changedFiles, impactedFiles),
  };
}

function fileOwners(value, sourceAtlas, indexes) {
  const directFiles = resolveNodes("file", value, sourceAtlas);
  const files =
    directFiles.length > 0
      ? directFiles
      : [...ownerFileIds(resolveTarget(value, sourceAtlas), indexes)]
          .map((id) => indexes.nodes.get(id))
          .filter(Boolean);
  const owners = [];
  for (const file of files) {
    owners.push({
      file,
      instructions: ownerFilesForPath(file.path, sourceAtlas),
    });
  }
  return {
    kind: "file-owners",
    value,
    nodes: files.sort(sortById),
    owners,
  };
}

function validateCoverage(sourceAtlas) {
  const issues = [];
  if (sourceAtlas.schemaVersion !== 2) {
    issues.push({ type: "schema_version", message: "atlas schemaVersion must be 2" });
  }
  if (sourceAtlas.cacheFormat !== "supaschema-code-atlas@2") {
    issues.push({ type: "cache_format", message: "atlas cacheFormat drifted" });
  }
  if (!sourceAtlas.metadata?.inputDigest) {
    issues.push({ type: "freshness", message: "atlas missing metadata.inputDigest" });
  }
  if (!sourceAtlas.summary?.byEdgeType) {
    issues.push({ type: "summary", message: "atlas missing summary.byEdgeType" });
  }
  const packageJson = safeJson(readText("package.json"));
  for (const item of packageJson?.files ?? []) {
    if (item.startsWith("scripts/code-atlas") || item === ".mcp.json") {
      issues.push({
        type: "package_boundary",
        message: `${item} is maintainer-only and must not be in package files`,
      });
    }
  }
  const mcp = safeJson(readText(".mcp.json"));
  if (mcp?.mcpServers?.codeatlas) {
    issues.push({
      type: "mcp_boundary",
      message: ".mcp.json must not expose standalone codeatlas",
    });
  }
  const codexConfig = readText(".codex/config.toml");
  if (codexConfig.includes("[mcp_servers.codeatlas]")) {
    issues.push({
      type: "mcp_boundary",
      message: ".codex/config.toml must not expose standalone codeatlas",
    });
  }
  const rule10 = readText(".claude/rules/10-code-atlas.md");
  if (rule10.includes("scripts/code-atlas/AGENTS.md")) {
    issues.push({
      type: "stale_guidance",
      message: "Rule 10 references missing scripts/code-atlas/AGENTS.md",
    });
  }
  return {
    kind: "validate-coverage",
    ok: issues.length === 0,
    issues,
  };
}

function ownerFilesForPath(filePath, sourceAtlas) {
  const owners = new Map();
  for (const ownerPath of nearestAgentFiles(filePath)) {
    addOwner(owners, ownerPath, "nearest AGENTS.md");
  }
  for (const rule of OWNER_RULES) {
    if (!filePath.startsWith(rule.prefix)) {
      continue;
    }
    for (const ownerPath of rule.owners) {
      addOwner(owners, ownerPath, `owner rule for ${rule.prefix}`);
    }
  }
  return [...owners.values()]
    .map((owner) => ({
      ...owner,
      node: sourceAtlas.nodes.find((node) => node.id === fileId(owner.path)) ?? null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function nearestAgentFiles(filePath) {
  const out = [];
  let current = path.posix.dirname(filePath);
  while (true) {
    const candidate = current === "." ? "AGENTS.md" : `${current}/AGENTS.md`;
    if (fs.existsSync(path.join(ROOT, candidate))) {
      out.push(candidate);
    }
    if (current === "." || current === "") {
      break;
    }
    current = path.posix.dirname(current);
  }
  return out;
}

function addOwner(owners, ownerPath, reason) {
  if (!fs.existsSync(path.join(ROOT, ownerPath))) {
    return;
  }
  owners.set(ownerPath, { path: ownerPath, reason });
}

function verificationPlan(value, impactResult) {
  const commands = [
    `npm run code-atlas:query -- trace-change ${value} --json`,
    "npm run guard:code-atlas",
  ];
  if (impactResult.affected.apis.length > 0 || impactResult.affected.workers.length > 0) {
    commands.push("npm run guard:fastmcp");
  }
  return {
    commands,
    proof: [
      "Use Code Atlas for owner and blast-radius navigation.",
      "Use cclsp for exact symbols on owner files.",
      "Read source before final behavioral claims.",
    ],
  };
}

function health(filter, sourceAtlas, indexes, options = {}) {
  const issues = [];
  for (const node of sourceAtlas.nodes.filter((candidate) => candidate.kind === "file")) {
    const importCount = (indexes.outgoing.get(node.id) ?? []).filter((edge) =>
      ["imports_file", "imports_module", "imports_package"].includes(edge.type)
    ).length;
    if (importCount >= 10) {
      issues.push({
        severity: importCount >= 25 ? "warning" : "info",
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
      issues.push({ severity: "error", type: "route_without_owner", node: route });
    }
  }
  for (const router of sourceAtlas.nodes.filter((node) => node.kind === "api_router")) {
    const registrations = indexes.incoming.get(router.id) ?? [];
    if (!registrations.some((edge) => edge.type === "registers_api_router")) {
      issues.push({
        severity: "error",
        type: "api_router_missing_framework_registration",
        node: router,
      });
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
      issues.push({ severity: "error", type: "worker_job_missing_module", node: worker });
    }
  }
  const filtered = filter
    ? issues.filter((issue) => JSON.stringify(issue).toLowerCase().includes(filter.toLowerCase()))
    : issues;
  const sorted = filtered.sort(sortHealthIssue);
  return {
    kind: "health",
    value: filter,
    ok: healthOk(sorted, options.strict),
    strict: Boolean(options.strict),
    issues: sorted,
  };
}

function changedRepoFiles(filter) {
  const files = new Set();
  for (const filePath of gitLines(["diff", "--name-only", "HEAD", "--"])) {
    files.add(filePath);
  }
  for (const filePath of gitLines(["ls-files", "--others", "--exclude-standard"])) {
    files.add(filePath);
  }
  return [...files]
    .filter((filePath) => !filter || filePath.toLowerCase().includes(filter.toLowerCase()))
    .sort();
}

function gitLines(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueOwners(owners) {
  const byPathAndReason = new Map();
  for (const owner of owners) {
    byPathAndReason.set(`${owner.path}\0${owner.reason}`, owner);
  }
  return [...byPathAndReason.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function regressionVerificationPlan(changedFiles, impactedFiles) {
  const paths = changedFiles.map((item) => item.path);
  const commands = [
    "npm run code-atlas:query -- regression-scope --json",
    "npm run guard:code-atlas",
  ];
  if (
    paths.some((item) => item.startsWith("scripts/agent-hooks/") || item.startsWith(".claude/"))
  ) {
    commands.push("npm run guard:agent");
  }
  if (paths.some((item) => item.startsWith("services/agent-mcp/"))) {
    commands.push("npm run guard:fastmcp");
  }
  if (paths.some((item) => item.startsWith("scripts/code-atlas/"))) {
    commands.push("node scripts/guards/check-canonical-surfaces.mjs");
  }
  return {
    commands: uniqueStrings(commands),
    impactedFileCount: impactedFiles.length,
    proof: [
      "Use regression-scope to derive the changed-file owner and impact set.",
      "Run the target guards for each changed surface before completion.",
    ],
  };
}

function healthOk(issues, strictHealth) {
  if (issues.some((issue) => issue.severity === "error")) {
    return false;
  }
  return !(strictHealth && issues.some((issue) => issue.severity === "warning"));
}

function sortHealthIssue(left, right) {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) {
    return severity;
  }
  const type = String(left.type ?? "").localeCompare(String(right.type ?? ""));
  if (type !== 0) {
    return type;
  }
  return String(left.node?.id ?? "").localeCompare(String(right.node?.id ?? ""));
}

function severityRank(value) {
  if (value === "error") {
    return 3;
  }
  if (value === "warning") {
    return 2;
  }
  return 1;
}

function uniqueStrings(values) {
  return [...new Set(values)];
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
  const result = spawnSync("node", ["scripts/code-atlas/mcp-launcher.mjs", "--status"], {
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
        const source = indexes.nodes.get(edge.from);
        if (
          !CONSUMER_EDGE_TYPES.has(edge.type) ||
          source?.kind !== "file" ||
          visited.has(edge.from)
        ) {
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

function emptyImpact() {
  return {
    routes: [],
    apis: [],
    workers: [],
    db: [],
    packages: [],
  };
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

async function loadAtlas({ noRebuild: useCacheOnly }) {
  if (useCacheOnly) {
    const cached = readCachedAtlas(OUTPUT_PATH);
    if (!cached) {
      throw new Error("Code Atlas cache missing; run npm run code-atlas:build first");
    }
    return cached;
  }
  const fresh = await buildCodeAtlas({ write: false });
  const cached = readCachedAtlas(OUTPUT_PATH);
  if (cached?.metadata?.inputDigest !== fresh.metadata?.inputDigest) {
    atomicWriteJson(OUTPUT_PATH, fresh);
  }
  return fresh;
}

function takeFlag(targetArgs, flag) {
  const index = targetArgs.indexOf(flag);
  if (index === -1) {
    return false;
  }
  targetArgs.splice(index, 1);
  return true;
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
  return `Usage: node scripts/code-atlas/query.mjs <kind> [value] [--json] [--no-rebuild] [--strict]

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
  trace-change <target>
                       Agent work pack: impact, consumers, owners, verification commands.
  file-owners <target>
                       Nearest AGENTS.md plus atlas/rule/skill owners for files.
  regression-scope [value]
                       Changed-file owner and impact set from git status/diff.
  validate-coverage   Guardable coverage and package/MCP boundary checks.
  health [value]      Report ranked atlas consistency risks; --strict fails on warnings.
  mcp-status [value]  Report optional live Code Atlas MCP status.`;
}
