# Rule 09 — CI/CD efficiency and release governance

Sources:

- GitHub Actions workflow syntax: <https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions>
- GitHub Actions secure use (security hardening): <https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub Actions security hardening for OIDC: <https://docs.github.com/en/actions/concepts/security/openid-connect>
- Artifact attestations / build provenance: <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds>
- npm trusted publishing (OIDC): <https://docs.npmjs.com/trusted-publishers>
- OpenSSF Scorecard checks: <https://github.com/ossf/scorecard/blob/main/docs/checks.md>
- step-security/harden-runner: <https://github.com/step-security/harden-runner>
- actions/dependency-review-action: <https://github.com/actions/dependency-review-action>
- astral-sh/setup-uv: <https://github.com/astral-sh/setup-uv>

This repo is a single-package npm TypeScript CLI/library with a Python uv side-service (`services/agent-mcp`, FastMCP) and a Mintlify docs site (`docs/`). There is no Turborepo, no pnpm, no workspaces, no `apps/`, and no Vercel/Render web/API/worker deployment. CI must stay high-signal and supply-chain-hardened: least-privilege tokens, immutable action pins, matrix coverage for every supported runtime, and a release path that publishes via OIDC trusted publishing with build provenance. Runtime/library command behavior and the canonical script list live in `AGENTS.md`; this rule owns the CI/CD posture, not the package scripts.

## Workflow map

The complete CI surface is the seven workflows under `.github/workflows/`:

- `ci.yml` — the pull-request and `main`-push gate. Three jobs:
  - `quality` (matrix `node-version: [22, 24]`, no database): `npm ci`, `npm audit signatures`, `npm run lint:ci` (Biome `biome ci .`), `npm run typecheck`, `npm run build`, `npm run guard`, `npm run check:schema`, `npm run check:package`, `npm run benchmark`, then packs the tarball and smoke-tests `npx supaschema --version|diff|check` plus the shipped `examples/` render+check.
  - `check` (matrix `postgres: [15, 16, 17]` via a `postgres` service container): `npm test`, coverage + Codecov upload on `postgres == 17`, `npm run fixture:diff`, `npm run fixture:verify`, and `npm run corpus:check` — the replay-safety / reconvergence proofs that need a live database.
  - `check-os` (matrix `os: [macos-latest, windows-latest]`, no database): cross-platform path/git handling; DB-gated test cases skip when no database is present.
- `release.yml` — triggered on `release: published`, runs in the `release` environment, on a single Node 24 lane with a `postgres:15` service. Holds `id-token: write` + `attestations: write` + `contents: write`, publishes to npm via OIDC trusted publishing (`npm publish --provenance`, no long-lived `NODE_AUTH_TOKEN`), attests build provenance, and attaches the signed sigstore bundle to the GitHub release.
- `python.yml` — path-filtered (`services/**`, `pyproject.toml`, `uv.lock`, the workflow itself) single Ubuntu lane for the FastMCP service: `uv sync --locked` (lock-drift gate), `ruff check`, `ruff format --check`, `mypy`, `pytest`, `pip-audit`.
- `dependency-review.yml` — pull-request supply-chain gate (`actions/dependency-review-action`): blocks high-severity vulnerable deps and license-incompatible deps (copyleft deny-list keyed to the dual-license model).
- `codeql.yml` — CodeQL static analysis matrix (`javascript-typescript`, `python`) with the `security-and-quality` query suite, on push/PR to `main` and a weekly schedule.
- `scorecard.yml` — OpenSSF Scorecard on `main` push + weekly schedule, uploading SARIF.
- `docs.yml` — path-filtered (`docs/**`, `package.json`, `package-lock.json`, the workflow itself) Mintlify validation via `npm run docs:check`.

## Hard rules

