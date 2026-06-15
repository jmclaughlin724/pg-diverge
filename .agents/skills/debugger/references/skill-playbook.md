# Fix: $ARGUMENTS Playbook

Detailed body moved out of `SKILL.md` so it stays focused on trigger, workflow, and closeout. Read only the sections needed for the current task. This repo is a single-package npm TypeScript CLI/library with a Python `uv` FastMCP side-service (`services/agent-mcp`), a Cloudflare docs Worker, and a Mintlify docs site — there is no Next.js, Vercel, Turborepo, pnpm, or Supabase app here.

## Reporting Contract

Every investigation step follows this pattern:

1. **Announce** what you are checking — "Re-running `npm run typecheck` to capture the exact TS error…"
2. **Share** the evidence — paste the relevant log line, error, command exit code, or `SUPA_*` diagnostic.
3. **Explain** the next step — "The error is `SUPA_DIFF_LINEAGE_BROKEN`; checking the applied-migration state next."

Never move silently between diagnostic steps.

## Assumption Gate Before Plans

Do not draft a remediation plan or task list until every shaping assumption is investigated and resolved — the exact failing command/job/commit, the owning source/config/workflow/generated output, expected vs actual behavior, environment (`SUPASCHEMA_DATABASE_URL`, the local Postgres, build artifacts under `dist/`), and the verification command needed to prove the fix. Convert each assumption into a verified fact or an explicit user decision; if one is unresolved, stop and report only the blocker.

## Parallel Investigation

When the user explicitly asks for subagents or parallel debugging, use read-only subagents split by evidence type — `runtime` (failing command output, CI logs, `SUPA_*` diagnostics, reproduction), `owner-map` (Code Atlas owner/impact, call paths, generated outputs), `context` (upstream docs/MCP, tool behavior), `skeptic` (contradictory evidence, stale caches, missing verification). Each returns scope, findings, evidence, uncertainties, blockers, and next step; the parent resolves disagreements with direct reads. Otherwise parallelize local diagnostic commands and reads.

## Operational Triage (No Error Message)

When the symptom is ambiguous — stuck, hung, no output, a CLI that never returns — use this order. Stop as soon as you find the root cause.

1. **Command output** — re-run the failing command directly (not through an aggregator) and read stderr/stdout. For a `supaschema` command, decode any code with `supaschema explain <SUPA_CODE>`. If there is no output at all, that is the signal — see `references/common-hang-causes.md`.
2. **Stuck vs busy** — is the process hung (no CPU) or busy (high CPU)? For an actively-busy process (a runaway test, a tight planner loop), go to `references/cpu-spike-triage.md` (`ps -M <pid>` first). For a truly hung process, look for an unresolved promise / missing `await` / a DB connection that never returns (`references/common-hang-causes.md`).
3. **CI** — for a failing GitHub Actions run, inspect the remote run before changing code: `gh run view <run_id> --log-failed`, `gh pr checks <pr>`. Anchor to the run's head SHA; do not assume a local repro matches.
4. **Services** — for the FastMCP server, run `npm run fastmcp:inspect` / `fastmcp:status` (it is read-only stdio). For the Cloudflare Worker, use `npx wrangler dev` / `npx wrangler tail`.

### Stop condition

Stop on a high-confidence root cause (a specific error, a missing env var, a decoded `SUPA_*` code, a failing step). Stop when two consecutive triage steps produce no signal — report what you checked, what you found (nothing), and ask the user for context. Do not keep cycling steps hoping something appears.

## Code Failure Workflow

1. **Scope before choosing commands.** Use Code Atlas first for repo-wide owner/impact/consumer/generated-surface evidence: `npm run code-atlas:query -- trace-change <target> --json`, `npm run code-atlas:query -- pre-edit <file> --json`, `npm run code-atlas:query -- consumers <file> --json`, or `npm run code-atlas:query -- health <filter> --json`; when MCP access is available, follow Rule 10's local `supaschema.code_atlas_query` policy before broad source reads.
2. **Capture the full error surface** with the real gates:
   - `npm run typecheck` (`tsc` over `tsconfig.src.json` + `tsconfig.tools.json`) for TS errors; route by code — `TS1484`/`TS1485` (type-only import needed under `verbatimModuleSyntax` → add `import type`), `TS2305`/`TS2724` (missing export from `dist/` — rebuild before editing consumers), `TS2345`/`TS2339` (shape mismatch — check the source model / generated types).
   - `npm run lint` (`ultracite check .`) / `npm run lint:ci` (`biome ci .`) for lint/format; chain to the `ultracite` skill for rule specifics.
   - `npm test` (Vitest) for behavior; DB-gated suites need a local Postgres reachable via `SUPASCHEMA_DATABASE_URL` and skip otherwise.
   - `npm run guard` (`scripts/guards/check-all.mjs`) when tooling stack, agent surfaces, dependency catalog, Code Atlas, LSP coverage, or FastMCP surface may be involved.
   - targeted `mcp__cclsp__get_diagnostics` and the cclsp symbol-flow tools for exact behavior.
