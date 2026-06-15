export function createAtlasGraph(targetAtlas) {
  const nodeIndex = new Map();
  const edgeKeys = new Set();

  return {
    addNode: (node) => addGraphNode(targetAtlas, nodeIndex, node),
    addEdge: (edge) => addGraphEdge(targetAtlas, edgeKeys, edge),
  };
}

function addGraphNode(targetAtlas, nodeIndex, node) {
  const id = node.id;
  if (!id) {
    throw new Error("atlas node missing id");
  }
  const existing = nodeIndex.get(id);
  if (!existing) {
    return insertNode(targetAtlas, nodeIndex, node);
  }
  mergeNode(existing, node);
  return existing;
}

function addGraphEdge(targetAtlas, edgeKeys, edge) {
  if (!(edge.from && edge.to && edge.type)) {
    throw new Error("atlas edge missing from, to, or type");
  }
  const evidence = edge.evidence ?? "";
  const key = `${edge.from}\0${edge.to}\0${edge.type}\0${evidence}`;
  if (edgeKeys.has(key)) {
    return;
  }
  edgeKeys.add(key);
  targetAtlas.edges.push({ ...edge, evidence });
}

function insertNode(targetAtlas, nodeIndex, node) {
  const next = { ...node };
  nodeIndex.set(node.id, next);
  targetAtlas.nodes.push(next);
  return next;
}

function mergeNode(existing, node) {
  for (const [key, value] of Object.entries(node)) {
    mergeNodeValue(existing, key, value);
  }
}

function mergeNodeValue(existing, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (Array.isArray(value)) {
    const current = Array.isArray(existing[key]) ? existing[key] : [];
    existing[key] = [...new Set([...current, ...value])].sort();
    return;
  }
  if (typeof value === "object") {
    existing[key] = { ...(existing[key] ?? {}), ...value };
    return;
  }
  if (existing[key] === undefined || existing[key] === null || existing[key] === "") {
    existing[key] = value;
  }
}

export function finalizeAtlas(targetAtlas) {
  targetAtlas.nodes.sort((left, right) => left.id.localeCompare(right.id));
  targetAtlas.edges.sort(edgeSortKey);
  const byKind = {};
  const byEdgeType = {};
  for (const node of targetAtlas.nodes) {
    byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
  }
  for (const edge of targetAtlas.edges) {
    byEdgeType[edge.type] = (byEdgeType[edge.type] ?? 0) + 1;
  }
  targetAtlas.summary = {
    nodes: targetAtlas.nodes.length,
    edges: targetAtlas.edges.length,
    byKind,
    byEdgeType,
  };
}

export function edgeSortKey(left, right) {
  return `${left.from}\0${left.to}\0${left.type}\0${left.evidence}`.localeCompare(
    `${right.from}\0${right.to}\0${right.type}\0${right.evidence}`
  );
}
