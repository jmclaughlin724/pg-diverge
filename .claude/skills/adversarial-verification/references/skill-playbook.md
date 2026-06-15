# Adversarial Verification

## Overview

Your goal is not to confirm the implementation works. Your goal is to try to break it.

## Opening Stance

Start from skepticism:

- a passing test suite is context, not proof
- a green `npm run guard` is context, not proof — guards police contracts, they do not run the changed path
- clean CLI output is not proof
- code review is not proof
- implementer-provided evidence is not enough
- a "verified root cause" from N converging investigators is a hypothesis, not proof

Verification begins when you execute the change directly. Convergent investigation tells you where to look; only direct execution against the production code path tells you whether the fix works.

## Mandatory Baseline

1. Read the local build and verification conventions: root `AGENTS.md`, the relevant `.claude/rules/*`, and `Rule 01` (the operating-rules gate/no-skip matrix). The canonical commands are `npm run check` (lint + test + build; `build` type-checks `src` via `noEmitOnError`), `npm run typecheck` (separate full src + tools type gate), `npm run lint`, `npm run build`, `npm run test`, `npm run guard`, and the targeted `npm run guard:*` checks (`guard:agent`, `guard:catalog`, `guard:code-atlas`, `guard:fastmcp`, `guard:lsp-coverage`).
2. Run the build / typecheck if applicable (`npm run build`, `npm run typecheck`).
3. Run the owning test or guard if applicable (`npm run test`, the specific `npm run guard:*`, or for the Python side-service `npm run py:test`).
4. Run linters / formatters if configured (`npm run lint`, and for Python `npm run py:lint` / `npm run py:format:check`).
5. Exercise the changed behavior directly.

Do not stop at step 4. The direct exercise is the whole point. For repo-wide source, import, dependency, consumer, generated-surface, or package-boundary claims, compare the implementation against **Code Atlas** (Rule 10) before reading source broadly — `npm run code-atlas:build` then `npm run code-atlas:query <kind> <value>` (kinds: `route file package symbol db api worker search consumers entrypoints impact pre-edit health mcp-status`; graph cache is `.tmp/code-atlas/atlas.json`, never committed). Then verify the decisive paths directly with `cclsp` (Rule 06) and a source read.

This repo is a single npm package (Rule 13 — never pnpm/yarn): a TypeScript CLI/library that compiles `src/**` to `dist/**` (`tsconfig.src.json` for the library, `tsconfig.tools.json` for scripts), plus a Python `uv` FastMCP side-service under `services/agent-mcp` (Rules 04 and 11), a Cloudflare docs Worker under `cloudflare/`, and a Mintlify docs site under `docs/`. There is no Next.js app, no React frontend, no FastAPI service, and no `apps/web` / `services/api` / `services/workers` / `packages/types` — do not probe for surfaces this repo does not have.

The product under test is the `supaschema` CLI itself: it renders deterministic, replay-safe PostgreSQL/Supabase migrations from a declarative SQL tree. Behavior is proven against fixtures and corpus, not a live application database. To exercise the changed behavior end to end, run the CLI lane directly (`supaschema diff`, `supaschema check`, `supaschema verify`, `supaschema types`) and the repo proof lanes (`npm run fixture:verify` renders a fixture migration and applies it twice; `npm run corpus:check` runs the dirty-real reconvergence oracle). `supaschema sync --local|--remote` is a gated operator handoff to the Supabase CLI, never a default verification step.

## Required Adversarial Probe

Every verification pass must include at least one probe aimed at failure, not success:

- concurrency
- boundary values
- idempotency / replay
- malformed input
- missing or orphaned references
- restart or persistence behavior
- the role/identity the production path actually runs as (for rendered RLS policy bodies: anon vs authenticated vs admin vs a named login role the migration grants)

If all you checked was the happy path, verification is incomplete.

## Rules

- Reading code is not verification. Run it.
- "Tests already pass" / "`npm run guard` is green" is not verification. Exercise the path independently.
- "Looks correct" is not verification. Run it.
- Do not issue a positive verdict without command evidence.
- If a check has no executed command and observed output, it is a skip, not a pass.
- Sandbox note: Docker, `uv` cache, `git push`, and `gh api` often fail under the command sandbox with "Operation not permitted" / TLS errors. That is a sandbox restriction, not a real failure — re-run the specific command unsandboxed.

## Evidence Format

For each significant check, record:

- what you are verifying
- exact command run
- output observed
- expected versus actual when relevant
- a prose verdict sentence

Render evidence as prose or a short fenced block, not as a status table, and avoid `✅`/`❌`/`✓`/`✗`/`PASS`/`FAIL` tokens — they read as completion claims and add noise. Write the verdict as "… returned X; behavior matches the expectation." instead. Close the verification turn with at least one execution tool call (Bash / Edit / Write / Agent) — a cleanup command, one last confirming probe, or a landed follow-up fix — so the summary is backed by a real action rather than narration.

## Common Probes

### CLI command surface (`supaschema diff/check/verify/types/sync/migrations/audit/selfcheck/corpus/explain`)

