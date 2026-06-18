"""In-memory FastMCP client tests for the read-only local supaschema server.

These tests connect an in-memory `Client` directly to the `mcp` server object
(no subprocess, no Inspector, no database). They pin the three things that are
the server's whole reason to exist:

1. After removing ``BM25SearchTransform`` the real tools are directly listable
   via ``list_tools()`` (no ``search_tools`` -> ``call_tool`` round trip).
2. The read-only path guards in ``_resolve``/``_denied`` reject traversal,
   absolute paths, ``.env``, secret-suffixed paths, and ``DENIED_PARTS`` dirs,
   while one allowlisted file (``AGENTS.md``) reads successfully.
3. ``server_status`` advertises docs-research MCP servers that are actually
   configured in ``.mcp.json`` (runtime catalog-drift pin).
"""

from __future__ import annotations

import json

import pytest
from fastmcp.client import Client
from fastmcp.exceptions import ToolError

from supaschema_agent_mcp.server import REPO_ROOT, mcp

EXPECTED_TOOLS = {
    "server_status",
    "code_atlas_query",
    "repo_context_query",
    "repo_safety_scan",
}

LEGACY_TOOL_NAMES = {
    "search_repo_context",
    "read_context_file",
    "nearest_agent_instructions",
    "upstream_mcp_capabilities",
}


TOOL_SEARCH_ARTIFACTS = {"call_tool", "search_tools"}


REJECTED_PATHS = [
    "../etc/passwd",
    "/etc/passwd",
    ".env",
    "secrets/app.key",
    "node_modules/foo/index.js",
    "secrets/plan.txt",
    "plans/roadmap.md",
]


def _mcp_configured_servers() -> set[str]:
    """Server names configured in the repo .mcp.json (source of truth)."""
    config = json.loads((REPO_ROOT / ".mcp.json").read_text(encoding="utf8"))
    return set(config.get("mcpServers", {}))


async def _read_context(client: Client, path: str) -> dict:
    """Call repo_context_query(read) and return its structured payload."""
    result = await client.call_tool("repo_context_query", {"action": "read", "target": path})
    return result.data


async def test_list_tools_exposes_real_catalog_after_bm25_removal() -> None:
    async with Client(transport=mcp) as client:
        names = {tool.name for tool in await client.list_tools()}

    assert names == EXPECTED_TOOLS, f"unexpected tool catalog: {sorted(names)}"
    assert not (LEGACY_TOOL_NAMES & names), (
        f"legacy tools still listed: {LEGACY_TOOL_NAMES & names}"
    )

    assert not (TOOL_SEARCH_ARTIFACTS & names), (
        f"BM25/Tool-Search artifacts still listed: {TOOL_SEARCH_ARTIFACTS & names}"
    )


@pytest.mark.parametrize("bad_path", REJECTED_PATHS)
async def test_read_context_file_rejects_unsafe_paths(bad_path: str) -> None:
    async with Client(transport=mcp) as client:
        with pytest.raises(ToolError, match=r"repo-relative paths only|path is denied"):
            await _read_context(client, bad_path)


async def test_secret_suffix_variants_are_all_rejected() -> None:

    secret_paths = [
        "src/server.key",
        "src/cert.pem",
        "src/store.p12",
        "src/store.pfx",
    ]
    async with Client(transport=mcp) as client:
        for path in secret_paths:
            with pytest.raises(ToolError, match="path is denied"):
                await _read_context(client, path)


async def test_dotenv_family_is_rejected() -> None:

    async with Client(transport=mcp) as client:
        for path in (".env", ".env.local", ".env.production"):
            with pytest.raises(ToolError, match="path is denied"):
                await _read_context(client, path)


async def test_read_context_file_reads_allowlisted_agents_md() -> None:

    assert (REPO_ROOT / "AGENTS.md").is_file()

    async with Client(transport=mcp) as client:
        payload = await _read_context(client, "AGENTS.md")

    assert payload["path"] == "AGENTS.md"
    assert isinstance(payload["text"], str)
    assert payload["text"].strip(), "AGENTS.md read returned empty text"


