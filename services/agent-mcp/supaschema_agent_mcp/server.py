import base64
import json
import subprocess
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import PromptError, ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

REPO_ROOT = Path(__file__).resolve().parents[3]
MAX_READ_BYTES = 120_000

PRIVATE_PATHS_FILE = REPO_ROOT / "scripts" / "guards" / "repo-surface" / "private-paths.json"


def _load_private_prefixes() -> tuple[str, ...]:
    data = json.loads(PRIVATE_PATHS_FILE.read_text(encoding="utf8"))
    prefixes = data["heldPrivate"] + data["agentPrivate"]
    return tuple(p for p in prefixes if isinstance(p, str) and p.endswith("/"))


PRIVATE_PREFIXES = _load_private_prefixes()

DENIED_PARTS = {
    ".git",
    ".tmp",
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
SECRET_NAMES = {".dev.vars", ".netrc", ".npmrc", ".pgpass", ".pypirc"}
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
    ".agents/skills/",
)
SEARCH_FILES = {
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pyproject.toml",
    "fastmcp.json",
    ".mcp.json",
    "cclsp.json",
    ".claude/settings.json",
    ".codex/config.toml",
}


def _denied(p: Path) -> bool:
    n = p.name
    if n.startswith(".env") or n.endswith(SECRET_SUFFIXES):
        return True
    if n in SECRET_NAMES or n.startswith(".dev.vars."):
        return True
    if p.as_posix().startswith(PRIVATE_PREFIXES):
        return True
    return any(part in DENIED_PARTS for part in p.parts)


def _resolve(raw: str) -> Path:
    pp = PurePosixPath(raw.strip())
    if pp.is_absolute() or any(s in {"", ".", ".."} for s in pp.parts):
        raise ToolError("repo-relative paths only, no traversal")
    rel = (REPO_ROOT / Path(*pp.parts)).resolve()
    if not rel.is_relative_to(REPO_ROOT):
        raise ToolError("outside repo root")
    repo_relative = rel.relative_to(REPO_ROOT)
    if _denied(repo_relative):
        raise ToolError("path is denied")
    return repo_relative


def _read_text(rel: Path, max_bytes: int = MAX_READ_BYTES) -> str:
    full = REPO_ROOT / rel
    if not full.is_file():
        raise ToolError("not a file")
    if full.stat().st_size > max_bytes:
        raise ToolError("file is too large for context read")
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
    "Supaschema Local Context",
    mask_error_details=True,
)

READ_ONLY_TOOL = ToolAnnotations(
    readOnlyHint=True,
    openWorldHint=False,
    idempotentHint=True,
)

RepoContextAction = Literal["search", "read", "agent-instructions"]


def _upstream_mcp_capabilities(
    capability: Literal["all", "docs", "framework", "library", "product"] = "all",
) -> dict[str, Any]:
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
    ]
    filtered = [item for item in index if capability == "all" or item["family"] == capability]
    return {
        "note": "Pointer index only; this server never calls or proxies other MCP servers.",
        "capabilities": [{**item, "configured": item["server"] in configured} for item in filtered],
    }


def _search_repo_context(query: str, limit: int = 20) -> dict[str, Any]:
    needle = query.lower()
    matches: list[dict[str, Any]] = []
    for file in _git_files():
        rel = _resolve(file)
        try:
            text = _read_text(rel)
        except ToolError:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"path": str(rel), "line": number, "text": line[:500]})
                if len(matches) >= limit:
                    return {"matches": matches}
    return {"matches": matches}


def _read_context_file(path: str) -> dict[str, Any]:
    rel = _resolve(path)
    return {"path": str(rel), "text": _read_text(rel)}


def _nearest_agent_instructions(path: str) -> dict[str, Any]:
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
def server_status() -> dict[str, Any]:
    """Summarize this read-only local supaschema server."""
    return {
        "server": "supaschema",
        "readonly": True,
        "repo_root": str(REPO_ROOT),
        "tools": [
            "server_status",
            "repo_context_query",
            "repo_safety_scan",
            "session_state",
        ],
        "repo_context_hint": (
            "Use repo_context_query to search or read repository context and nearest AGENTS.md "
            "instructions. Prove exact behavior with source, the configured language server, "
            "and focused tests. Validate MCP/client configuration with npm run guard:fastmcp."
        ),
        "session_state_hint": (
            "Use session_state(session_id='<id>') to read this session's agent-hook ledger "
            "(edited targets, recorded evidence, response-correction lanes) and self-verify "
            "investigation coverage before editing or finalizing."
        ),
        "blocked_capabilities": [
            "live database, mutating, or generic SQL",
            "arbitrary shell",
            "DB/API mutation",
            "credential reads",
            "external LLM calls",
        ],
        "upstream_mcp_capabilities": _upstream_mcp_capabilities(),
    }