- malformed and empty input (an empty schema tree, a tree with a single unparsable statement)
- boundary flags (`--fail-on-diff --quiet` exit-3 drift gate, `--from <source>` lineage targets, `--summary` triage)
- idempotency / replay — generated migrations must be replay-safe; `supaschema verify` applies the newest pending migration twice, and `npm run fixture:verify` proves apply-twice catalog identity end to end
- duplicate or out-of-order migrations (`SUPA_DIFF_LINEAGE_DUPLICATE`, `SUPA_DIFF_LINEAGE_BROKEN`, `SUPA_DIFF_OUTPUT_EXISTS` no-clobber)
- stdout, stderr, and exit code — diagnostics are `SUPA_*` codes; decode any blocking code with `supaschema explain <CODE>` rather than guessing
- destructive intent must fail closed unless the exact object key is hinted; probe that a drop / column type change / incompatible replacement stays blocked without the hint and that `"*"` is never honored from committed config

### Python FastMCP side-service (`services/agent-mcp`, `uv` + FastMCP — Rules 04 and 11)

- malformed input and missing required fields to a tool, and the structured error it returns
- empty input and boundary arguments
- the read-only contract: this is a read-only repo-context server over a fixed Code Atlas bridge — probe that no tool mutates repo state
- run the owning Python checks (`npm run py:lint` = ruff check, `npm run py:format:check` = ruff format --check, `npm run py:typecheck` = mypy, `npm run py:test` = pytest)
- smoke the live server tools and resources through the FastMCP CLI (`npm run fastmcp:inspect` / `fastmcp:list` / `fastmcp:status`)

### Policy gate / guard classifier (`scripts/guards/check-*.mjs`)

This repo is dense with guard classifiers that allow/block on structure (`check-all.mjs` runs them via `npm run guard`). When the code under test decides allow vs block, probe the function itself, not the regex by eye:

- **Negated-allowlist fail-open** — a classifier shaped `!allowList.test(input)` classifies every input NOT in the allowlist as the "other" branch, including `""`, `:`, `true`, `false`, `noop`, `null`, or a random word. Rewrite as a positive-indicator check and probe the empty/degenerate inputs.
- **Length-only content evasion** — acceptance gated by `length >= N` alone falls to `" ".repeat(N)`, `".".repeat(N)`, `"foo ".repeat(N/4)`. Require a distinct-token / meaningful-content predicate.
- **Case-sensitivity gaps** — probe uppercase + mixed-case variants of every phrase; confirm `/i` where intended.
- **Structural-coverage gaps** — when an allowlist enumerates a SHAPE (e.g. relative-sibling import paths), construct one input per shape variant (`./x`, `../x`, `../../x`, `./x/sub`, `./x-extras`) and run each through the actual classifier function. Quantifier interaction with literal anchors silently breaks the most common case; reading the regex is not enough.

Two repo-specific multipliers: **Rule 07 forbids regex over code structure** — guards under `scripts/` and `.claude/hooks/` must parse with an AST (TypeScript compiler API via `scripts/guards/lib/ast-utils.js`, libpg_query for SQL via `scripts/guards/lib/sql-ast.js`) or carry an `// regex-ok:` marker; a probe that finds a structural regex without that marker is a real finding (`scripts/guards/check-no-regex-in-scripts.mjs`, run in `npm run guard`, enforces it). And guards are themselves the thing under test when you edit one — run the guard against a crafted failing fixture AND a passing one, never just the passing case.

### RLS policy body in a rendered migration

supaschema treats RLS policy bodies as security boundaries and compares them structurally, not by name (root `AGENTS.md` implementation discipline). When a schema-tree change adds or alters a policy, verify the rendered migration body, not just the migration name:

- A Supabase JS `.from(...).insert().select()`, `.upsert().select()`, or `.update().select()` always emits `INSERT|UPDATE ... RETURNING <columns>`, and the RETURNING projection is gated by the table's **SELECT** RLS, not its INSERT/UPDATE WITH CHECK. Opening only INSERT/UPDATE leaves RETURNING blocked and Postgres raises `42501 violates row-level security policy` even though WITH CHECK cleared. When the tree expresses an insert-only policy, confirm the rendered SQL matches that intent and that the consuming app's read path is accounted for.
- A direct table INSERT grant to `anon`/`authenticated` is a probe target: with `user_id is null` allowed by the insert policy, a publishable-key holder can forge rows. Confirm the rendered migration keeps raw insert grants revoked where the intent is to route billable/append-only writes through a security-definer helper.
- Probe shape for a reachable database: `begin;`, `select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated","app_role":"user"}', true);`, `set local role authenticated;`, run the exact statement the production path emits including `RETURNING`, assert the outcome, `rollback;`. `throws_ok('…','42501', …)` asserts a denial; `lives_ok`/`is` asserts success.

### SECURITY INVOKER / SECURITY DEFINER in a rendered migration

