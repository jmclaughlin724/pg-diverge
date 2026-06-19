---
description: Multi-language LSP coverage, formatter/linter ownership, import/key sorting, and npm-only toolchain.
---

# Rule 06 — Multi-language LSP coverage + formatting/lint standards

## Contract

This rule owns multi-language code intelligence and tool ownership: every tracked code extension has cclsp coverage, every language has one formatter/linter owner, and `npm run format` is the single repo-wide write/fix command.

Every language used in this repo is a governed surface: it gets a language server under **cclsp** for code intelligence, and a formatter/linter gate where one exists. This is an npm single-package repo (TypeScript CLI/library under `src/` → `dist`, plus a Python `uv` workspace at `services/agent-mcp`) — there is no pnpm, no Turborepo, no workspaces `apps/`, no SQL formatter lane, and no pgformatter. Each language with a text formatter has exactly one formatting owner: **Biome** (JS/TS/JSON/JSONC/CSS), **Prettier** (MDX/Markdown/YAML), **ruff** (Python), **taplo** (TOML), and **shfmt** (shell). SQL is governed by supaschema's parser/deparser/model semantics plus `postgres-language-server`, not by a standalone formatter. Import and key sorting follow the same one-owner rule (see [Import and key sorting](#import-and-key-sorting)). Coverage is enforced by `scripts/guards/check-lsp-coverage.mjs` (`npm run guard:lsp-coverage`), the lint gate `npm run lint` (Ultracite/Biome), and the per-language Python gate in Rule 04.

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

Root `action.yml` and `action.yaml` are GitHub Action metadata files, not workflow files. `.vscode/settings.json` must keep them associated with the generic `yaml` language plus the `github-action.json` schema so Red Hat YAML owns action metadata validation; the GitHub workflow schema and `github-actions-workflow` language mode belong only to `.github/workflows/*.yml` and `.github/workflows/*.yaml`.

## Repo-wide code graph

Use Code Atlas (Rule 10) before broad source, route, dependency, consumer, DB, API, worker, generated-surface, or deploy claims. Code Atlas is not a substitute for cclsp precision: it narrows the owner and blast-radius map, then cclsp and direct source reads prove exact symbol behavior.

## One owner per concern (no fighting tools)

| Language | Format | Lint | Types |
| --- | --- | --- | --- |
| JS/TS/JSX/TSX | **Biome/Ultracite** | **Biome/Ultracite** | tsc (`npm run typecheck`) |
| JSON/JSONC/CSS/HTML/GraphQL | **Biome/Ultracite** | **Biome/Ultracite** | — |
| MDX/Markdown/YAML | **Prettier** | docs gate for MDX (`docs:lint` + `mint validate`) | — |
| Python | **ruff format** | **ruff** | **mypy** (Rule 04) |
| SQL | — | supaschema semantic guards + `postgres-language-server` LSP | — |
| TOML | **taplo** | `taplo` LSP | — |
| Shell (sh/bash) | **shfmt** (via `sh-syntax`) | `bash-language-server` LSP | — |

- **Biome via Ultracite** owns JavaScript, TypeScript, JSX, TSX, JSON, JSONC, CSS, HTML, and GraphQL formatting/linting through `biome.jsonc` (extends `ultracite/biome/{core,type-aware,vitest}`) — see Rule 08 for the JS/TS lint policy. Use `npm run format` for write/fix remediation; its Biome step applies Biome format, safe lint fixes, and `organizeImports`. The read-only gate is `npm run lint` and CI runs `npm run lint:ci`.
- **`npm run format` is the single repo-wide write command.** It chains every writer with no `check` step — `format:json` (sort-package-json) → Biome/Ultracite → `format:md` (Prettier) → `format:toml` (taplo) → `format:sh` (shfmt) → `py:fix` (ruff `--fix` then `ruff format`) — so one command formats, lint-fixes, import-sorts, and key-sorts every language that has a write formatter. Run it to move work forward; reserve the `check`/`lint`/`*:check` commands for read-only CI gates. During agent work, invoke Biome/Ultracite only through npm scripts; do not run direct `ultracite`, `biome`, or formatter subcommands unless you are editing the corresponding package script itself.
- **Prettier** owns MDX, Markdown, and YAML formatting through `prettier.config.mjs` and `.prettierignore`; apply it with `npm run format:md` (`prettier --write "**/*.{md,mdx,yml,yaml}"`), which `npm run format` chains after Biome. Biome does not format these types. `docs/` MDX is additionally validated — not formatted — by `npm run docs:check` (`docs:lint` + `mint validate`, Rule 02/03): Prettier owns layout, Mintlify owns component/link correctness.
- **Python** format/lint is `ruff` and types are `mypy`: `npm run py:format:check` (`ruff format --check`), `npm run py:lint` (`ruff check`), `npm run py:typecheck` (`mypy` strict), all via `uv run --package supaschema-agent-mcp`. `black`/`isort` appear only as cclsp/pylsp editor plugins (in-editor formatting), never as a script or CI gate.
- **SQL has no standalone text formatter.** Supaschema renders migrations deterministically and is the source of truth for SQL safety via AST/model semantic guards (Rule 07), fidelity-gated `normalize: "deparse"`, `checkMigrationSql`, and the `postgres-language-server` LSP. Do not add pgformatter or another SQL formatter lane to `npm run format`; formatting-only rewrites are not allowed to touch generated migrations, fixtures, corpus, or benchmark evidence.
- **taplo** owns TOML formatting; apply it with `npm run format:toml` (`scripts/format-toml.mjs`, `taplo format`). `reorder_keys`/`reorder_arrays` stay at their `false` defaults because TOML order is semantic here (`pyproject.toml` sections, `wrangler.toml`, `.codex/config.toml`). taplo also provides the editor LSP.
- **shfmt** owns shell formatting via the maintained `sh-syntax` WASM port of `mvdan/sh`; apply it with `npm run format:sh` (`scripts/format-sh.mjs`, 2-space indent). It only formats — shell has no key/import sort. `bash-language-server` provides the editor LSP.