@mcp.tool(annotations=READ_ONLY_TOOL)
def repo_context_query(
    action: Annotated[RepoContextAction, Field(description="Repo context action")],
    target: Annotated[str, Field(description="Search text or repo-relative path")],
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
) -> dict[str, Any]:
    """Search/read safe repo context or load nearest agent instructions."""
    match action:
        case "search":
            if len(target.strip()) < 2:
                raise ToolError("search target must be at least 2 characters")
            return _search_repo_context(target, limit)
        case "read":
            return _read_context_file(target)
        case "agent-instructions":
            return _nearest_agent_instructions(target)
    raise ToolError("unsupported repo context action")


def _scan_source(value: str) -> str:
    if value in ("empty:", "git:HEAD", "git:INDEX"):
        return value
    for prefix in ("dir:", "dump:", "catalog:", "migrations:"):
        if value.startswith(prefix):
            rel = _resolve(value[len(prefix) :])
            return f"{prefix}{rel.as_posix()}"
    raise ToolError(
        "unsupported source; use a repo-relative dir:/dump:/catalog:/migrations: path, "
        "empty:, git:HEAD, or git:INDEX"
    )


@mcp.tool(annotations=READ_ONLY_TOOL)
def repo_safety_scan(
    source: Annotated[
        str | None, Field(description="Schema source to scan; defaults to the declarative tree")
    ] = None,
) -> dict[str, Any]:
    """Run a read-only supaschema safety scan and return JSON findings (no DB, no mutation)."""
    v = (source or "").strip()
    if v and (v.startswith("-") or any(c in v for c in "\x00\n\r")):
        raise ToolError("unsafe source value")
    if v.startswith("database:") or "://" in v:
        raise ToolError("repo_safety_scan stays local; database/URL sources are not allowed")
    cli = REPO_ROOT / "dist" / "cli.js"
    if not cli.is_file():
        return {
            "ok": False,
            "stdout": None,
            "stderr": "dist/cli.js is missing; run `npm run build` in the repository first",
        }
    args = ["node", "dist/cli.js", "scan", "--reporter", "json"]
    if v:
        args += ["--from", _scan_source(v)]
    r = subprocess.run(args, cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, check=False)
    stdout: Any
    try:
        stdout = json.loads(r.stdout or "null")
    except json.JSONDecodeError:
        stdout = r.stdout[:MAX_READ_BYTES]
    return {"ok": r.returncode == 0, "stdout": stdout, "stderr": r.stderr[:MAX_READ_BYTES]}


SECRET_NAME_MARKERS = ("ACCESS_KEY", "API_KEY", "PASSWORD", "PRIVATE_KEY", "SECRET", "TOKEN")


def _redact_url_passwords(text: str) -> str:
    out: list[str] = []
    index = 0
    while True:
        scheme_at = text.find("://", index)
        if scheme_at == -1:
            out.append(text[index:])
            break
        at_sign = -1
        authority_end = scheme_at + 3
        while authority_end < len(text) and text[authority_end] not in "/?# \t\n\r\"'":
            if text[authority_end] == "@":
                at_sign = authority_end
            authority_end += 1
        colon = text.find(":", scheme_at + 3, at_sign if at_sign != -1 else authority_end)
        if at_sign == -1 or colon == -1:
            out.append(text[index:authority_end])
            index = authority_end
            continue
        out.append(f"{text[index : colon + 1]}***")
        index = at_sign
    return "".join(out)


def _redact_quoted_assignments(text: str) -> str:
    out: list[str] = []
    cursor = 0
    while cursor < len(text):
        eq = text.find("=", cursor)
        if eq == -1:
            out.append(text[cursor:])
            break
        name_start = max(text.rfind(" ", 0, eq) + 1, 0)
        name = text[name_start:eq]
        quote = text[eq + 1 : eq + 2]
        if quote not in ("'", '"') or not any(m in name.upper() for m in SECRET_NAME_MARKERS):
            out.append(text[cursor : eq + 1])
            cursor = eq + 1
            continue
        close = text.find(quote, eq + 2)
        if close == -1:
            out.append(text[cursor:])
            break
        out.append(f"{text[cursor:name_start]}{name}={quote}***{quote}")
        cursor = close + 1
    return "".join(out)


def _redact(text: str) -> str:
    text = _redact_quoted_assignments(text)
    words = []
    mask_next = False
    for word in _redact_url_passwords(text).split(" "):
        if mask_next and word:
            words.append("***")
            mask_next = False
            continue
        mask_next = False
        name, separator, value = word.partition("=")
        if (
            separator
            and value
            and value.strip("\"'") != "***"
            and any(m in name.upper() for m in SECRET_NAME_MARKERS)
        ):
            words.append(f"{name}=***")
            continue
        if word.startswith("-") and any(
            m in word.upper().replace("-", "_") for m in SECRET_NAME_MARKERS
        ):
            words.append(word)
            mask_next = True
            continue
        words.append(word)
    return " ".join(words)