- Every workflow declares a top-level least-privilege `permissions:` block, defaulting to `contents: read` (or `read-all`). A job elevates only the exact scopes it needs: `release.yml`'s `publish` job adds `id-token: write`, `attestations: write`, and `contents: write`; `codeql.yml`/`scorecard.yml` add `security-events: write` (+ `id-token: write` for Scorecard). Never grant write at the top level.
- All `uses:` refs are pinned to full-length commit SHAs with an adjacent version comment (for example `# v6.0.3`) for Dependabot readability. The executable ref must be immutable — never a tag or branch. This is the OpenSSF Scorecard "Pinned-Dependencies" check and a STOP condition if violated.
- `actions/checkout` uses `persist-credentials: false` on every workflow's checkout (all seven: `ci.yml`, `python.yml`, `dependency-review.yml`, `scorecard.yml`, `release.yml`, `codeql.yml`, `docs.yml`); release re-supplies an explicit `GH_TOKEN`/`registry-url` only where a step needs it.
- Every job declares a `timeout-minutes` ceiling so no lane can hang at the 360-minute default — least of all the privileged `release.yml` `publish` job (`ci.yml` 20/30/20, `python.yml` 15, `dependency-review.yml` 10, `release.yml` 30, `codeql.yml`/`scorecard.yml` 20, `docs.yml` 15).
- The privileged `release.yml` `publish` job runs `step-security/harden-runner` for egress monitoring. It ships in `egress-policy: audit` with the candidate `allowed-endpoints` list commented inline; tightening to `egress-policy: block` happens only after reviewing a real run's network insights. Do not remove harden-runner from the OIDC-holding job.
- Releases publish through npm OIDC trusted publishing, not a stored npm token: the job asserts `npm >= 11.5.1`, sets `registry-url: https://registry.npmjs.org`, and runs `npm publish --access public --provenance`. Build provenance is attested with `actions/attest-build-provenance` and the signed bundle is attached to the release. Do not reintroduce a long-lived `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret.
- Runtime matrices match the support contract and must not silently narrow. `ci.yml` `quality` covers Node `[22, 24]` (the engines floor through the release major); `ci.yml` `check` covers PostgreSQL `[15, 16, 17]`; `check-os` covers macOS and Windows. Removing a supported Node major, Postgres major, or OS lane is a STOP condition.
- DB-independent gates and DB-dependent gates stay split. `quality` runs lint/typecheck/build/guard/package/benchmark/pack-smoke with no `postgres` service; `check` owns the database-backed replay-safety proofs (`npm test`, `fixture:verify`, `corpus:check`) behind the `postgres` service matrix. Do not move database-backed steps into the no-DB lane or vice versa.
- The `check-os` matrix runs the JS test suite on Windows and macOS, so any test or script that spawns npm tooling must resolve the executable cross-platform: prefer `process.env.npm_execpath` executed through `process.execPath`, then fall back to `npm.cmd` on Windows and `npm` elsewhere when that env var is absent (the helper shape used by `scripts/check-schema.mjs`, `tests/package-contents.test.ts`, and `tests/database-url.test.ts`). Do not call a hard-coded bare `npm` with `shell: false`, which raises `ENOENT` on Windows. Bash-only constructs (`$(mktemp -d)`, `&&` chains, `out=$VAR`) belong only in `run:` steps and npm scripts the `check-os` lane does not invoke (it runs `npm ci`, `npm run build`, `npm test`, `npm run fixture:diff`).
- Each `supaschema diff --out` render in a workflow writes to its own output subdirectory. supaschema treats the `--out` file's parent directory as the migrations dir for the lineage chain gate, so two renders sharing one directory — for example the `quality` lane's tarball smoke and examples smoke both writing into `$RUNNER_TEMP` — make the first render look like a pending migration the second must continue, a false `SUPA_DIFF_LINEAGE_BROKEN`. Give each render an isolated `--out` directory (supaschema auto-creates the parent).
- Concurrency is declared in each PR-facing workflow (`ci.yml`, `python.yml`, `dependency-review.yml`) as `group: "${{ github.workflow }}-${{ github.ref }}"` with `cancel-in-progress: true`, so superseded PR runs are cancelled. `release.yml` (a `release: published` trigger) is not cancel-on-new; do not add `cancel-in-progress` to the publish path.
- Path-filtered workflows (`python.yml`, `docs.yml`) gate on their owned trees plus their own workflow file and the lockfile inputs that affect them. These are independent advisory workflows, not required checks short-circuited by `paths-ignore`; do not convert a required gate (`ci.yml`) into a path-skipped check.
- The Python lane installs with `astral-sh/setup-uv` and `enable-cache: true`, and `uv sync --locked` is the lock-freshness gate (fails on `uv.lock` drift). Node lanes use `actions/setup-node` with `cache: npm`. Dependency caching is built into these actions; there is no external/remote build cache in this repo.
- Supply-chain scanning is layered and must stay wired: `npm audit signatures` (registry signature check) in `quality` and `release`, `actions/dependency-review-action` on PRs, `pip-audit` for the Python service, CodeQL static analysis, and OpenSSF Scorecard. Do not remove a scanner to make a run green.
- Dependabot (`.github/dependabot.yml`) keeps low-noise weekly updates across the three ecosystems (`npm`, `github-actions`, `pip` at `services/agent-mcp`) with grouped updates (dev-dependencies group for npm, single `*` group for pip). Keep the SHA-pinned-actions ecosystem enabled so action pins stay current.
- GitHub Actions / OIDC concepts that do not exist here must not be invented into the rule: there is no `turbo.json`, no `--affected` graph, no remote-cache token wiring, no scope-detection script, no `ci_monitor`, and no Render/Vercel deploy workflow. CI is the plain workflow set above.

## Enforced by

- `npm run guard` (`scripts/guards/check-all.mjs`) — repository invariants (tooling stack, agent surfaces, dependency catalog, Code Atlas, LSP coverage, no-regex-in-scripts), run inside `ci.yml`'s `quality` job.
- `npm run guard:ci` (`scripts/guards/check-ci-governance.mjs`, part of `npm run guard`) — parses every `.github/workflows/*.yml` with the `yaml` dependency (AST/structured walk, Rule 07) and asserts this rule's STOP invariants deterministically: top-level least-privilege permissions, full-SHA action pins, `actions/checkout` `persist-credentials: false`, no stored npm token, the release publish job's harden-runner + OIDC `id-token: write` + `npm publish --provenance`, concurrency `cancel-in-progress` on the PR-facing workflows (and not on `release.yml`), the Node/Postgres/OS matrix lanes, and the Python lane's `--package supaschema-agent-mcp` selector (Rule 04).
- `npm run lint:ci` (Biome `biome ci .`), `npm run typecheck`, `npm run build`, `npm run check:schema`, and `npm run check:package` — the static and packaging gates the `quality` matrix runs (lint/format ownership is Rule 08; toolchain is Rule 06; the npm package boundary is Rule 13).
- `npm test`, `npm run fixture:verify`, and `npm run corpus:check` — the database-backed replay-safety proofs the `check` matrix runs.
- The seven workflow files themselves under `.github/workflows/`, plus `.github/dependabot.yml`.
- `lefthook.yml` for local pre-commit hooks that mirror the lint/format gates before code reaches CI.

STOP if a workflow grants top-level write permissions, unpins an action from its full-length commit SHA, drops `persist-credentials: false` on a job that does not need persisted credentials, removes harden-runner from the OIDC publish job, replaces OIDC trusted publishing with a stored npm token, removes a supported Node/Postgres/OS matrix lane, moves database-backed proofs out of the `postgres`-service `check` job, removes concurrency cancellation from a PR-facing workflow, disables a supply-chain scanner (`npm audit signatures`, dependency-review, `pip-audit`, CodeQL, or Scorecard), moves a bash-only construct into a step or npm script the `check-os` (Windows/macOS) lane runs, or shares one `--out` directory across multiple `supaschema diff` renders in a workflow.

STOP if anyone reintroduces Turborepo / remote-cache / `--affected` / pnpm / Vercel / Render deploy machinery into the CI surface or into this rule: none of it exists in this single-package npm repo.
