export const agentSurfaceManifest = Object.freeze({
  agentBundle: Object.freeze({
    targetRoot: "agent-bundle",
  }),
  agents: Object.freeze({
    sourceRoot: ".claude/agents",
    targetRoot: ".codex/agents",
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
});

export function isCanonicalAgentSurfaceSource(relativePath) {
  if (
    relativePath === ".claude/settings.json" ||
    relativePath === "scripts/skills/agent-surface-manifest.mjs" ||
    relativePath === "scripts/skills/sync-llm.mjs"
  ) {
    return true;
  }
  for (const surface of Object.values(agentSurfaceManifest)) {
    if (
      typeof surface.sourceRoot === "string" &&
      (relativePath === surface.sourceRoot || relativePath.startsWith(`${surface.sourceRoot}/`))
    ) {
      return true;
    }
  }
  return false;
}
