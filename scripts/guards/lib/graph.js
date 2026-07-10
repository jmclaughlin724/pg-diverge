export function edgeKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.type}\0${edge.evidence ?? ""}`;
}
