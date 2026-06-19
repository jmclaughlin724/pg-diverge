---
description: Python uv workspace, ruff, mypy, pytest, pip-audit, and pylsp standards for services/agent-mcp.
---

# Rule 04 — Python toolchain (uv + ruff + mypy) and pylsp

## Contract

This rule owns the Python developer toolchain for `services/agent-mcp`: uv workspace layout, ruff formatting/linting, mypy strict typing, pytest, pip-audit, and pylsp/cclsp integration.

The Python side of this repo is a single **uv workspace** member: `services/agent-mcp` (`supaschema-agent-mcp`), the read-only local supaschema FastMCP side-service. There is no FastAPI, no `services/api`, no `services/workers`, and no web HTTP API here — the server is FastMCP (`fastmcp` + `pydantic`), and its server boundary, capabilities, and wiring are owned by **Rule 11 (Agent MCP FastMCP)**. This rule owns only the Python developer toolchain: format, lint, types, tests, supply-chain, and the pylsp language server. The package manager for the JS/TS repo is **npm** (never pnpm); the Python `py:*` scripts are npm scripts that shell out to `uv`.

## Layout

- Root `pyproject.toml` is the uv workspace root: `[tool.uv] package = false`, `[tool.uv.workspace] members = ["services/agent-mcp"]`, `requires-python = ">=3.12,<3.13"`. It owns the shared `[dependency-groups] dev` tools, the `[tool.ruff]` / `[tool.mypy]` / `[tool.pytest.ini_options]` config, and the pylsp plugin config tables.
- `services/agent-mcp/pyproject.toml` owns the runtime package (`fastmcp`, `pydantic`, `pytest-asyncio`) and its `[project.scripts] supaschema-agent-mcp` entrypoint. Application/library code lives in `services/agent-mcp/supaschema_agent_mcp/`; tests in `services/agent-mcp/tests/`.
- `uv.lock` is the single workspace lockfile. After changing any dependency or dev tool, run `uv lock` and commit `uv.lock`; CI runs `uv sync --locked`, which fails on drift.

## Skill routing

- Use `$python` for Python app/library work: server/CLI entry points, `pyproject.toml`/uv/dependency groups, tests, packaging/release, supply-chain provenance, async/concurrency, logging/observability, debugging, profiling, and typing/validation boundaries. Keep this rule's repo-owned commands and gates authoritative over generic skill defaults.
- For the FastMCP server contract itself (read-only deny-list surface, transport, capabilities, `fastmcp.json`/`.mcp.json` alignment), defer to **Rule 11**; do not restate it here.

## Language server (cclsp + pylsp)

- Code navigation/refactor for agents goes through the **cclsp** MCP server; the per-language cclsp map (every extension → LSP) is owned by **Rule 06**. `.claude/cclsp.json` maps `.py`/`.pyi` → `uv run pylsp` at the repo root so it reads the workspace `.venv` and root config.
- The Python LSP is **python-lsp-server (pylsp)** (pinned `python-lsp-server` in the root dev group) with the editor plugins `python-lsp-ruff`, `python-lsp-black`, `python-lsp-isort`, `pylsp-rope`, and `pyls-memestra` — all in `[dependency-groups] dev`. Install/refresh with `uv sync` (never a global pip — the plugins must share the workspace `.venv`, or `uv run pylsp` cannot see them).
- In `.claude/cclsp.json` the pylsp plugins are scoped to **editor-time on-save behavior only**: ruff runs with `formatEnabled: false`, black/isort handle layout in the editor, rope provides refactors, memestra flags deprecations, and pylsp's redundant built-ins (pycodestyle, pyflakes, mccabe, autopep8, yapf, flake8, pylint, pydocstyle) are disabled. The authoritative **command-line / CI** format, lint, and type gates are ruff and mypy below — not the pylsp plugins.

## One owner per concern (no fighting tools)