3. **Python / FastMCP** (`services/agent-mcp`): `npm run py:lint` (`ruff check`), `npm run py:format:check` (`ruff format --check`), `npm run py:typecheck` (`mypy` strict), `npm run py:test` (`pytest`); `uv sync --locked` reproduces the env and fails on lock drift. See Rule 04 and the `fastmcp` skill.
4. **Schema / migration** (`SUPA_*`): decode with `supaschema explain <CODE>`; reproduce with `supaschema diff` then `supaschema check`/`supaschema verify`. Generated migrations (`-- supaschema: lineage`) are never hand-edited — change the declarative tree and regenerate (the `supaschema` skill and `.claude/rules/supaschema.md`). For generated-type drift, regenerate with `supaschema types` (from the tree, no database).
5. **CI failures** — inspect the remote run first (`gh run view`/`gh pr checks`). The CI surface is the seven workflows under `.github/workflows/` (`ci.yml` quality/check/check-os, `release.yml`, `python.yml`, `codeql.yml`, `scorecard.yml`, `dependency-review.yml`, `docs.yml`) — see Rule 09. Separate Actions failures from external services; do not invent nonexistent workflows as evidence.
6. **Cloudflare Worker** — `npx wrangler dev` for local repro, `npx wrangler tail` for live logs; the worker is a thin docs reverse-proxy (`cloudflare/mintlify-docs-worker.js`).
7. **Verify the remediation path** before editing — `cclsp` find-definition/references/implementation for real symbol flow, `git log`/`git blame` for the regression window.
8. **Apply the smallest root-cause fix**, then re-run the exact gate that failed.

## Rules

- npm only (never pnpm/yarn). Drive scripts via `npm run <name>` exactly as declared in `package.json`.
- Use Code Atlas (Rule 10) before broad source/owner/consumer/dependency/generated-surface claims; use cclsp + direct source reads for the exact claim.
- For GitHub Actions failures, inspect the remote failing run and logs before assuming a local repro is sufficient.
- For migration/schema work, never hand-edit a generated `-- supaschema: lineage` file; fix the declarative tree and regenerate. Resolve any `SUPA_*` via `supaschema explain`.
- Analyze code structure with an AST, never ad hoc regex (Rule 07). Never use `as any` to silence a real type problem. Never skip reading a file before editing it.
- Change `.claude` sources, not the `.codex`/`.agents` mirrors; run `npm run sync:llm` after.
- Prefer local work; only use parallel agents if the user explicitly asked for delegation.

## Verification

Run only the affected checks:

- `npm run lint` / `npm run typecheck` when source, imports, or types changed.
- `npm test` (Vitest) for behavior; coverage-gated and DB-gated cases need a local Postgres.
- `npm run py:lint` / `npm run py:typecheck` / `npm run py:test` when `services/agent-mcp` changed.
- `supaschema check` / `supaschema verify` when a migration or the declarative tree changed.
- `npm run guard` when imports, tooling, agent surfaces, Code Atlas, or LSP coverage changed.
- `npm run docs:lint` when `docs/**` changed; `npx wrangler` when the worker changed.
- targeted `cclsp` diagnostics/symbol-flow for modified files.

## References

- `references/common-hang-causes.md` — silent async failures, missing env, connection exhaustion, and the no-signal protocol.
- `references/cpu-spike-triage.md` — active-CPU-spike diagnostics: the `ps -M` per-thread breakdown, V8 main-thread saturation, the inspector-stringification loop, and libuv/sync work.
- the `ultracite` skill for Biome lint/format, the `supaschema` skill for migration policy, the `code-atlas` skill for the repo graph, and `fastmcp` for the FastMCP server.
