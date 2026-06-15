# supaschema — Consolidated Best-Practices Gap Determination

> The single authoritative "what's missing to reach and enforce optimal best practices" list for this repo.
> Merges three audits: **#1** repo organization / build / CI (see `turborepo-org-audit.md` §1–6),
> **#2** per-stack standards (see `turborepo-org-audit.md` Addendum §1–5), and **#3** the project-level
> dimensions below (testing, release/versioning, dependency & supply-chain, observability,
> contribution/DX, docs completeness). Determination only — describes *what* is missing and the smallest
> correct standard, not implementation steps. Every claim is grounded in a live file.
> Generated 2026-06-15.

## 1. Executive determination

supaschema is a **well-engineered single-package npm TS CLI/library** with genuinely strong fundamentals — its weak spots are concentrated, not systemic. The publishing pipeline, SQL correctness model, and diagnostic system are already at or near best-practice; the real gaps cluster in three places: (a) **CI doesn't enforce what it should** (no egress control on the privileged OIDC publish job; the FastMCP service's security guards have zero tests; DB-independent work is triple-run across the Postgres matrix), (b) **the Python side-service and Cloudflare Worker are governed by hand** (no Python CI, no lint/type config, Service-Worker-format worker), and (c) **the project's contribution & release surface is essentially empty** (no CONTRIBUTING/CODEOWNERS/templates/editorconfig/local hooks, no release automation, and — notably for a dual-licensed product — no dependency-license gate). The single highest-leverage theme is **"close the gap between standards-on-paper and standards-enforced"**: most fixes are small, additive, and conform to the npm-only contract. **Turborepo, a monorepo/workspaces split, and Next.js are settled as NOT needed** (audit #1); reconciling the stale imported `.claude/rules/*` templates is tracked separately and **out of scope** here.

## 2. What this repo already does well (calibration)

So the gap list is read against a high baseline, not as a list of failures:

- **Publishing supply-chain is exemplary** — npm OIDC trusted publishing (with an `npm>=11.5.1` preflight), `--provenance`, a second Sigstore `attest-build-provenance` layer, and full tarball npx smoke-tests before publish (`release.yml`).
- **Actions are SHA-pinned**, default token scope is read-only, `npm audit signatures` runs in CI, and OpenSSF Scorecard + CodeQL are wired (`scorecard.yml`, `codeql.yml`).
- **SQL correctness is AST/model-owned** (libpg-query), with an **apply-twice `verify` oracle** and a **dirty-real corpus reconvergence oracle** (`corpus:check`) — strong determinism guarantees most tools lack.
- **Diagnostics are a model surface** — `src/diagnostics.ts` + `redactSecrets`, **75 distinct `SUPA_*` codes**, zero raw `console.*` in `src/`. The diagnostic system *is* the observability layer, by design.
- **Configs are single-sourced** (one `tsconfig.json`/`biome.json`/`vitest.config.ts`); validation layers are clean (`src/config.ts` is Zod-v4-idiomatic; `server.py` is 100% Pydantic-v2-clean).
- **Tests are substantial** — 43 test files, snapshots, fixtures, a `fast-check` property suite, and the two oracles above.
- **Docs IA is strong** — a 7-group Mintlify site incl. a library API-reference page, governed by a deterministic `docs:lint` gate.

## 3. Consolidated gap determination by domain

Severity is calibrated to a single-package CLI/lib + tiny Python side-service + thin docs Worker. `[#1]`/`[#2]`/`[new]` mark the source audit.

### Build & TypeScript
- **No `incremental`/`tsBuildInfoFile`** in `tsconfig.json` → every `tsc` is a cold full compile; `build` runs 6×. Add both; ignore/clean `dist/.tsbuildinfo`. *Low (high-leverage) · Small `[#1]`*
- **`check` double-compiles** (`typecheck --noEmit` then emitting `build`, `package.json:79`) → drop `typecheck` from the chain, keep it standalone. *Low · Small `[#1]`*
- **No `verbatimModuleSyntax`** for the ESM-only NodeNext `.d.ts`-emitting lib (typecheck already passes with it on). *Low · Small `[#2]`*
- **No `noEmitOnError`** → `build` emits `dist/` even on type errors before the published artifact. *Low · Trivial `[#2]`*

### CI/CD topology & gates
- **DB-independent work runs across the pg `[15,16,17]` matrix** (`ci.yml`) + repeats on mac/win + a 4th time in `release.yml` → split a single un-matrixed `quality` job; leave only DB-gated steps in the matrix. *Low · Medium `[#1]`*
- **No `concurrency: cancel-in-progress` / `timeout-minutes`** in any workflow. *Low · Small `[#1]`*
- **`release.yml` re-runs the full `check` chain** + lacks `cache: npm` + builds on Node 24 while CI tests Node 22. *Medium · Small `[#1][#2]`*
- **CI lint uses `biome check`, not `biome ci`** → loses inline PR annotations + write-immunity. *Low · Small `[#2]`*

