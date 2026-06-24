---
description: GitHub Actions CI/CD efficiency, release governance, supply-chain hardening, and npm trusted publishing.
---

# Rule 09 — CI/CD efficiency and release governance

## Contract

This rule owns workflow posture for CI, release, docs, Python, supply-chain checks, CodeQL, Scorecard, dependency review, release provenance, and npm trusted publishing.

Sources:

- GitHub Actions workflow syntax: <https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions>
- GitHub Actions environments: <https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment>
- GitHub Actions secure use (security hardening): <https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub Actions security hardening for OIDC: <https://docs.github.com/en/actions/concepts/security/openid-connect>
- Artifact attestations / build provenance: <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>
- npm trusted publishing (OIDC): <https://docs.npmjs.com/trusted-publishers>
- GitHub CLI release creation: <https://cli.github.com/manual/gh_release_create>
- GitHub CodeQL workflow configuration: <https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options>
- CodeQL Action build modes and dependency setup: <https://github.com/github/codeql-action>
- OpenSSF Scorecard checks: <https://github.com/ossf/scorecard/blob/main/docs/checks.md>
- step-security/harden-runner: <https://github.com/step-security/harden-runner>
- actions/dependency-review-action: <https://github.com/actions/dependency-review-action>
- astral-sh/setup-uv: <https://github.com/astral-sh/setup-uv>

This repo is a single-package npm TypeScript CLI/library with private local Python/FastMCP maintainer tooling (`services/agent-mcp`) and a Mintlify docs site (`docs/`). There is no public Python service, Turborepo, maintainer pnpm/Yarn/Bun lockfile, repo workspace, `apps/`, or Vercel/Render web/API/worker deployment. CI may use alternate package managers only inside the isolated package-smoke lane owned by Rule 13. CI must stay high-signal and supply-chain-hardened: least-privilege tokens, immutable action pins, matrix coverage for every supported public runtime, and a release path that publishes via OIDC trusted publishing with build provenance. Runtime/library command behavior and the canonical script list live in `AGENTS.md`; this rule owns the CI/CD posture, not the package scripts.

## Workflow map

The complete public CI surface is the six tracked workflows under `.github/workflows/`:

- `ci.yml` — the pull-request and `main`-push gate. Three jobs:
  - `quality` (matrix `node-version: [22, 24]`, no database): `npm ci`, `npm audit signatures`, `npm run build`, `npm run lint:ci` (Biome `biome ci .`), `npm run typecheck`, `npm run guard`, `npm run check:schema`, `npm run check:package`, then packs the tarball and smoke-tests `npx supaschema --version|diff|check`. On Node 22 only, CI prepares the alternate consumer package managers required by Rule 13, runs `npm run package:smoke`, and runs the shipped `examples/` render+check plus `npm run test:examples`.
  - `check` (matrix `postgres: [15, 16, 17]` via a `postgres` service container): `npm run test:matrix`, coverage + Codecov upload through `npm run test:matrix:coverage` on `postgres == 17`, `npm run fixture:diff`, `npm run fixture:verify`, and `npm run corpus:check` — the replay-safety and reconvergence proofs that need a live database. `test:matrix*` excludes the examples lane owned by `quality`.
  - `check-os` (matrix `os: [macos-latest, windows-latest]`, no database): cross-platform path/git handling via `npm run test:matrix`; DB-gated test cases skip when no database is present, and example failures stay in `quality`.
- `release.yml` — triggered directly by `push` to `main`, with a main-only `workflow_dispatch` recovery path. It queues publishes with `concurrency.group: release-npm` + `queue: max`, runs in the `release` environment on a single GitHub-hosted Ubuntu Node 24 lane with no database service, checks out `github.sha`, runs release preflight before install, builds and package-checks only when npm publish is needed, packs the already-built tarball with lifecycle scripts disabled, smokes that exact tarball, publishes that exact tarball to npm with OIDC provenance, attests the tarball with `actions/attest@v4`, and creates or repairs the GitHub Release/tag for the same version using the top `CHANGELOG.md` entry as the release body. Already-complete versions exit successfully as an idempotent no-op. Registry smoke remains an operator command, not a release workflow gate. It holds `contents: write`, `id-token: write`, and `attestations: write` on the publish job only.
- `dependency-review.yml` — pull-request supply-chain gate (`actions/dependency-review-action`): blocks high-severity vulnerable deps and license-incompatible deps (copyleft deny-list keyed to the dual-license model).
- `codeql.yml` — CodeQL static analysis matrix (`actions`, `javascript-typescript`) with the `security-and-quality` query suite and explicit no-build mode, on push/PR to `main` and a weekly schedule. These lanes have no dependency install.
- `scorecard.yml` — OpenSSF Scorecard on `main` push + weekly schedule, uploading SARIF.
- `docs.yml` — path-filtered (`docs/**`, `package.json`, `package-lock.json`, the workflow itself) Mintlify validation via `npm run docs:check`.