- **ruff owns formatting AND linting.** `ruff format` is the formatter (the upstream drop-in Black replacement) and `ruff check` is the linter; line length is set once in `[tool.ruff] line-length = 100` (with `[tool.ruff.lint] select` for the enabled rule families). Do not add a competing Python formatter or linter to the CLI/CI gate.
- **mypy owns types**, in strict mode: `[tool.mypy] strict = true`, `files = ["services/agent-mcp/supaschema_agent_mcp"]`. Pyright is not used in this repo.
- **pytest** (with `pytest-asyncio`, `asyncio_mode = "auto"`) owns tests; `[tool.pytest.ini_options] testpaths` points at `services/agent-mcp/tests`.
- **pip-audit** owns the Python supply-chain scan in CI.

The `[tool.black]` / `[tool.isort]` tables exist only to configure the pylsp editor plugins and stay at `line-length = 100` to agree with `[tool.ruff]`; they are not a CLI gate.

## Commands

Run from the repo root (these are real npm scripts in `package.json`):

```bash
npm run py:format:check   # uv run --package supaschema-agent-mcp ruff format --check services/agent-mcp
npm run py:lint           # uv run --package supaschema-agent-mcp ruff check services/agent-mcp
npm run py:fix            # uv run ... ruff check --fix && ruff format — the Python write lane (lint-fix + import sort + format)
npm run py:typecheck      # uv run --package supaschema-agent-mcp mypy services/agent-mcp/supaschema_agent_mcp
npm run py:test           # uv run --package supaschema-agent-mcp pytest services/agent-mcp/tests
```

Apply Python fixes locally with `npm run py:fix` (`ruff check --fix` for lint + import sort, then `ruff format`); it is also chained into the repo-wide single write command `npm run format` (Rule 06). The `py:format:check`/`py:lint` variants are the read-only CI gates.

## Gates

- `.github/workflows/python.yml`, when present locally, is private with `services/agent-mcp` and must stay untracked. Public CI must not require private FastMCP files that are absent from a clean checkout. The focused local lane remains the `py:*` command set above. The `--package supaschema-agent-mcp` selector is mandatory: the workspace root has no runtime deps (`dependencies = []`, `package = false`) and does not depend on the member, so a bare `uv run mypy`/`pytest` resolves in the root env that lacks `fastmcp`/`mcp`/`pydantic` and fails with `import-not-found`.
- `npm run guard:lsp-coverage` (`scripts/guards/check-lsp-coverage.mjs`, part of `npm run guard`) hard-blocks if any tracked code extension — including `.py`/`.pyi` — is not mapped in `.claude/cclsp.json`. The cclsp map itself is governed by **Rule 06**.
- `npm run guard:fastmcp` (`scripts/guards/check-fastmcp-agent.mjs`) keeps the FastMCP server surface aligned (owned by **Rule 11**), not the Python toolchain.
- After changing any dev tool or runtime dependency, run `uv lock` and commit `uv.lock`; the `uv sync --locked` step fails the PR on drift.

STOP if a Python file ships unformatted (`ruff format --check` fails) or with ruff lint errors; if it fails `mypy` strict; if `uv.lock` drifts from `pyproject.toml` (`uv sync --locked` would fail); if the ruff/black/isort line lengths diverge from `100`; if the `.py`/`.pyi` cclsp mapping or a pylsp plugin is removed; if a `python.yml` step or any script runs a bare `uv run <tool>` that needs the member environment (`mypy`/`pytest`) without `--package supaschema-agent-mcp`, diverging from the canonical `py:*` invocations; if `python.yml` becomes tracked while `services/agent-mcp` is private; if a competing Python formatter, linter, or type checker is added to the CLI/CI gate; or if FastAPI, `services/api`, pnpm, or any HTTP-API-only construct is reintroduced into this FastMCP-only Python surface.

## Verification

When Python code, Python dependencies, pylsp config, or Python CI changes, run the focused Python lane:

```bash
npm run py:format:check
npm run py:lint
npm run py:typecheck
npm run py:test
```

After dependency/tool changes, run `uv lock` and verify `uv sync --locked` semantics.

## Failure behavior

Fix ruff, mypy, pytest, uv lock drift, and package selector errors in the Python owner. Do not replace ruff/mypy/pytest with competing tools or run bare `uv run` commands that miss the `supaschema-agent-mcp` member environment.

## Done means

Python code is formatted, linted, typed, tested, `uv.lock` is current when dependencies changed, and FastMCP-specific behavior still passes Rule 11 checks.
