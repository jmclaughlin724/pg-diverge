# supaschema Repository Operating Contract

## Contract

This file is the root operator brief for AI agents working in this repository and for the agent guidance bundled with the `supaschema` package. Apply it to all files in this repo unless a closer `AGENTS.md` overrides it.

supaschema is a Node 22.12+ TypeScript CLI and library that generates deterministic, replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs. The default workflow is generator, checker, and verifier only: it does not stage, commit, or apply migrations. The explicit `supaschema sync --local|--remote` lane is an operator-invoked handoff to the Supabase CLI after status and replay-safety gates; do not use apply flags without an explicit human request.

Durable migration policy lives in `.claude/rules/supaschema.md`. The repeatable migration workflow lives in `.claude/skills/supaschema/SKILL.md` and its `.agents/skills/supaschema/SKILL.md` mirror. Write-time enforcement lives in `.claude/hooks/**`, `.claude/settings.json`, `.codex/hooks/**`, and `.codex/hooks.json`.

## Source Ownership

- Repo facts come from live files and command output. Public product behavior must match `src/**`, `README.md`, and `docs/**`; do not rely on memory for command flags, defaults, diagnostics, or package contents.
- Source code lives in `src/**`. Build output in `dist/**` is generated from `src/**`; change the source and run the build instead of hand-editing `dist/**`.
- CLI behavior is owned by `src/cli.ts`, `src/cli-diff.ts`, `src/cli-reports.ts`, `src/cli-tools.ts`, and the helpers they call. Library exports are owned by `src/index.ts`.
- Config semantics are owned by `src/config.ts` and the generated `supaschema-config.schema.json`. Keep docs, examples, and JSON Schema aligned when config changes.
- Tests live in `tests/**`; fixtures under `tests/fixtures/**` and `corpus/**` are behavioral evidence. Update snapshots only when the rendered SQL change is intentional and explained by source changes.
- The package manager is npm. Preserve `package-lock.json`; do not introduce pnpm, yarn, or alternate lockfiles.
- The npm package boundary is the `package.json` `files` allowlist. Do not add a root `.npmignore` while this allowlist owns publishing; use `npm pack --dry-run --json` to inspect the exact tarball.

## Migration Policy

