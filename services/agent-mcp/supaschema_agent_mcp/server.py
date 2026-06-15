import json
import subprocess
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

REPO_ROOT = Path(__file__).resolve().parents[3]
MAX_READ_BYTES = 120_000

DENIED_PARTS = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    "coverage",
    "node_modules",
    "plans",
    "secrets",
    "venv",
}
SECRET_SUFFIXES = (".key", ".pem", ".p12", ".pfx")
SEARCH_PREFIXES = (
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
    ".claude/skills/",
    ".codex/rules/",
    ".codex/skills/",
    ".agents/skills/",
)
SEARCH_FILES = {
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pyproject.toml",
    "fastmcp.json",
    ".mcp.json",
    ".claude/cclsp.json",
    ".claude/settings.json",
    ".codex/config.toml",
}


def _denied(p: Path) -> bool:
    n = p.name
    if n == ".env" or n.startswith(".env.") or n.endswith(SECRET_SUFFIXES):
        return True
    return any(part in DENIED_PARTS or part.startswith(".codeatlas") for part in p.parts)


def _resolve(raw: str) -> Path:
    pp = PurePosixPath(raw.strip())
    if pp.is_absolute() or any(s in {"", ".", ".."} for s in pp.parts):
        raise ValueError("repo-relative paths only, no traversal")
    rel = (REPO_ROOT / Path(*pp.parts)).resolve()
    if not rel.is_relative_to(REPO_ROOT):
        raise ValueError("outside repo root")
    repo_relative = rel.relative_to(REPO_ROOT)
    if _denied(repo_relative):
        raise ValueError("path is denied")
    return repo_relative


def _read_text(rel: Path, max_bytes: int = MAX_READ_BYTES) -> str:
    full = REPO_ROOT / rel
    if not full.is_file():
        raise ValueError("not a file")
    if full.stat().st_size > max_bytes:
        raise ValueError("file is too large for context read")
    return full.read_text(encoding="utf8", errors="replace")


def _git_files() -> list[str]:
    r = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return []
    return [
        item
        for item in r.stdout.split("\0")
        if item
        and (item in SEARCH_FILES or item.startswith(SEARCH_PREFIXES))
        and not _denied(Path(item))
    ]


def _mcp_configured() -> set[str]:
    config = REPO_ROOT / ".mcp.json"
    if not config.exists():
        return set()
    try:
        parsed = json.loads(config.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return set()
    servers = parsed.get("mcpServers")
    if isinstance(servers, dict):
        return set(servers)
    return set()


mcp = FastMCP(
    "Supaschema Agent Context",
    mask_error_details=True,
)

READ_ONLY_TOOL = ToolAnnotations(
    readOnlyHint=True,
    openWorldHint=False,
    idempotentHint=True,
)

CodeAtlasQueryKind = Literal[
    "route",
    "file",
    "package",
    "symbol",
    "db",
    "policy",
    "api",
    "worker",
    "search",
    "consumers",
    "entrypoints",
    "impact",
    "pre-edit",
    "health",
    "mcp-status",
]


@mcp.tool(annotations=READ_ONLY_TOOL)
def server_status() -> dict[str, Any]:
    """Summarize this read-only repo-context server."""
    return {
        "server": "repo_context",
        "readonly": True,
        "repo_root": str(REPO_ROOT),
        "blocked_capabilities": [
            "raw SQL",
            "arbitrary shell",
            "DB/API mutation",
            "credential reads",
            "external LLM calls",
        ],
    }


@mcp.tool(annotations=READ_ONLY_TOOL)
def code_atlas_query(
    kind: Annotated[CodeAtlasQueryKind, Field(description="Fixed Code Atlas query kind")],
    value: Annotated[str | None, Field(description="Optional query value")] = None,
) -> dict[str, Any]:
    """Run one fixed Code Atlas query, never a generic command runner."""
    v = (value or "").strip()
    if v and (
        v.startswith("-") or any(c in v for c in "\x00\n\r") or ".." in PurePosixPath(v).parts
    ):
        raise ValueError("unsafe query value")
    args = ["node", "scripts/code-atlas/query.mjs", kind] + ([v] if v else []) + ["--json"]
    r = subprocess.run(args, cwd=REPO_ROOT, capture_output=True, text=True, timeout=45, check=False)
    stdout: Any
    try:
        stdout = json.loads(r.stdout or "null")
    except json.JSONDecodeError:
        stdout = r.stdout[:MAX_READ_BYTES]
    return {"ok": r.returncode == 0, "stdout": stdout, "stderr": r.stderr[:MAX_READ_BYTES]}


@mcp.tool(annotations=READ_ONLY_TOOL)
def search_repo_context(
    query: Annotated[str, Field(min_length=2, description="Literal text to search for")],
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
) -> dict[str, Any]:
    """Literal search over allowlisted repo context scopes."""
    needle = query.lower()
    matches: list[dict[str, Any]] = []
    for file in _git_files():
        rel = _resolve(file)
        try:
            text = _read_text(rel)
        except ValueError:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"path": str(rel), "line": number, "text": line[:500]})
                if len(matches) >= limit:
                    return {"matches": matches}
    return {"matches": matches}


