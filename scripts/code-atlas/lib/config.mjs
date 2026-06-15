import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const OUTPUT_PATH = path.join(ROOT, ".tmp", "code-atlas", "atlas.json");
export const CACHE_FORMAT = "supaschema-code-atlas@2";
export const SCHEMA_VERSION = 2;

export const ACTIVE_PREFIXES = [
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
  ".claude/skills/fastmcp-client-cli/",
  ".claude/skills/supaschema/",
  ".claude/skills/upstream/",
  ".claude/hooks/",
  ".codex/rules/",
  ".codex/skills/code-atlas/",
  ".codex/skills/fastmcp/",
  ".codex/skills/fastmcp-client-cli/",
  ".codex/skills/supaschema/",
  ".codex/skills/upstream/",
  ".codex/hooks/",
  ".agents/skills/code-atlas/",
  ".agents/skills/fastmcp/",
  ".agents/skills/fastmcp-client-cli/",
  ".agents/skills/supaschema/",
  ".agents/skills/upstream/",
];

export const ACTIVE_FILES = [
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
  ".claude/cclsp.json",
  ".claude/settings.json",
  ".codex/config.toml",
  ".codex/hooks.json",
  "lefthook.yml",
];

export const DENY_SEGMENTS = new Set([
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

export const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
export const ROUTE_OWNERS = new Set(["page", "route"]);

export function createAtlasEnvelope() {
  return {
    version: SCHEMA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    cacheFormat: CACHE_FORMAT,
    generatedAt: new Date().toISOString(),
    root: ROOT,
    metadata: {},
    nodes: [],
    edges: [],
    diagnostics: [],
    summary: {},
  };
}

export function isActivePath(file) {
  if (ACTIVE_FILES.includes(file)) {
    return true;
  }
  if (!ACTIVE_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return false;
  }
  return !file.split("/").some((segment) => DENY_SEGMENTS.has(segment));
}

export function fileId(file) {
  return `file:${file}`;
}

export function dbObjectId(dbKind, schema, name) {
  return `db_object:${dbKind}:${schema}.${name}`;
}

export function extensionFor(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  if (extension) {
    return extension;
  }
  const basename = path.basename(file).toLowerCase();
  return basename === "dockerfile" ? "dockerfile" : "";
}

export function languageFor(file) {
  const extension = extensionFor(file);
  const languages = {
    cjs: "javascript",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    mdx: "mdx",
    mjs: "javascript",
    py: "python",
    sql: "sql",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    yaml: "yaml",
    yml: "yaml",
  };
  return languages[extension] ?? extension;
}

export function trimExtension(file) {
  const extension = path.extname(file);
  return extension ? file.slice(0, -extension.length) : file;
}
