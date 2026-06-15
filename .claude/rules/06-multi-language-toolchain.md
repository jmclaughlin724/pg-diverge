# Rule 06 — Multi-language LSP coverage + formatting/lint standards

Every language used in this repo is a governed surface: it gets a language server under **cclsp** for code intelligence, and a formatter/linter gate where one exists. This is an npm single-package repo (TypeScript CLI/library under `src/` → `dist/`, plus a Python `uv` workspace at `services/agent-mcp`) — there is no pnpm, no Turborepo, no workspaces `apps/`, and no Prettier or sqlfluff. Coverage is enforced by `scripts/guards/check-lsp-coverage.mjs` (`npm run guard:lsp-coverage`), the lint gate `npm run lint` (Ultracite/Biome), and the per-language Python gate in Rule 04.

## All used languages live under cclsp

`.claude/cclsp.json` maps every tracked source/config extension to an stdio LSP:

| Language | Extensions | Server |
| --- | --- | --- |
| Python | py, pyi | `uv run pylsp` (+ plugins, Rule 04) |
| TypeScript/JS | ts, tsx, js, jsx, mjs, cjs | `typescript-language-server` (via `scripts/cclsp-language-id-proxy.mjs`) |
| SQL (Postgres) | sql | `postgres-language-server lsp-proxy` (libpg_query, no DB) |
| JSON | json, jsonc | `vscode-json-language-server` |
| CSS family | css, scss, less | `vscode-css-language-server` |
| HTML | html | `vscode-html-language-server` |
| YAML | yaml, yml | `yaml-language-server` |
| Bash | sh, bash | `bash-language-server` |
| TOML | toml | `taplo lsp stdio` |
| Markdown/docs | md, markdown, mdx, rules | `vscode-markdown-language-server` |
| Dockerfile | dockerfile | `docker-langserver` |

`check-lsp-coverage.mjs` walks `git ls-files` and **hard-blocks** if any tracked code extension is neither mapped in `cclsp.json` nor in the guard's `NON_CODE` allowlist. Adding a new language requires a cclsp server first. cclsp keys one server per extension, so a shared extension (e.g. `.css`, `.tsx`) routes to a single server.

## Repo-wide code graph

Use Code Atlas (Rule 10) before broad source, route, dependency, consumer, DB, API, worker, generated-surface, or deploy claims. Code Atlas is not a substitute for cclsp precision: it narrows the owner and blast-radius map, then cclsp and direct source reads prove exact symbol behavior.

## One owner per concern (no fighting tools)

| Language | Format | Lint | Types |
| --- | --- | --- | --- |
| JS/TS/JSX/TSX | **Biome/Ultracite** | **Biome/Ultracite** | tsc (`npm run typecheck`) |
| JSON/JSONC/CSS/HTML/GraphQL | **Biome/Ultracite** | **Biome/Ultracite** | — |
| Python | **ruff format** | **ruff** | **mypy** (Rule 04) |
| SQL | — (supaschema renders it) | supaschema semantic guards + `postgres-language-server` LSP | — |

- **Biome via Ultracite** owns JavaScript, TypeScript, JSX, TSX, JSON, JSONC, CSS, HTML, and GraphQL formatting/linting through `biome.jsonc` (extends `ultracite/biome/{core,type-aware,vitest}`) — see Rule 08 for the JS/TS lint policy. Apply formatting with `npm run format` (`ultracite fix .`) or `npm run lint:fix`, and run the gate with `npm run lint` (`ultracite check .`). CI runs `npm run lint:ci` (`biome ci .`).
- **Markdown and YAML have no repo-wide format gate.** Biome (Biome provider) does not format Markdown/YAML, and this repo ships no Prettier config. `docs/` Markdown is governed by `npm run docs:lint` (`scripts/check-docs-standard.mjs`) and `mint validate` (Rule 02/03); other Markdown/YAML is reviewed, not auto-formatted.
- **Python** format/lint is `ruff` and types are `mypy`: `npm run py:format:check` (`ruff format --check`), `npm run py:lint` (`ruff check`), `npm run py:typecheck` (`mypy` strict), all via `uv run --package supaschema-agent-mcp`. `black`/`isort` appear only as cclsp/pylsp editor plugins (in-editor formatting), never as a script or CI gate.
- **SQL** is rendered by supaschema and proven by its AST/model semantic guards (Rule 07); the `postgres-language-server` LSP gives editor intelligence with no database. There is no sqlfluff. Dollar-quoted PL/pgSQL bodies are passed through untouched; semantic guards remain the source of truth for SQL safety.

## Hard blockers

- `npm run guard` (via `check-all.mjs`) runs `check-tooling-stack` and `check-lsp-coverage` — the npm-only contract holds and every language stays mapped.
- `npm run lint` is the required JS/TS/JSON/JSONC/CSS/HTML/GraphQL gate; `npm run typecheck` (tsc over `tsconfig.src.json` + `tsconfig.tools.json`) is the TS type gate.
- lefthook `pre-commit` runs `biome check --staged --no-errors-on-unmatched` on staged JS/TS/JSON/CSS/HTML/GraphQL; `pre-push` runs `npm run typecheck` and `npm run guard` (which includes the cclsp coverage and tooling-stack guards).
- The PostToolUse hook gives in-loop feedback for schema-SQL edits through the supaschema auto-diff/check lane; JS/TS/JSON/CSS/HTML/GraphQL verification is owned by `npm run lint`.
- Tooling is pinned in root `devDependencies` (`@biomejs/biome` 2.5.0, `ultracite` 7.8.3, the LSP servers) and in the `uv` dev group (`ruff`, `mypy`, the pylsp plugins); `check-tooling-stack.mjs` and `uv lock --check` keep them reproducible.

STOP if a new language ships without a cclsp mapping, if JS/TS/JSON/JSONC/CSS/HTML/GraphQL is committed unformatted, if Python fails ruff/mypy, if schema SQL bypasses the supaschema semantic guards, if a formatter is added that competes with Biome or ruff for an existing language, or if pnpm/Turborepo/Prettier/sqlfluff is reintroduced.