@mcp.tool(annotations=READ_ONLY_TOOL)
def session_state(
    session_id: Annotated[str, Field(description="Session id to inspect")],
) -> dict[str, Any]:
    """Read a session's agent-hook ledger: edits, evidence, and response-correction lanes."""
    sid = (session_id or "").strip()
    if not sid or len(sid) > 200:
        raise ToolError("invalid session id")
    if any(ch in sid for ch in ("/", "\\", "\0")) or ".." in sid:
        raise ToolError("invalid session id")
    encoded = base64.urlsafe_b64encode(sid.encode()).decode().rstrip("=")
    state_file = REPO_ROOT / ".tmp" / "agent-hooks" / f"{encoded}.json"
    if not state_file.is_file():
        return {"ok": True, "session_id": sid, "state": None, "note": "no session state file found"}
    try:
        raw = json.loads(state_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"ok": True, "session_id": sid, "state": None, "note": "session state unreadable"}
    turns = raw.get("turns", {}) if isinstance(raw, dict) else {}
    response_corrections = raw.get("responseCorrections", {}) if isinstance(raw, dict) else {}
    evidence: list[dict[str, Any]] = []
    edited: list[str] = []
    pending: dict[str, str] = {}
    corrections: list[dict[str, Any]] = []
    for turn in turns.values():
        if not isinstance(turn, dict):
            continue
        for item in turn.get("evidence") or []:
            if isinstance(item, dict):
                evidence.append(
                    {
                        k: (
                            _redact(str(item.get(k)))
                            if k in ("command", "summary") and item.get(k) is not None
                            else item.get(k)
                        )
                        for k in (
                            "kind",
                            "domains",
                            "outcome",
                            "summary",
                            "command",
                        )
                    }
                )
        for target in turn.get("editedTargets") or []:
            if isinstance(target, str):
                edited.append(target)
        for name, info in (turn.get("pendingSkills") or {}).items():
            if isinstance(info, dict):
                pending[name] = str(info.get("reason", ""))
    correction_entries = (
        response_corrections.items() if isinstance(response_corrections, dict) else ()
    )
    for scope, entry in correction_entries:
        if not isinstance(scope, str) or not isinstance(entry, dict):
            continue
        for corr in entry.get("findings") or []:
            if isinstance(corr, dict):
                corrections.append(
                    {
                        "emitted": bool(corr.get("blocked")),
                        "id": corr.get("id"),
                        "message": corr.get("message"),
                        "scope": scope,
                    }
                )
    return {
        "ok": True,
        "session_id": sid,
        "editedTargets": sorted(set(edited)),
        "evidence": evidence,
        "pendingSkills": pending,
        "corrections": corrections,
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
    scope = json.dumps({"target": target}, ensure_ascii=True, sort_keys=True)
    return (
        f"Prepare the repository change target encoded by this JSON object: {scope}. "
        "Use repo_context_query to load the nearest AGENTS.md instructions and search for exact "
        "owners and consumers. Use the configured language server for symbol references, read "
        "every owner before editing, and validate MCP/client configuration changes with "
        "npm run guard:fastmcp."
    )


@mcp.prompt
def review_repo_change(base: str, head: str = "HEAD") -> str:
    if not base.strip():
        raise PromptError("base must be non-empty")
    if not head.strip():
        raise PromptError("head must be non-empty")
    scope = json.dumps({"base": base, "head": head}, ensure_ascii=True, sort_keys=True)
    return (
        f"Review the explicit diff scope encoded by this JSON object: {scope}. "
        "Use repo_context_query to load the nearest AGENTS.md instructions and "
        "exact owner context. "
        "Inspect only the explicit diff, require a changed filePath and re-read source for every "
        "finding, and report only actionable findings grounded in that diff. Use the model already "
        "authenticated by the host; do not send code, credentials, or review candidates to an "
        "external provider. Use the configured language server and focused tests for verification. "
        "Validate MCP/client configuration with npm run guard:fastmcp."
    )


@mcp.prompt
def verify_repo_change(target: str) -> str:
    scope = json.dumps({"target": target}, ensure_ascii=True, sort_keys=True)
    return (
        f"Verify the repository change target encoded by this JSON object: {scope}. "
        "Use repo_context_query to load the nearest AGENTS.md instructions and "
        "exact owner context, "
        "call session_state when a session ID is available, and call repo_safety_scan for schema, "
        "SQL, or migration changes. Use the configured language server for impacted "
        "symbols and run "
        "the narrowest relevant tests plus the sync and agent guards for their owned surfaces. For "
        "MCP/client configuration surfaces, run npm run guard:fastmcp."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