@mcp.tool(annotations=READ_ONLY_TOOL)
def read_context_file(
    path: Annotated[str, Field(description="Repo-relative allowlisted path")],
) -> dict[str, Any]:
    """Read one safe repo context file."""
    rel = _resolve(path)
    return {"path": str(rel), "text": _read_text(rel)}


@mcp.tool(annotations=READ_ONLY_TOOL)
def nearest_agent_instructions(
    path: Annotated[str, Field(description="Repo-relative file or directory path")],
) -> dict[str, Any]:
    """Return root-to-nearest AGENTS.md instruction files for a repo path."""
    rel = _resolve(path)
    full = REPO_ROOT / rel
    current = full if full.is_dir() else full.parent
    chain: list[dict[str, str]] = []
    while current.is_relative_to(REPO_ROOT):
        candidate = current / "AGENTS.md"
        if candidate.exists() and not _denied(candidate.relative_to(REPO_ROOT)):
            item_rel = candidate.relative_to(REPO_ROOT)
            chain.append({"path": str(item_rel), "text": _read_text(item_rel)})
        if current == REPO_ROOT:
            break
        current = current.parent
    chain.reverse()
    return {"path": str(rel), "instructions": chain}


@mcp.tool(annotations=READ_ONLY_TOOL)
def upstream_mcp_capabilities(
    capability: Annotated[
        Literal["all", "docs", "framework", "library", "product"],
        Field(description="Capability family to list"),
    ] = "all",
) -> dict[str, Any]:
    """Return a read-only pointer index for external docs MCP research servers."""
    configured = _mcp_configured()
    index = [
        {
            "server": "context7",
            "family": "library",
            "use_for": "Current library docs by package name.",
        },
        {"server": "zod", "family": "library", "use_for": "Current Zod documentation."},
        {
            "server": "ultracite",
            "family": "library",
            "use_for": "Ultracite linting and formatting docs.",
        },
        {
            "server": "next-devtools",
            "family": "framework",
            "use_for": "Current Next.js app-router and runtime behavior research.",
        },
        {
            "server": "mintlify",
            "family": "docs",
            "use_for": "Mintlify authoring and validation docs.",
        },
        {
            "server": "cloudflare-docs",
            "family": "docs",
            "use_for": "Cloudflare product documentation.",
        },
        {
            "server": "openaiDeveloperDocs",
            "family": "product",
            "use_for": "OpenAI API, Agents SDK, and ChatGPT Apps documentation.",
        },
        {"server": "supaschema-docs", "family": "product", "use_for": "Published supaschema docs."},
        {"server": "sentry", "family": "product", "use_for": "Sentry product documentation."},
    ]
    filtered = [item for item in index if capability == "all" or item["family"] == capability]
    return {
        "note": "Pointer index only; this server never calls or proxies other MCP servers.",
        "capabilities": [{**item, "configured": item["server"] in configured} for item in filtered],
    }


@mcp.resource("repo://agents/root")
def root_agents() -> str:
    return _read_text(Path("AGENTS.md"))


@mcp.resource("repo://rules/{name}")
def rule_resource(name: str) -> str:
    rel = _resolve(f".claude/rules/{name}.md")
    return _read_text(rel)


@mcp.resource("repo://skills/{name}")
def skill_resource(name: str) -> str:
    rel = _resolve(f".claude/skills/{name}/SKILL.md")
    return _read_text(rel)


@mcp.resource("repo://mcp/config")
def mcp_config_resource() -> str:
    rel = _resolve(".mcp.json")
    return _read_text(rel)


@mcp.prompt
def prepare_repo_change(target: str) -> str:
    return (
        "Before changing broad ownership, route, dependency, DB, API, worker, generated surface, "
        f"or deploy behavior for {target}, build/query Code Atlas, use cclsp on owner files, "
        "then read source before making behavioral claims."
    )


@mcp.prompt
def review_repo_change(target: str) -> str:
    return (
        f"Review {target} by prioritizing behavioral regressions, missing guards, "
        "source-of-truth drift, and whether Code Atlas/cclsp/source evidence "
        "supports the change."
    )


@mcp.prompt
def verify_repo_change(target: str) -> str:
    return (
        f"Verify {target} with the narrowest relevant tests first, then the repo guard for changed "
        "agent, atlas, docs, or package surfaces."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