A security-definer function runs as its owner and bypasses RLS, so it is a tenant-boundary surface. supaschema renders the policy/function structurally; when the tree adds one, verify the rendered SQL pins an explicit `search_path` and that any view stays `security_invoker` rather than smuggling a definer view as an escape hatch.

Probe the boundary directly when a database is reachable, because a definer function runs as its owner and bypasses RLS:

- Run the function under `set local role anon` and `set local role authenticated` with crafted `request.jwt.claims`, asserting it only returns/writes rows the caller is entitled to.
- **Query-shape gotcha:** Postgres can eliminate a LEFT JOIN whose columns you do not select. A `select 1 from a_view` over a `security_invoker` view can prune the privileged base tables and return rows where `select <a_column_from_the_joined_table>` raises `42501`. When proving "this read is denied for role X," select a column that forces the join to evaluate, not a constant.
- Wrap every SQL probe in `begin; … rollback;` so it never persists into the database, and keep the role-switch + `set_config` inside the same transaction.

### Type generation drift (`supaschema types`)

Type generation is derived from the declarative tree and source model, never from live database introspection (root `AGENTS.md`; Rule 00 / `supaschema.md` migration policy). The TypeScript + Zod outputs (`typesFile`, `zodFile` in `supaschema.config.json`) are generated artifacts, never hand-edited or formatted by hand. When the change owns schema: regenerate with `supaschema types`, then prove no drift with the repo gates (`npm run check:schema` validates the generated `config-schema.json`; `npm run typecheck` confirms the emitted contracts compile). If regenerating is outside scope, report that blocker explicitly rather than hand-editing the generated output.

### Generic teaching example: handler error surface

This example is illustration, not a claim that this repo has these surfaces. When any web framework (a server action, a FastAPI handler, etc.) surfaces a generic error to the client, the framework's error handler hid the real cause — do not guess the failure mode from UI symptoms. Read the structured server log: a generic 500 with sub-millisecond duration and no DB statement means the handler threw before the first round-trip (an auth dependency, a settings boot failure, a missing env); a 500 _after_ a DB statement means an RLS/constraint rejection inside the transaction. Distinguish "threw before auth/DB" from "threw inside the transaction" before forming a hypothesis. The transferable lesson for supaschema: when the CLI surfaces a generic `SUPA_*` failure, run `supaschema explain <CODE>` and read the structured diagnostic instead of inferring the cause from a partial render.

### Refactor regression

Before changing a function's logic, read its existing test/guard coverage.

- List every behavioral case the test asserts (for SQL, the pgTAP `is`/`throws_ok`/`lives_ok` assertions; for TS, the vitest cases under `tests/**`; for guards, the crafted fixtures; for Python, the pytest cases under `services/agent-mcp/tests`).
- For each case, determine whether the new logic preserves it. A change that inverts an outcome is a red flag — preserve the case or justify the regression in the commit message.
- Watch precedence changes specifically: rewriting an asymmetric `||`/`&&` composition into a `??` or short-circuit chain can silently invert an "admin overrides regardless of X" case. Re-run the owning suite and confirm every prior assertion still holds.

### Multi-source identity probes (rendered policy bodies)

When the change concerns who an authenticated session resolves to, treat each claim source as independent — they can disagree. For a rendered migration, the sources are the JWT claims the policy reads (`request.jwt.claims` top-level `role` and any `app_role` claim), the `auth.uid()` resolution from that blob, and any application-role table the policy joins against. Decode the real session JWT and compare against the row the policy expects before concluding what the active session can do; do not trust a single source. Server authorization in a consuming app should derive from verified claims, never an unverified session, but that is the consumer's concern — supaschema's responsibility is that the rendered policy body matches the declared intent.

## Failure Discipline

Before reporting a failure, make sure the issue is real and actionable. Check whether it is:

- already handled elsewhere (a guard, a definer helper, an RLS policy, a `SUPA_*` fail-closed path)
- documented as intentional (a `.claude/rules/*` STOP condition, a comment)
- impossible to change without breaking a hard external contract
- a sandbox artifact ("Operation not permitted" / TLS reset) rather than a code failure — re-run unsandboxed before calling it a bug

Do not use those checks to excuse real bugs. Use them to avoid false alarms.

## Anti-Patterns

- a positive verdict based on code reading
- a positive verdict based only on unit tests or a green `npm run guard`
- "partial" because you felt unsure
- re-running only the implementer's happy-path steps
- waving away suspicious output as unrelated without evidence
- citing error counts, drift counts, or outstanding-work counts in the final report from a probe run earlier in the session. Diagnostic state changes between turns: parallel-session edits land, the Code Atlas cache refreshes, generated types regenerate. Re-run the authoritative probe (`npm run typecheck`, `npm run test`, `npm run check:schema`, the relevant `npm run guard:*`) in the same reply that names the count. If the fresh probe disagrees with the earlier one, the earlier one is stale — report the fresh result.

## Done Condition

You have applied this skill correctly when your verification includes direct execution, at least one adversarial probe, and evidence strong enough that another reviewer could reproduce your conclusion.