async def test_code_atlas_query_exposes_local_graph() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "code_atlas_query",
            {"kind": "file", "value": "services/agent-mcp/supaschema_agent_mcp/server.py"},
        )
    payload = result.data

    assert payload["ok"] is True
    assert payload["stdout"]["nodes"]
    assert (
        payload["stdout"]["nodes"][0]["path"] == "services/agent-mcp/supaschema_agent_mcp/server.py"
    )


async def test_code_atlas_query_exposes_trace_change() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "code_atlas_query",
            {"kind": "trace-change", "value": "services/agent-mcp/supaschema_agent_mcp/server.py"},
        )
    payload = result.data

    assert payload["ok"] is True
    assert payload["stdout"]["kind"] == "trace-change"
    assert payload["stdout"]["owners"]
    assert payload["stdout"]["verification"]["commands"]


async def test_repo_safety_scan_returns_structured_result() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "repo_safety_scan",
            {"source": "dir:examples/postgres/schemas"},
        )
    payload = result.data

    assert "ok" in payload
    assert "stdout" in payload
    assert "stderr" in payload


async def test_repo_safety_scan_rejects_unsafe_source() -> None:
    async with Client(transport=mcp) as client:
        with pytest.raises(ToolError, match=r"unsafe source value"):
            await client.call_tool("repo_safety_scan", {"source": "-rm"})


async def test_repo_safety_scan_rejects_database_source() -> None:
    async with Client(transport=mcp) as client:
        with pytest.raises(ToolError, match=r"stays local"):
            await client.call_tool("repo_safety_scan", {"source": "database:postgres://u:p@h/db"})


async def test_code_atlas_query_exposes_regression_scope() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool("code_atlas_query", {"kind": "regression-scope"})
    payload = result.data

    assert payload["ok"] is True
    assert payload["stdout"]["kind"] == "regression-scope"
    assert isinstance(payload["stdout"]["changedFiles"], list)
    assert "npm run guard:code-atlas" in payload["stdout"]["verification"]["commands"]


async def test_repo_context_query_searches_allowlisted_repo_files() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "repo_context_query",
            {"action": "search", "target": "supaschema", "limit": 5},
        )
    payload = result.data

    assert payload["matches"], "expected search results for supaschema"
    assert all("path" in item and "line" in item and "text" in item for item in payload["matches"])


async def test_repo_context_query_returns_agent_instruction_chain() -> None:
    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "repo_context_query",
            {"action": "agent-instructions", "target": "services/agent-mcp"},
        )
    payload = result.data

    assert payload["path"] == "services/agent-mcp"
    assert payload["instructions"]
    assert payload["instructions"][0]["path"] == "AGENTS.md"


async def test_status_upstream_docs_capabilities_match_mcp_json() -> None:
    configured = _mcp_configured_servers()

    async with Client(transport=mcp) as client:
        result = await client.call_tool("server_status", {})
    payload = result.data["upstream_mcp_capabilities"]

    docs_capabilities = [item for item in payload["capabilities"] if item["family"] == "docs"]
    families = {item["family"] for item in docs_capabilities}
    assert families == {"docs"}, f"docs filter leaked other families: {families}"

    returned = {item["server"] for item in docs_capabilities}

    assert returned == {"cloudflare-docs", "mintlify"}
    assert returned <= configured, (
        f"advertised docs servers not in .mcp.json: {returned - configured}"
    )

    for item in docs_capabilities:
        assert item["configured"] is (item["server"] in configured)

    assert "Pointer index only" in payload["note"]


async def test_status_upstream_all_capabilities_only_advertise_configured_servers() -> None:
    configured = _mcp_configured_servers()

    async with Client(transport=mcp) as client:
        result = await client.call_tool("server_status", {})
    payload = result.data["upstream_mcp_capabilities"]

    assert result.data["server"] == "supaschema"
    assert set(result.data["tools"]) == EXPECTED_TOOLS
    assert "pre-edit" in result.data["code_atlas_hint"]
    assert "standalone" not in result.data["code_atlas_hint"].lower()

    for item in payload["capabilities"]:
        if item["configured"]:
            assert item["server"] in configured, (
                f"{item['server']} flagged configured but missing from .mcp.json"
            )