- Schema intent changes in a consuming project belong in the configured declarative SQL tree, such as `database/schemas/**`, `supabase/schemas/**`, `neon/schemas/**`, `aws-postgresql/schemas/**`, `cloud-sql/schemas/**`, `alloydb/schemas/**`, or `azure-postgresql/schemas/**`. Generated migrations come from `supaschema diff`.
- Any `.sql` file containing `-- supaschema: lineage` is a generated artifact. Never edit it by hand; change the source tree and regenerate.
- The bundled PostToolUse hooks auto-run `supaschema diff` then `supaschema check` after writes to schema-tree `.sql` files. Treat the returned migration name or `SUPA_*` diagnostic as the authoritative diff result. The hooks generate and prove; they never apply to a database.
- Destructive intent must be explicit. Drops, column type changes, incompatible replacements, and other blocked operations require exact object keys in `hints.destructive` after reviewing the rendered SQL. Never commit `"*"`.
- Preserve the lineage chain gate. For `SUPA_DIFF_LINEAGE_BROKEN`, diff from the post-migration state such as `--from database:<applied db>`. Use `--no-check-chain` only after explicit human approval.
- Keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`. `adapter: "auto"` is the default automated supaschema workflow and is not a Supabase switch. `CREATE INDEX CONCURRENTLY` is blocked when `transactionMode` is `per-migration`; split concurrent companions belong only in an explicit `per-statement` operational lane.
- `supaschema sync` is a gated operational command, not the default generation workflow. With no apply flag it is a dry run; with `--local` or `--remote` it runs status reconciliation and `check`, then delegates the actual apply/deploy to the Supabase CLI.
- Database URLs resolve by flag (`$ENV` supported), then named `config.environments` via `--env`, then `SUPASCHEMA_DATABASE_URL`, then nearest `supabase/config.toml`. Never hard-code credentials or connection strings.
- Decode blocking diagnostics with `supaschema explain <SUPA_CODE>`; recovery procedures live in `docs/configuration/hints.mdx`.

## Agent Bundle Surfaces

- Keep `AGENTS.md` concise and stable. Put reusable workflow detail in `.claude/skills/supaschema/SKILL.md`; put durable policy in `.claude/rules/supaschema.md`; put deterministic write-time checks in hooks.
- `CLAUDE.md` is a compatibility stub and should remain `@AGENTS.md` unless Claude-specific instructions are intentionally added.
- Claude surfaces are canonical for repo-local agent tooling. `npm run sync:llm` mirrors `.claude/skills/**` into `.agents/skills/**` and `.codex/skills/**`, mirrors `.claude/hooks/**` into `.codex/hooks/**`, renders `.claude/agents/**/*.md` into Codex-native `.codex/agents/**/*.toml`, and renders `.claude/rules/**/*.md` into Codex `.rules` comment mirrors.
- Hook scripts under `.claude/hooks/**` must be runtime-aware when Claude and Codex payload or output contracts differ. Codex hook registration remains native in `.codex/hooks.json`.
- `package.json` includes the consumer agent bundle in published files, including `.agents/skills/supaschema`, the Claude rule/skill/hooks, and the Codex rule/skill/hooks. When adding, moving, or deleting an agent surface, verify the packaged tarball still contains the intended files.
- Keep consumer install surfaces separate from maintainer workspace tooling. `postinstall` installs config, schema/migration directories, `AGENTS.md`/`CLAUDE.md` addenda, and the supaschema rule/skill/hook bundle through the shared `bin/scaffold.mjs` scaffolder; `supaschema init` calls the same core for full parity, the explicit fallback when npm does not run install scripts (npm v12 default). Repo-local `.vscode`, Postgres Language Server, Python, MCP, Code Atlas, FastMCP, and UI scaffolding belong to supaschema development unless a change explicitly adds them to the consumer installer and package tests.

## Implementation Discipline

- Before any broad owner, route, consumer, dependency, DB, API, worker, generated-surface, or deploy claim, or any delete/rename/move, build and query Code Atlas first. Then use cclsp for exact symbol behavior on the owner files it returns. Then read the source before making a behavioral claim. For external framework or library facts, consult the configured docs MCP research servers; never guess. Live MCP output supplements, but never replaces, the local atlas plus cclsp plus source as proof. The graph under `.tmp/` is scratch and must not be committed. Any change to the atlas sources of truth updates `scripts/code-atlas/build.mjs`, `scripts/code-atlas/build-python.py`, and `scripts/guards/check-code-atlas.mjs` in the same commit.
- SQL understanding must come from PostgreSQL parse trees through `libpg-query` and structured model helpers. Do not classify, diff, or mutate SQL with ad hoc regex when an AST/model path exists.
- Unsupported or ambiguous DDL fails closed with a diagnostic. Do not silently pass through statements that the model cannot prove safe.
- Generated migrations must be idempotent and replay-safe. Guard creates, avoid `CASCADE`, and preserve lock-safety checks.
- RLS policy bodies are security boundaries. Compare policy definitions structurally, not by name alone.
- Type generation comes from the declarative tree and source model, not from live database introspection.
- Diagnostics must be actionable and must redact secrets, including URL passwords, JWTs, and tokens.
- Keep behavior available as both CLI and typed library API when the capability is reusable.

## Documentation Authoring Standard

The `docs/**` tree is a Mintlify docs-as-code site (monorepo mode, served at `supaschema.com/docs`). Author pages to the Mintlify standard; the deterministic `npm run docs:lint` gate (part of `docs:check` and CI) blocks regressions.

- The frontmatter `title`, `description`, and `keywords` own page metadata. Never add a body `# ` H1 (it duplicates the title and breaks heading hierarchy); start in-page headings at `##`.
- Code fences must include a language tag. Use `text` for terminal output, ASCII diagrams, object keys, and other plain output.
- Use Mintlify components, not flattened markdown, for the content they exist for: `<ParamField>` for every command flag/parameter, `<ResponseField>`/`<Expandable>` for response shapes, `<Card>`/`<CardGroup>` for navigation, `<Steps>` for procedures, `<Accordion>`/`<AccordionGroup>` for progressive disclosure, and `<Note>`/`<Warning>`/`<Tip>`/`<Info>` for callouts. Command reference pages with a Flags/Options section must document flags with `<ParamField>`.
- Keep `docs/docs.json` aligned with Mintlify's config model: include the schema URL, `theme`, `name`, `colors.primary`, a single supported icon library, and navigation entries for every public page. Pages intentionally omitted from navigation must set `hidden: true`.
- Keep Mintlify's agent-readiness surfaces enabled: `contextual.options` should include page-copy, Markdown view, MCP install/connect actions, and the main AI chat targets; reverse proxies must forward `/mcp`, `/skill.md`, `/.well-known/mcp*`, `/.well-known/skills/*`, and `/.well-known/agent-skills/*` to Mintlify.
- Navigation labels and tab titles must be short enough for compact sidebar or top-nav rendering. Use `sidebarTitle` when the full page title is too long for navigation.
- Docs pages must use `.mdx`. Local docs images, including generated benchmark and concept SVGs, belong under `docs/images/**`, use root-relative `/images/**` paths, include descriptive alt text, and must be wrapped in `<Frame>`.
- Do not add snippets, custom CSS, custom JS, or API playground config without updating `docs/docs.json` and the Mintlify rule surface in the same change.
- Never carry `theme={null}` (a copy-paste artifact from Mintlify's rendered output) on a code fence.
- Internal links are root-relative and extensionless (`/configuration/hints`), never `.md`/`.mdx` paths, repo-relative `docs/...` paths, absolute `supaschema.com/docs/...` URLs, or generic text like "here" and "read more". README and other repo-root markdown are not Mintlify pages and link to the published `supaschema.com/docs/...` URLs instead.
- Enforcement layers: `docs:lint` (the rules above, deterministic) then `mint validate` (strict build), `mint broken-links --check-anchors`, and `mint a11y` — all run by `npm run docs:check` and the `Docs` CI workflow on every docs change.

## Common Commands

Supaschema CLI workflow:

```bash
supaschema diff                          # render applied state -> schema tree into a migration
supaschema check                         # replay-safety gate for configured migrations
supaschema verify                        # apply-twice proof for the newest pending migration
supaschema types                         # TypeScript + Zod output from the declarative tree
supaschema diff --fail-on-diff --quiet   # CI drift gate, exit 3 on drift
supaschema diff --summary                # blocked-plan triage by operation, diagnostic, kind, and schema
supaschema diff --write-hints <file>     # no-clobber destructive-hint skeleton for review
supaschema audit --from <source>         # support coverage and out-of-contract diagnostics
supaschema selfcheck                     # live catalog cross-lane identity proof
supaschema migrations                    # applied, pending, ghost, and out-of-order status
supaschema sync                          # dry-run apply gate; --local/--remote need explicit approval
supaschema corpus                        # dirty-real corpus oracle when a database is reachable
```

Repository development:

```bash
npm run check           # lint + tests + build (build type-checks src via noEmitOnError)
npm run lint            # ultracite check (wraps Biome)
npm run format          # single write command: format + lint-fix + import/key-sort every language (Rule 06)
npm run typecheck       # TypeScript no-emit check
npm test                # vitest suite
npm run build           # dist + supaschema-config.schema.json
npm run check:package   # publint + arethetypeswrong package checks
npm run pack:dry        # inspect npm tarball contents before release
npm run fixture:verify  # render a fixture migration, apply twice, compare catalogs
npm run corpus:check    # dirty-real corpus reconvergence oracle
npm run benchmark       # benchmark and threshold lane
npm run docs:check      # Mintlify validation, links, accessibility
```

## Verification

- Run the narrowest command that proves the touched behavior, then broaden when changing shared planner, parser, renderer, hook, or package surfaces.
- For core SQL extraction, planning, rendering, checking, verifying, typegen, or CLI defaults, run targeted tests plus `npm run typecheck`.
- For package, release, or bundled agent-surface changes, run `npm run check:package` or `npm pack --dry-run` as appropriate.
- For docs-only changes, run `npm run docs:check` when Mintlify pages or navigation are touched.
- Before merge or release, `npm run check`, `npm run check:package`, `npm run fixture:verify`, `npm run corpus:check`, and the relevant benchmark/docs checks should be clean.