## Import and key sorting

Sorting has one owner per language too, and is **deliberately conservative** — blanket key sorting breaks semantic and conventional order, so it is opt-in everywhere it could harm intent.

- **Import sorting** is owned by the language formatter/linter and is already enforced: **Biome `organizeImports`** (a recommended, default-on assist) sorts imports and exports in JS/TS/JSX/TSX through `npm run format` and the lint gates; **ruff `I`** (isort rules, in `[tool.ruff.lint] select`) sorts Python imports through `npm run py:lint`. No separate import-sort tool is added.
- **Key sorting is opt-in.** Biome's `useSortedKeys` assist stays **off** (Biome's own default) because JS object literals and config files (`tsconfig`, `biome.jsonc`, `docs.json` navigation) carry semantic/conventional order. The one keyed file with a canonical non-alphabetical order, `package.json`, is sorted by **`sort-package-json`** via `npm run format:json`, which `npm run format` runs first so Biome formats `package.json` last.
- **Other languages do not sort.** Prettier (MDX/Markdown/YAML), taplo (TOML, `reorder_keys` off), and shfmt (shell) format only; none reorder keys or content, since order there is semantic.

## Hard blockers

- `npm run guard` (via `check-all.mjs`) runs `check-tooling-stack` and `check-lsp-coverage` — the npm-only contract holds and every language stays mapped.
- Run `npm run format` to move formatting, lint-fix, import-sort, and key-sort work forward; do not use `npm run lint` as a fixer, do not append `fix` to `npm run lint`, and do not add or run formatter aliases such as `npm run lint:fix`.
- `npm run lint` is the required JS/TS/JSON/JSONC/CSS/HTML/GraphQL gate; `npm run typecheck` (tsc over `tsconfig.src.json` + `tsconfig.tools.json`) is the TS type gate.
- lefthook `pre-commit` runs `biome check --staged --no-errors-on-unmatched` on staged JS/TS/JSON/CSS/HTML/GraphQL; `pre-push` runs `npm run typecheck` and `npm run guard` (which includes the cclsp coverage and tooling-stack guards).
- The PostToolUse hook gives in-loop feedback for schema-SQL edits through the supaschema auto-diff/check lane; JS/TS/JSON/CSS/HTML/GraphQL verification is owned by `npm run lint`.
- Tooling is pinned in root `devDependencies` (`@biomejs/biome` 2.5.0, `ultracite` 7.8.3, the LSP servers) and in the `uv` dev group (`ruff`, `mypy`, the pylsp plugins); `check-tooling-stack.mjs` and `uv lock --check` keep them reproducible.

STOP if a new language ships without a cclsp mapping, if JS/TS/JSON/JSONC/CSS/HTML/GraphQL is committed unformatted, if Python fails ruff/mypy, if schema SQL bypasses the supaschema semantic guards, if a second formatter is added that competes with the one owner for a language (Biome for JS/TS/JSON/JSONC/CSS, Prettier for MDX/Markdown/YAML, ruff for Python, taplo for TOML, shfmt for shell), if pgformatter or another SQL formatter lane is introduced, if blanket key sorting is enabled over semantic/conventional order (Biome `useSortedKeys` on globally or taplo `reorder_keys` on), or if pnpm/Turborepo is reintroduced.

## Verification

When adding a file type, formatter, linter, LSP, language config, or format script, run:

```bash
npm run guard:lsp-coverage
npm run guard
npm run lint
npm run typecheck
```

Use `npm run format` for write/fix remediation.

## Failure behavior

Add missing LSP coverage before adding a language. Remove competing formatters/linters and align with the one-owner map. Do not use `npm run lint` as a fixer, do not add formatter aliases, and do not introduce pnpm/Turborepo or a SQL formatter lane.

## Done means

Every touched language surface is mapped, formatted by its canonical owner, checked by its gate, and free of competing tooling.