## Hard rules

- Every workflow declares a top-level least-privilege `permissions:` block, defaulting to `contents: read` (or `read-all`). A job elevates only the exact scopes it needs: `release.yml`'s `publish` job adds `contents: write` for GitHub Release/tag creation plus `id-token: write` and `attestations: write` for trusted publishing/provenance; `codeql.yml`/`scorecard.yml` add `security-events: write` (+ `id-token: write` for Scorecard). Never grant write at the top level.
- All `uses:` refs are pinned to full-length commit SHAs with an adjacent version comment (for example `# v6.0.3`) for Dependabot readability. The executable ref must be immutable — never a tag or branch. This is the OpenSSF Scorecard "Pinned-Dependencies" check and a STOP condition if violated.
- `actions/checkout` uses `persist-credentials: false` on every tracked workflow's checkout (`ci.yml`, `dependency-review.yml`, `scorecard.yml`, `release.yml`, `codeql.yml`, `docs.yml`); release re-supplies an explicit `GH_TOKEN`/`registry-url` only where a step needs it.
- Every job declares a `timeout-minutes` ceiling so no lane can hang at the 360-minute default — least of all the privileged `release.yml` `publish` job (`ci.yml` 20/30/20, `dependency-review.yml` 10, `release.yml` 30, `codeql.yml`/`scorecard.yml` 20, `docs.yml` 15).
- The privileged `release.yml` `publish` job runs `step-security/harden-runner` for egress monitoring. It ships in `egress-policy: audit` with the candidate `allowed-endpoints` list commented inline; tightening to `egress-policy: block` happens only after reviewing a real run's network insights. Do not remove harden-runner from the OIDC-holding job.
- Releases publish through npm OIDC trusted publishing, not a stored npm token: the job runs on a GitHub-hosted runner with Node 24, asserts `npm >= 11.5.1`, sets `registry-url: https://registry.npmjs.org`, disables package-manager caching on the privileged publish path, and runs `npm publish "$SUPASCHEMA_TARBALL" --access public --provenance`. npm trusted publishing already generates provenance; `--provenance` remains explicit repo policy. Tarball provenance is attested with `actions/attest@v4`. Do not reintroduce a long-lived `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret.
- `main` is the npm and GitHub release source. `release.yml` must not publish from GitHub Release events or `workflow_run` because release must not wait on the full CI workflow. It publishes from direct `push` to `main`, with manual dispatch limited to `refs/heads/main`. The preflight script must fail closed when `package.json`, `package-lock.json`, the lockfile root package version, or the top `CHANGELOG.md` release entry disagree; when a GitHub Release exists but npm is missing; or when an existing GitHub tag points away from the release commit. Same-version reruns are idempotent: if npm exists and the GitHub Release exists, the workflow exits cleanly; if npm exists and the GitHub Release is missing, the workflow repairs the GitHub Release from `CHANGELOG.md` without republishing npm.
- Runtime matrices match the support contract and must not silently narrow. `ci.yml` `quality` covers Node `[22, 24]` (the engines floor through the release major); `ci.yml` `check` covers PostgreSQL `[15, 16, 17]`; `check-os` covers macOS and Windows. Removing a supported Node major, Postgres major, or OS lane is a STOP condition.
- DB-independent gates and DB-dependent gates stay split. `quality` runs lint/typecheck/build/guard/package/pack-smoke with no `postgres` service and owns the single examples lane on Node 22. `check` owns the database-backed replay-safety proofs (`test:matrix`, `test:matrix:coverage`, `fixture:verify`, `corpus:check`) behind the `postgres` service matrix. Do not move database-backed steps into the no-DB lane or duplicate example tests across DB/OS matrix axes.
- Consumer package-manager smoke is allowed only inside `npm run package:smoke` and the matching Node 22 `quality` workflow steps. It may create throwaway consumer projects under temporary directories, but it must not introduce repo-root alternate lockfiles, workspaces, or maintainer install commands.
- Benchmarks are advisory, not CI or release gates. Keep `npm run benchmark` available for local/manual performance investigation, but do not run it from `ci.yml`, `release.yml`, or another required workflow path.
- The `check-os` matrix runs `npm run test:matrix` on Windows and macOS, so any test or script in that lane that spawns npm tooling must resolve the executable cross-platform: prefer `process.env.npm_execpath` executed through `process.execPath`, then fall back to `npm.cmd` on Windows and `npm` elsewhere when that env var is absent (the helper shape used by `scripts/guards/docs-config/check-schema.mjs`, `tests/package-contents.test.ts`, and `tests/database-url.test.ts`). Do not call a hard-coded bare `npm` with `shell: false`, which raises `ENOENT` on Windows. Bash-only constructs (`$(mktemp -d)`, `&&` chains, `out=$VAR`) belong only in `run:` steps and npm scripts the `check-os` lane does not invoke (it runs `npm ci`, `npm run build`, `npm run test:matrix`, `npm run fixture:diff`).
- Each `supaschema diff --out` render in a workflow writes to its own output subdirectory. supaschema treats the `--out` file's parent directory as the migrations dir for the lineage chain gate, so two renders sharing one directory — for example the `quality` lane's tarball smoke and examples smoke both writing into `$RUNNER_TEMP` — make the first render look like a pending migration the second must continue, a false `SUPA_DIFF_LINEAGE_BROKEN`. Give each render an isolated `--out` directory (supaschema auto-creates the parent).
- Concurrency is declared in each PR-facing workflow (`ci.yml`, `dependency-review.yml`) as `group: "${{ github.workflow }}-${{ github.ref }}"` with `cancel-in-progress: true`, so superseded PR runs are cancelled. `release.yml` is not cancel-on-new; it uses `group: release-npm` with `queue: max` and must never set `cancel-in-progress: true` on the publish path.
- Path-filtered workflows (`docs.yml`) gate on their owned trees plus their own workflow file and the lockfile inputs that affect them. These are independent advisory workflows, not required checks short-circuited by `paths-ignore`; do not convert a required gate (`ci.yml`) into a path-skipped check.
- CI/docs Node lanes use `actions/setup-node` with npm caching where appropriate; the privileged release job disables package-manager caching to avoid unnecessary package-manager side effects on the OIDC publish path. There is no external/remote build cache in this repo.
- CodeQL MUST cover `actions` and `javascript-typescript`, use `queries: security-and-quality`, and use no-build analysis for these interpreted/action languages. Do not use the deprecated CodeQL dependency installer input.
- Supply-chain scanning is layered and must stay wired: `npm audit signatures` (registry signature check) in `quality` and `release`, `actions/dependency-review-action` on PRs, CodeQL static analysis, and OpenSSF Scorecard. Do not remove a public scanner to make a run green.
- Commit signoff enforcement MUST NOT be wired into CI quality jobs unless Rule 21 first records an explicitly approved contributor-certificate policy.
- Dependabot (`.github/dependabot.yml`) keeps low-noise weekly updates across the public ecosystems (`npm`, `github-actions`) with grouped updates for npm dev dependencies. Keep the SHA-pinned-actions ecosystem enabled so action pins stay current.
- GitHub Actions / OIDC concepts that do not exist here must not be invented into the rule: there is no `turbo.json`, no `--affected` graph, no remote-cache token wiring, no scope-detection script, no `ci_monitor`, and no Render/Vercel deploy workflow. CI is the plain workflow set above.

## Enforced by

- `npm run guard` (`scripts/guards/check-all.mjs`) — repository invariants (tooling stack, canonical surfaces, agent surfaces, dependency catalog, Code Atlas, LSP coverage), run inside `ci.yml`'s `quality` job. Public guard scans over agents, skills, rules, and policy files MUST derive their file lists from `git ls-files --cached`, not raw filesystem directory walks, so ignored local DX cannot satisfy or break CI-only requirements. It MUST run a second targeted public-checkout pass for local-only maintainer surfaces with `SUPASCHEMA_PUBLIC_CHECKOUT=1` and emit `PUBLIC_CHECKOUT_GUARDS_OK`, so ignored local files cannot mask clean GitHub checkout failures.
- `npm run guard:ci` (`scripts/guards/ci-release/check-ci-governance.mjs`, part of `npm run guard`) — parses every tracked `.github/workflows/*.yml` with the `yaml` dependency (AST/structured walk, Rule 07) and asserts this rule's STOP invariants deterministically: top-level least-privilege permissions, full-SHA action pins, `actions/checkout` `persist-credentials: false`, no stored npm token, the release workflow's direct `push` trigger on `main`, no `workflow_run` release dependency, main-scoped manual dispatch, queued non-canceling publish concurrency, GitHub-hosted Ubuntu Node 24 trusted-publishing lane, harden-runner + OIDC `id-token: write` + `npm publish "$SUPASCHEMA_TARBALL" --access public --provenance`, `actions/attest@v4` ordered after npm publish, GitHub Release/tag creation from `scripts/release/changelog-notes.mjs` with `--notes-file`, exact `github.sha` checkout, release preflight outputs for dynamic publish/release conditionals, no database service or benchmark on the publish job, no benchmark gate in `ci.yml`, the Node/Postgres/OS matrix lanes, the single-owner examples lane, matrix-focused test scripts, the CodeQL `actions`/`javascript-typescript` matrix, and the requirement that `python.yml` stay private with the FastMCP service.
- `npm run lint:ci` (Biome `biome ci .`), `npm run typecheck`, `npm run build`, `npm run check:schema`, `npm run check:package`, and `npm run package:smoke` — the static and packaging gates the `quality` matrix runs (lint/format ownership is Rule 08; toolchain is Rule 06; the npm package boundary is Rule 13).
- `npm run test:matrix`, `npm run test:matrix:coverage`, `npm run fixture:verify`, and `npm run corpus:check` — the database-backed replay-safety proofs the `check` matrix runs.
- The six workflow files themselves under `.github/workflows/`, plus `.github/dependabot.yml`.
- `lefthook.yml` for local pre-commit hooks that mirror the lint/format gates before code reaches CI.

STOP if a tracked workflow grants top-level write permissions, unpins an action from its full-length commit SHA, drops `persist-credentials: false` on a job that does not need persisted credentials, removes harden-runner from the OIDC publish job, replaces OIDC trusted publishing with a stored npm token, moves the publish job off GitHub-hosted Ubuntu/Node 24 or drops the npm `>=11.5.1` assertion, drops `actions/attest@v4`, publishes from GitHub Release events or waits for `workflow_run`, lets a non-main manual dispatch publish, drops the release version preflight, publishes anything other than the smoked tarball, drops GitHub Release/tag creation, creates a GitHub Release with auto-generated notes instead of the extracted `CHANGELOG.md` entry, uploads extra GitHub Release artifacts, runs benchmarks in a required CI/release workflow, removes a supported Node/Postgres/OS matrix lane, drops a public CodeQL language lane (`actions`, `javascript-typescript`), makes `python.yml` public while `services/agent-mcp` stays private, moves database-backed proofs out of the `postgres`-service `check` job, duplicates examples tests across DB or OS matrix axes, removes concurrency cancellation from a PR-facing workflow, disables a public supply-chain scanner (`npm audit signatures`, dependency-review, CodeQL, or Scorecard), moves a bash-only construct into a step or npm script the `check-os` (Windows/macOS) lane runs, or shares one `--out` directory across multiple `supaschema diff` renders in a workflow.

STOP if anyone reintroduces Turborepo / remote-cache / `--affected` / maintainer pnpm/Yarn/Bun install workflows / Vercel / Render deploy machinery into the CI surface or into this rule. The isolated package-smoke lane is the only CI exception for alternate package managers.

## Verification

After workflow, release, supply-chain, matrix, package, or CI guard changes, run:

```bash
npm run guard:ci
npm run guard
```

For package-release changes, also run `npm run release:verify`.

## Failure behavior

Fix the workflow or guard. Do not remove scanners, narrow required matrices, unpin actions, introduce stored npm tokens, weaken OIDC/provenance, or move database proofs into release to make CI faster.

## Done means

Workflow permissions are least-privilege, actions are full-SHA pinned, release remains main/OIDC/provenance based, matrices match support, and CI guards prove the posture.