### Testing & coverage
- **Coverage is collected but enforces no thresholds** (`vitest.config.ts`) → add a `thresholds` block + `reportOnFailure`, seeded below the measured floor and ratcheted. *Low · Small `[#2][new]`*
- **`test:coverage` re-runs the whole suite** already run by `test`; **`maxWorkers:4`** throttles pure parser/renderer tests to the DB ceiling → run coverage once on the pg17 leg; project-split fast vs DB-gated suites. *Low · Medium `[#1]`*
- **Property testing under-leveraged** — `fast-check` is used in a single file (`tests/property.test.ts`) for a deterministic SQL planner that is an ideal property-test target (parse→deparse round-trips, idempotent replay). Expand opportunistically. *Low · Medium `[new]`*

### Release / versioning
- **No release automation** — `CHANGELOG.md` is hand-maintained and version bumps are manual (2 tags, no `.changeset`/release-please/semantic-release config) → adopt a lightweight automated version+changelog (Changesets fits a single package) so the changelog and semver can't drift from what shipped. *Medium · Small `[new]`*
- **No documented deprecation / supported-version policy** — `SECURITY.md` exists but states no support window; for a published lib consumers need to know which versions get fixes and how breaking changes are signaled. *Low · Small `[new]`*

### Dependency & supply-chain
- **No dependency-license gate despite dual AGPL-3.0 + commercial licensing** — nothing prevents a license-incompatible (or commercially-unrelicensable) transitive dep from landing, and there is no `NOTICE`/third-party attribution file → add a license-allowlist check (e.g. in `dependency-review-action`'s `deny-licenses`, or a small CI step) + a generated third-party notice. This is the most material *new* gap. *Medium · Small `[new]`*
- **Dependabot covers only npm + github-actions** — the `uv`/pip ecosystem (`services/agent-mcp`, `uv.lock`) gets no update PRs → add a `pip` ecosystem entry. *Low · Trivial `[#2][new]`*
- **No `dependency-review` gate on PRs** → vulnerable/disallowed deps are caught only post-merge. *Medium · Small `[#2]*`*
- **No SBOM** (CycloneDX) — optional, but a natural complement to the existing provenance/attestations. *Low · Small `[new]`*

### Security hardening
- **The publish job's real exposure is unrestricted egress, not a missing approval gate.** It runs `npm ci` + build/test/benchmark under `id-token: write` before `npm publish`; a compromised build/test dependency could exfiltrate the OIDC token. Fix = **`step-security/harden-runner` (egress audit→block) as the job's first step**. Publishing is *already* human-gated — `release: published` only fires when a maintainer manually publishes a GitHub Release — so egress control, not a reviewer, is the substantive hardening. *Medium · Medium `[#2]`* (Severity corrected down from an earlier "High environment gate" framing after verifying the manual-release trigger.)
- **`environment: release` is optional hardening, not a security gate for this repo.** A required-reviewer environment would mean approving your own manually-published release (redundant for a solo, manual-trigger flow). Its one genuine benefit is scoping the npm trusted-publisher OIDC subject to `environment:release` — worth keeping *only if* you register that binding on npmjs.com. Remaining real items: **`persist-credentials: false`** (was only in `scorecard.yml`), **CodeQL `python` matrix** (`server.py` was unanalyzed), and **`CODEOWNERS`** on publish-critical paths. *Low · Small `[#2]`*

### Observability & diagnostics
- **Already strong** (see §2). The only optional items: no runtime crash reporting (Sentry is configured in `.mcp.json` as dev tooling and referenced in `server.py`'s capability index, but not wired into the published CLI or Worker runtime) — acceptable for a deterministic generator; **telemetry absence is an explicit privacy stance, not a gap**. Decide and document the no-telemetry position rather than treat it as missing. *Low · n/a `[new]`*

### Contribution & developer-experience  ← weakest area
- **All absent:** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.editorconfig`, `.nvmrc`/`.node-version`, `CODEOWNERS`, `.github/ISSUE_TEMPLATE`, PR template, devcontainer. For an OSS+commercial project accepting contributions this is a cluster of missing standards. *Medium (as a group) · Small each `[new]`*
- **No local pre-commit/pre-push hook** (no husky/lefthook/simple-git-hooks) → contributors discover lint/typecheck/guard failures only in CI. A local hook running `lint`+`typecheck`+`guard` is the cheapest way to **enforce** the existing-but-unwired guard suite at the developer boundary. *Medium · Small `[new]`*
- **No CLA/DCO** for a dual-licensed project → relicensing contributed code into the commercial license has no contributor agreement backing it. *Low · Small (legal) `[new]`*

### Python / FastMCP service
- **FastMCP read-only security guards have ZERO tests** — `tests/` is empty despite a configured `pytest-asyncio` harness; `_resolve`/`_denied` (path-traversal, `.env`/secret blocking) are the server's whole point and are unverified → add `test_server.py` (in-memory `Client(mcp)`). **HIGH · Small `[#2]`**
- **No Python CI lane** (uv-lock freshness, ruff, mypy/pyright, pytest, pip-audit); **no `ruff`/`mypy` config**; **`guard:fastmcp` orphaned** (not in `check`/CI); **`BM25SearchTransform` hides the 6-tool catalog**; **no `ToolAnnotations`**; **bare `ValueError` vs `mask_error_details`**; **`code_atlas_query` `kind` unvalidated**; **empty leftover `acme_agent_mcp/`** → bundle the server-shape edits in one pass; land Python CI with the new lint/type/test config. *Medium/Low · Small `[#2]`*

### Cloudflare Worker
- **Service-Worker format** (`addEventListener`, `cloudflare/mintlify-docs-worker.js:5`) not ES-module `export default { fetch }`; **no `[observability]`**; no CI deploy or proxy-logic tests (optional). *Low · Small `[#2]`*

### Validation boundaries
- **Config-file boundary uses throwing `.parse()`** (`src/config.ts`) → library consumers of `loadConfig()` get a raw `ZodError`; route through `safeParse` → a redacted `SUPA_CONFIG_INVALID` diagnostic. **Pin `z.toJSONSchema` `target`** so `config-schema.json` can't drift on a zod bump. *Medium/Low · Small `[#2]`*
- **`config-schema.json` is committed + regenerated with no drift gate** → add a regenerate-and-`git diff --exit-code` check. *Low · Small `[#1]`*
- **`.wrangler/` not gitignored**; **`clean` understates the generated set**. *Low · Trivial `[#1]`*

### Documentation completeness
- **`typedoc` is configured (`docs:api`) but `api-docs` is never generated/published** while the library API reference is hand-written in Mintlify → pick one canonical source (publish typedoc, or keep the hand-written page and drop/repurpose `docs:api`) to avoid silent drift. *Low · Small `[new]`*
- **`examples/` ships in `files[]` but isn't smoke-verified in CI** (only `tests/fixtures/basic` is) → optionally run an example through `diff`/`check` in CI so shipped examples can't rot. *Low · Small `[new]`*

## 4. Master prioritized table

Every confirmed gap, ordered by severity × leverage / effort. The two **High** items lead.

| # | Item | Domain | Sev | Effort | Src |
|---|------|--------|-----|--------|-----|
| 1 | `harden-runner` (egress audit→block) on the OIDC publish job | Security | Med | Med | #2 |
| 2 | Add `test_server.py` (in-memory `Client(mcp)`) pinning FastMCP read-only guards | Python | **High** | Small | #2 |
| 3 | `tsconfig` `incremental` + `tsBuildInfoFile`; ignore/clean `dist/.tsbuildinfo` | Build | Med-lev | Small | #1 |
| 4 | Drop double-`tsc` from `check`; keep `typecheck` standalone | Build | Low | Small | #1 |
| 5 | Remove `BM25SearchTransform`; add `ToolAnnotations`; `mask_error_details`; validate `kind` (one server-shape pass) | Python | Med | Small | #2 |
| 6 | Add Python CI lane (`uv sync --locked` + ruff + mypy + pytest + pip-audit) | CI/Python | Med | Med | #2 |
| 7 | Add `[tool.ruff]` + `[tool.mypy]` config | Python | Low | Small | #2 |
| 8 | Wire `guard:fastmcp` (+ guard suite) into `check`; add Pydantic-v1 deny-list | Python/CI | Med | Small | #2 |
| 9 | Split DB-independent `quality` job out of the pg `[15,16,17]` matrix | CI | Low | Med | #1 |
| 10 | `dependency-review-action` on PRs (+ `deny-licenses` for the dual license) | Supply-chain | Med | Small | #2/new |
| 11 | Dependency-license gate + generated `NOTICE`/third-party file | Supply-chain | Med | Small | new |
| 12 | Release automation (Changesets) for version + CHANGELOG | Release | Med | Small | new |
| 13 | Align release/CI Node major (add 24 to `ci.yml` matrix; drop `check-latest`) | CI/Node | Med | Small | #1/#2 |
| 14 | Route config boundary through `safeParse` → `SUPA_CONFIG_INVALID` (redacted) | Validation | Med | Small | #2 |
| 15 | Vitest coverage `thresholds` + `reportOnFailure` | Testing | Low | Small | #2/new |
| 16 | Local pre-commit/pre-push hook (lefthook) running lint/typecheck/guard | Contribution | Med | Small | new |
| 17 | `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md` + issue/PR templates + `.editorconfig` + `.nvmrc` | Contribution | Med | Small | new |
| 18 | `.github/CODEOWNERS` on publish-critical paths | Security/Contrib | Low | Trivial | #2/new |
| 19 | `environment: release` — optional; keep only if bound in npm trusted-publisher (no required reviewer) | Security | Low/opt | Small | #2 |
| 20 | `persist-credentials: false` on ci/codeql/docs/release checkouts | Security | Low | Small | #2 |
| 21 | `concurrency: cancel-in-progress` + `timeout-minutes` on workflows | CI | Low | Small | #1 |
| 22 | `config-schema.json` regenerate-and-diff drift gate | Validation/CI | Low | Small | #1 |
| 23 | `.wrangler/` gitignore; broaden `clean` | Build | Low | Trivial | #1 |
| 24 | `verbatimModuleSyntax` + `noEmitOnError` in `tsconfig` | Build | Low | Trivial | #2 |
| 25 | `biome ci` in CI; `release.yml` `cache: npm` + drop redundant `check` | CI | Low | Small | #1/#2 |
| 26 | Convert Worker to ES-module `export default { fetch }`; add `[observability]` | Worker | Low | Small | #2 |
| 27 | `pip`/uv ecosystem in Dependabot; CodeQL `python` matrix | Supply-chain/Sec | Low | Trivial | #2/new |
| 28 | Pin `z.toJSONSchema` `target`; `sideEffects: false`; confirm trusted-publisher reg | Validation/Node | Low | Trivial | #2 |
| 29 | Documented deprecation/supported-version policy; CLA/DCO | Release/Legal | Low | Small | new |
| 30 | Resolve typedoc-vs-handwritten API-ref drift; smoke-verify `examples/` in CI | Docs | Low | Small | new |
| 31 | Expand `fast-check` property coverage of the planner | Testing | Low | Med | new |
| 32 | `rm -rf acme_agent_mcp/`; drop redundant `Field(default=)` ×3 | Python | Low | Trivial | #2 |

## 5. Sequenced standardization roadmap

Three waves. Each is independently shippable; later waves depend on nothing in earlier ones except where noted.

**Wave 1 — Highest-leverage + safe (mostly trivial/small, no new infra):**
`tsconfig` incremental + `verbatimModuleSyntax` + `noEmitOnError` · drop double-`tsc` · the FastMCP server-shape pass (#5) + `test_server.py` (#2) · `harden-runner` egress (audit) on the publish job (#1) · align Node major (#13) · `.wrangler/` gitignore + `clean` (#23) · `config-schema.json` drift gate (#22) · `safeParse`→`SUPA_CONFIG_INVALID` (#14) · pin `z.toJSONSchema` target + `sideEffects:false` (#28) · delete `acme_agent_mcp/` (#32).

**Wave 2 — CI standardization & enforcement:**
Split the `quality` job (#9) · Python CI lane + ruff/mypy config (#6,#7) · wire `guard:*` into `check` (#8) · `dependency-review` + license gate + `NOTICE` (#10,#11) · Vitest thresholds (#15) · `biome ci` + `release.yml` cache/dedup (#25) · `concurrency`/timeouts (#21) · `CODEOWNERS` (#18) · `persist-credentials` (#20) · `pip` Dependabot + CodeQL python (#27) · `harden-runner` on publish (#19) · Worker module-format + observability (#26).

**Wave 3 — Standards to introduce (net-new surfaces):**
Release automation / Changesets (#12) · contribution surface — CONTRIBUTING/CoC/templates/.editorconfig/.nvmrc + local lefthook hook (#16,#17) · deprecation/support policy + CLA/DCO (#29) · API-reference canonicalization + example smoke-verify (#30) · SBOM (optional) · expanded property testing (#31).

## 6. Explicitly not needed / out of scope

- **Turborepo, monorepo/workspaces, pnpm** — settled in audit #1; inert for a single JS package, and `AGENTS.md` mandates npm-only. The `&&` script chains are intentional.
- **Next.js / React / shadcn / Supabase SSR app** — no such surface exists; not required.
- **Reconciling the stale imported `.claude/rules/*` templates** (the Next.js/shadcn/betting cruft and the ~25 dangling guard references) — a real, separate cleanup effort, explicitly deferred and **not** part of this determination.
- **Enterprise ceremony unfit for this scale** — per-package configs, dual type-checkers, src-layout for the 2-file Python package, `@cloudflare/vitest-pool-workers` as a hard gate, tight per-file coverage thresholds, mandatory telemetry.
