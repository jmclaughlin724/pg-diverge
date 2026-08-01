export const agentSurfaceManifest = Object.freeze({
  agentBundle: Object.freeze({
    targetRoot: "agent-bundle",
  }),
  agents: Object.freeze({
    sourceRoot: ".claude/agents",
    targetRoot: ".codex/agents",
  }),
  bundleDocs: Object.freeze({
    sourceExtension: ".mdx",
    sourceRoot: "docs",
    targetRoot: "agent-bundle/docs",
  }),
  hooks: Object.freeze({
    sourceRoot: ".claude/hooks",
    targetRoot: ".codex/hooks",
  }),
  publicSkills: Object.freeze({
    sourceRoot: ".claude/skills",
    targetRoot: "skills",
  }),
  rules: Object.freeze({
    sourceRoot: ".claude/rules",
    targetRoot: ".codex/rules",
  }),
  skills: Object.freeze({
    sourceRoot: ".claude/skills",
    targetRoots: Object.freeze([".agents/skills"]),
  }),
  sourcePrompts: Object.freeze({
    sourceExtension: ".md",
    sourceRoot: ".agents/prompts",
    targetRoot: "agent-bundle/agents/prompts",
  }),
  syncImplementation: Object.freeze({
    sourceExtension: ".mjs",
    sourceRoot: "scripts/skills",
  }),
});

export function isCanonicalAgentSurfaceSource(relativePath) {
  if (relativePath === ".claude/settings.json") {
    return true;
  }
  for (const surface of Object.values(agentSurfaceManifest)) {
    if (typeof surface.sourceRoot !== "string") {
      continue;
    }
    const withinSourceRoot =
      relativePath === surface.sourceRoot || relativePath.startsWith(`${surface.sourceRoot}/`);
    if (!withinSourceRoot) {
      continue;
    }
    if (
      typeof surface.sourceExtension !== "string" ||
      relativePath.endsWith(surface.sourceExtension)
    ) {
      return true;
    }
  }
  return false;
}
