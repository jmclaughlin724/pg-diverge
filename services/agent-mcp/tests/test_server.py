"""In-memory FastMCP client tests for the read-only repo-context server.

These tests connect an in-memory `Client` directly to the `mcp` server object
(no subprocess, no Inspector, no database). They pin the three things that are
the server's whole reason to exist:

1. After removing ``BM25SearchTransform`` the real tools are directly listable
   via ``list_tools()`` (no ``search_tools`` -> ``call_tool`` round trip).
2. The read-only path guards in ``_resolve``/``_denied`` reject traversal,
   absolute paths, ``.env``, secret-suffixed paths, and ``DENIED_PARTS`` dirs,
   while one allowlisted file (``AGENTS.md``) reads successfully.
3. ``upstream_mcp_capabilities`` only advertises docs-research MCP servers that
   are actually configured in ``.mcp.json`` (runtime catalog-drift pin).
"""

from __future__ import annotations

import json

import pytest
from fastmcp.client import Client

from supaschema_agent_mcp.server import REPO_ROOT, mcp

# The six real tools the server exposes. After the BM25 transform removal these
# must be the exact catalog returned by list_tools() -- not the Tool Search
# surface (['call_tool', 'search_tools', 'server_status']).
EXPECTED_TOOLS = {
    "server_status",
    "code_atlas_query",
    "search_repo_context",
    "read_context_file",
    "nearest_agent_instructions",
    "upstream_mcp_capabilities",
}

# Tool Search surface tools that must NOT appear once BM25 is removed.
TOOL_SEARCH_ARTIFACTS = {"call_tool", "search_tools"}

# Paths the read-only guard must reject, one per guard branch.
REJECTED_PATHS = [
    "../etc/passwd",  # parent traversal
    "/etc/passwd",  # absolute path
    ".env",  # dotenv secret file
    "secrets/app.key",  # SECRET_SUFFIXES (.key)
    "node_modules/foo/index.js",  # DENIED_PARTS: node_modules
    "secrets/plan.txt",  # DENIED_PARTS: secrets
    "plans/roadmap.md",  # DENIED_PARTS: plans
]


def _mcp_configured_servers() -> set[str]:
    """Server names configured in the repo .mcp.json (source of truth)."""
    config = json.loads((REPO_ROOT / ".mcp.json").read_text(encoding="utf8"))
    return set(config.get("mcpServers", {}))


async def _read_context(client: Client, path: str) -> dict:
    """Call read_context_file and return its structured payload."""
    result = await client.call_tool("read_context_file", {"path": path})
    return result.data


# --- (a) BM25 removal: the real tools are directly listable -----------------


@pytest.mark.asyncio
async def test_list_tools_exposes_real_catalog_after_bm25_removal() -> None:
    async with Client(transport=mcp) as client:
        names = {tool.name for tool in await client.list_tools()}

    # All six real tools are directly listed (no search_tools round trip).
    assert EXPECTED_TOOLS <= names, f"missing real tools: {EXPECTED_TOOLS - names}"
    # The Tool Search transform surface must be gone.
    assert not (TOOL_SEARCH_ARTIFACTS & names), (
        f"BM25/Tool-Search artifacts still listed: {TOOL_SEARCH_ARTIFACTS & names}"
    )


# --- (b) read-only path guards reject unsafe paths --------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_path", REJECTED_PATHS)
async def test_read_context_file_rejects_unsafe_paths(bad_path: str) -> None:
    async with Client(transport=mcp) as client:
        with pytest.raises(Exception):  # noqa: B017,PT011 - guard rejection
            await _read_context(client, bad_path)


@pytest.mark.asyncio
async def test_secret_suffix_variants_are_all_rejected() -> None:
    # Every SECRET_SUFFIXES extension must be blocked, not just .key.
    secret_paths = [
        "src/server.key",
        "src/cert.pem",
        "src/store.p12",
        "src/store.pfx",
    ]
    async with Client(transport=mcp) as client:
        for path in secret_paths:
            with pytest.raises(Exception):  # noqa: B017,PT011 - guard rejection
                await _read_context(client, path)


@pytest.mark.asyncio
async def test_dotenv_family_is_rejected() -> None:
    # Both ".env" and ".env.<suffix>" must be blocked.
    async with Client(transport=mcp) as client:
        for path in (".env", ".env.local", ".env.production"):
            with pytest.raises(Exception):  # noqa: B017,PT011 - guard rejection
                await _read_context(client, path)


# --- (c) one allowlisted file reads successfully ----------------------------


@pytest.mark.asyncio
async def test_read_context_file_reads_allowlisted_agents_md() -> None:
    # Guard against a stale fixture: AGENTS.md must really exist at the root.
    assert (REPO_ROOT / "AGENTS.md").is_file()

    async with Client(transport=mcp) as client:
        payload = await _read_context(client, "AGENTS.md")

    assert payload["path"] == "AGENTS.md"
    assert isinstance(payload["text"], str)
    assert payload["text"].strip(), "AGENTS.md read returned empty text"


# --- (d) upstream_mcp_capabilities docs subset matches .mcp.json ------------


@pytest.mark.asyncio
async def test_upstream_docs_capabilities_match_mcp_json() -> None:
    configured = _mcp_configured_servers()

    async with Client(transport=mcp) as client:
        result = await client.call_tool(
            "upstream_mcp_capabilities", {"capability": "docs"}
        )
    payload = result.data

    # Every returned entry is family=docs and carries a correct configured flag.
    families = {item["family"] for item in payload["capabilities"]}
    assert families == {"docs"}, f"docs filter leaked other families: {families}"

    returned = {item["server"] for item in payload["capabilities"]}
    # Shape pin: the advertised docs servers are exactly the docs-research
    # servers present in .mcp.json (no phantom entries, no drift).
    assert returned == {"cloudflare-docs", "mintlify"}
    assert returned <= configured, (
        f"advertised docs servers not in .mcp.json: {returned - configured}"
    )

    # Each entry's runtime `configured` flag is computed from .mcp.json.
    for item in payload["capabilities"]:
        assert item["configured"] is (item["server"] in configured)

    # The non-proxy disclaimer is part of the contract.
    assert "Pointer index only" in payload["note"]


@pytest.mark.asyncio
async def test_upstream_all_capabilities_only_advertise_configured_servers() -> None:
    configured = _mcp_configured_servers()

    async with Client(transport=mcp) as client:
        result = await client.call_tool("upstream_mcp_capabilities", {"capability": "all"})
    payload = result.data

    for item in payload["capabilities"]:
        # The whole index is the docs-research pointer set; every advertised
        # server with configured=True must really be wired in .mcp.json.
        if item["configured"]:
            assert item["server"] in configured, (
                f"{item['server']} flagged configured but missing from .mcp.json"
            )
