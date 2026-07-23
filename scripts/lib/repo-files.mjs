import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const canonicalPathsModule = new URL("../../src/paths.ts", import.meta.url);
const { pathContainsOrEqual } = await import(canonicalPathsModule.href);

export const LOCAL_REPOSITORY_FILES = [
  "package.json",
  "package-lock.json",
  "pyproject.toml",
  "uv.lock",
  "fastmcp.json",
  "tsconfig.json",
  "tsconfig.src.json",
  "tsconfig.tools.json",
  "biome.jsonc",
  "supaschema.config.json",
  "wrangler.toml",
  "action.yml",
  "AGENTS.md",
  "CLAUDE.md",
  ".mcp.json",
  "cclsp.json",
  ".claude/settings.json",
  ".codex/config.toml",
  ".codex/hooks.json",
  "lefthook.yml",
];

export const LOCAL_REPOSITORY_PREFIXES = [
  "src/",
  "tests/",
  "scripts/",
  "docs/",
  "examples/",
  "corpus/",
  "benchmarks/",
  "bin/",
  "cloudflare/",
  "services/",
  ".github/workflows/",
  ".claude/rules/",
  ".claude/skills/code-atlas/",
  ".claude/skills/fastmcp/",
  ".claude/skills/optimizer/",
  ".claude/skills/supaschema/",
  ".claude/skills/upstream/",
  ".claude/hooks/",
  ".codex/rules/",
  ".codex/hooks/",
  ".agents/skills/code-atlas/",
  ".agents/skills/fastmcp/",
  ".agents/skills/optimizer/",
  ".agents/skills/supaschema/",
  ".agents/skills/upstream/",
];

export const REPOSITORY_DENY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  "coverage",
  ".tmp",
  "plans",
]);

export const LOCAL_BIOME_PATHS = [
  "scripts/code-atlas",
  "scripts/stripe",
  "services/license-worker",
  "cloudflare",
  ".claude/skills",
  ".claude/settings.local.json",
  ".mcp.json",
  ".vscode",
  "fastmcp.json",
];

export function isRepositoryContextPath(file) {
  if (LOCAL_REPOSITORY_FILES.includes(file)) {
    return true;
  }
  if (!LOCAL_REPOSITORY_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return false;
  }
  return !file.split("/").some((segment) => REPOSITORY_DENY_SEGMENTS.has(segment));
}

function isSafeRegularFile(file, repositoryRoot) {
  try {
    return lstatSync(file).isFile() && pathContainsOrEqual(repositoryRoot, realpathSync(file));
  } catch {
    return false;
  }
}

export function collectRepoFiles(roots, extension, { cwd = process.cwd() } = {}) {
  const workingDirectory = realpathSync(cwd);
  const repoRoot = realpathSync(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workingDirectory,
      encoding: "utf8",
    }).trim()
  );
  const ownedRoots = roots.map((root) => {
    const absoluteRoot = resolve(workingDirectory, root);
    return existsSync(absoluteRoot) ? realpathSync(absoluteRoot) : absoluteRoot;
  });
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  return output
    .split("\0")
    .filter(Boolean)
    .map((file) => join(repoRoot, file))
    .filter((file) => file.endsWith(extension) && isSafeRegularFile(file, repoRoot))
    .filter((file) => ownedRoots.some((root) => pathContainsOrEqual(root, file)))
    .map((file) => relative(workingDirectory, file))
    .sort();
}
