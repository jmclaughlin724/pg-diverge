# Plan 013 Subplans: Monetization Proposal Execution Pack

Generated on 2026-06-16 against commit `fb8c461`.

This directory is the execution bundle for
`advisor-plans/013-monetization-product-roadmap.md`. Folders `01`-`05` each
contain one self-contained proposal plan for a separate executor. Folders `06`
and `07` are cross-cutting: `06` owns the SEO/AEO/GEO marketing plan for all five
offers, and `07` owns market/pricing re-verification, client value-delivered
economics, and the meta-plan for executing the user's analysis items 1-5. The
parent roadmap remains the strategy owner; this folder owns the proposal-level
execution handoffs.

## Task-Creator Fallback Record

- Persistent task API: unavailable in this Codex session after tool discovery.
  This directory index is the durable fallback task system.
- Execution lens: compatibility-constrained.
- Elegant end state: one canonical execution folder per active monetization
  proposal; one shared index; no duplicated source implementation; no hosted,
  billing, license-key, telemetry, or customer-data path added by this planning
  task.
- Compatibility constraint: the repo already uses `advisor-plans/` as the
  improve-plan surface because root `plans/` is reserved. Keep the existing
  roadmap file and add subfolders beside it instead of moving the parent plan.
- Open assumptions: none (all validated).
- Resolved assumptions:
  - The active five proposals are commercial/OEM licensing, RLS/tenant-isolation
    review, agent database change-control review, adoption audit/rescue, and
    release/compliance evidence packs.
  - Private training and certification were removed from the active roadmap by
    user decision and are not represented as an executable proposal folder.
  - Code Atlas does not own `advisor-plans/013-monetization-product-roadmap.md`;
    the query returned "target not found" with no routes, APIs, workers,
    database surfaces, or packages affected.
  - The worktree contains unrelated dirty files outside `advisor-plans/`; they
    are excluded from this planning task.
  - The subplans are planning artifacts only. They do not implement source code,
    docs pages, billing, hosted services, legal terms, or support commitments.
- Scope ledger:
  - Plan-owned additions: this directory and its five proposal subfolders.
  - Plan-owned updates: the parent roadmap and `advisor-plans/README.md`.
  - Generated mirrors: none.
  - Migrations: none.
  - External rollout surfaces: none.
  - Excluded dirty surfaces: source, docs, scripts, workflow, package, and agent
    files that existed dirty before this task.
- Change inventory:
  - Add: `01-commercial-license-oem/README.md`.
  - Add: `02-rls-tenant-isolation-security-review/README.md`.
  - Add: `03-agent-database-change-control-review/README.md`.
  - Add: `04-adoption-audit-migration-rescue/README.md`.
  - Add: `05-release-compliance-evidence-packs/README.md`.
  - Update: `../013-monetization-product-roadmap.md` to link this bundle.
  - Update: `../README.md` to mention this bundle.
  - Remove: none.
  - Unchanged/excluded: all runtime source, package metadata, generated files,
    migrations, docs product pages, billing systems, hosted systems, and CI.
- Enforcement-surface ledger:
  - The parent roadmap is the canonical monetization strategy owner.
  - This directory is the canonical proposal execution owner.
  - Runtime enforcement is intentionally absent because no source behavior is
    changed.
  - Future implementation must add guards, tests, hooks, docs checks, or CI only
    inside the specific proposal plan that changes those surfaces.
- Placeholders / TODOs: none.
- Deferral budget: zero for this planning workstream. Every active proposal has
  a subfolder, a self-contained plan, scope boundaries, onboarding automation,
  value proposition, and validation gates.

## Execution Order

| Order | Proposal | Folder | Primary revenue model | Dependency |
| --- | --- | --- | --- | --- |
| 1 | Commercial license and OEM/private-build rights | `01-commercial-license-oem` | Annual license or OEM contract | none |
| 2 | RLS and tenant-isolation security review | `02-rls-tenant-isolation-security-review` | Fixed review, then policy-pack subscription | none |
| 3 | Agent database change-control review | `03-agent-database-change-control-review` | Fixed review, then governance subscription | none |
| 4 | Adoption audit and migration rescue | `04-adoption-audit-migration-rescue` | Fixed assessment, rescue package, retainer | none |
| 5 | Release and compliance evidence packs | `05-release-compliance-evidence-packs` | Per-release pack, then annual evidence cadence | none |

The five proposal plans are commercially independent. Execute the commercial
license plan first if public sales copy will mention proprietary embedding or
hosted redistribution. Execute the evidence pack plan before any hosted
retention or auditor portal work.

## 2026-06-16 Addendum: Marketing And Verification Folders

Added 2026-06-16 to close the gaps a re-review against the user's seven analysis
items exposed. Senior-advisor disposition: items 2 (automation/onboarding +
per-user-type value), 3 (actionable pain points), and 5 (per-offer gaps and
rollout steps) were already well-covered in folders `01`-`05` and the parent
roadmap, and were not rewritten. The genuine gaps were market-data verification,
client value-delivered economics, the entire SEO/AEO/GEO plan, and a meta-plan
for executing items 1-5. Two cross-cutting folders own those:

| Folder | Owns | Maps to user items |
| --- | --- | --- |
| `06-seo-aeo-geo-marketing` | SEO/AEO/GEO plan, llms.txt + structured data, per-offer keyword/content targeting, comparison pages, distribution channels, build order, measurement | 4 (plus marketing-lens 2/3) |
| `07-market-and-value-verification` | Re-verified market sizes + competitor pricing with confidence flags, client value-delivered/ROI per offer, bottom-up SAM framework, cross-proposal gap rollup, corrections for the parent roadmap, and the steps to implement items 1-5 | 1, 5, 6, 7 |

Both folders were upstream-verified on 2026-06-16 via parallel research agents
(market/pricing/cost-of-pain; SEO/AEO/GEO best practices; keyword and competitor
landscape). All sourced figures carry confidence levels; LOW-confidence numbers
must not reach buyer-facing copy.

Folder `07` Section 1 is the canonical owner of the corrections list (Supabase
developer count, stale Liquibase/Flyway prices, demoted compliance anchors).
Those corrections are applied to the parent roadmap. Folder `07` Section 3 is the
single owner of the client value-delivered economics; the proposal folders
reference it rather than copy it, so the avoided-loss figures stay in one place.

## Shared Market Anchors

Market sizes and competitor pricing have one canonical, confidence-flagged owner:
`07-market-and-value-verification/` Sections 1 and 2. Do not restate raw figures
here or in proposal copy — read them from folder `07`, which carries the
order-of-magnitude caveat, the firm-to-firm spread, and the "directional only"
demotion of the compliance-software and regulatory-compliance anchors. eGRC
(`~$70-72B`, corroborated) is the lead compliance anchor. Client value-delivered
(cost-of-pain avoided) is owned by folder `07` Section 3.

## Upstream Verification Addendum

Verified on 2026-06-16 against upstream vendor, standards, and project docs.
The proposal folders now include upstream requirements that affect rollout
scope, validation, and monetization readiness.

- PostgreSQL RLS rollout must account for default-deny behavior, `USING` and
  `WITH CHECK` semantics, permissive versus restrictive policy combination,
  owner and `BYPASSRLS` bypass behavior, `FORCE ROW LEVEL SECURITY`, and
  `ALTER POLICY` limits.
- Commercial distribution must account for npm package publishing hygiene,
  SemVer public API commitments, GitHub issue form mechanics, GitHub
  Marketplace paid-app requirements, AWS Marketplace SaaS entitlement or
  metering requirements, and Stripe quote or invoice paths.
- Agent governance must remain local until auth, token custody, transcript
  retention, actor identity, and provenance evidence are designed.
- Adoption and rescue work must treat database dumps as diagnostic inputs, not
  backups or trusted executable artifacts, and must account for globals, roles,
  and restore safety.
- Evidence packs must distinguish internal control evidence from certification,
  validate any SARIF output against GitHub's supported SARIF subset, and treat
  hashes as insufficient unless signer identity, provenance, and verification
  behavior are defined.

## Automation-First Execution Principle

The five proposals should not scale through manual consulting workflows.
Manual work is allowed only as an approval gate, exception review, or early
validation loop. The default implementation path is:

1. A local command, script, GitHub Action, or agent workflow collects inputs.
2. A deterministic validator rejects secrets, missing scope, and unsupported
   states.
3. A classifier or rule engine produces structured findings.
4. An AI agent drafts customer-facing summaries, remediation plans, quotes, or
   issue payloads from structured data only.
5. A human approves legal terms, prices, destructive operations, or customer
   commitments.
6. The workflow writes reproducible artifacts that can be re-run in CI.

Shared automation primitives to build once and reuse:

- intake JSON schemas.
- secret redaction and forbidden-field validation.
- local evidence collector.
- report manifest and Markdown renderer.
- agent prompt templates that consume structured JSON.
- GitHub Action wrappers.
- waiver and approval metadata.
- customer-safe export bundles.

## Executor Readiness Contract

Read this before executing any proposal `01`-`05`. A fresh-context readiness audit
(2026-06-16) found that the proposal "Automation-First Workflow" sections describe
**target state**, not runnable steps, and that several new surfaces were written
in imperative voice without being marked as work to create. This contract removes
that ambiguity for every plan; the per-plan body is read through it.

1. **Plan altitude.** Each proposal is a direction + first-wave plan, not a
   line-by-line build spec. The "Implementation Waves" sections are the build
   order; the "Automation-First Workflow" sections are the target design.

2. **New surfaces are TO CREATE.** Any `supaschema <command>` or `scripts/<path>`
   named in a plan that is not in the existing CLI surface does not exist yet.
   The existing CLI commands are: `audit`, `check`, `completion`, `config`,
   `corpus`, `diff`, `doctor`, `explain`, `fingerprint`, `init`, `inspect`,
   `migrations`, `plan`, `selfcheck`, `sync`, `types`, `validate`, `verify`.
   Everything else a plan names (`rls *`, `check --pack`, `agents doctor`,
   `onboard *`, `evidence *`, `scripts/commercial/*`) is net-new. Do not try to
   run it; build it.

3. **CLI registration reality.** New commands are wired in `src/cli.ts` and
   registered through `src/cli-tools.ts` (operational/tool commands) or
   `src/cli-reports.ts` (report commands) — not invented in a bare file. A new
   command group (e.g. `agents`, `onboard`, `rls`, `evidence`) should add its own
   `src/cli-<group>.ts` module and register it where the existing groups do.

4. **Phase 0 design spec is the first executable step for every net-new surface.**
   Before writing feature code, produce a short design spec naming: the target
   module path, the CLI registration point, the input/output JSON schema (field
   names + types + required/optional), the exit-code contract, and the
   to-create test file. A zero-context agent CAN execute "write the Phase 0 spec";
   it cannot execute "build `onboard scan`" from intent alone. Treat any plan
   step that only states intent ("define the score," "detect the migration
   system") as Phase 0 spec work, and route genuine product/pricing/legal choices
   to the plan's Stop Conditions.

5. **Done criteria must be machine-checkable.** Where a plan states a done
   criterion as prose ("a release can produce one evidence packet"), the
   executor converts it to a command + expected output before that wave is done,
   using the Shared Commands below plus a named to-create test
   (`npm test -- tests/<name>.test.ts` → exit 0). Prose alone does not close a
   wave.

6. **Reuse canonical owners; never fork.** Reporters live in
   `src/check-reporters.ts`; the model lives in `src/core.ts` (`SchemaModel`,
   `MigrationPlan`); diagnostics flow through the existing reporter set. Extend
   these — a parallel scanner, reporter, or policy engine is a Shared Stop
   Condition violation.

## Shared Commands

Use these commands when a proposal moves from plan to implementation:

| Purpose | Command | Expected result |
| --- | --- | --- |
| Drift check | `git diff --stat fb8c461..HEAD -- <in-scope paths>` | Review any changed in-scope path before editing |
| Docs lint | `npm run docs:lint` | exit 0 |
| Docs check | `npm run docs:check` | exit 0 |
| Package boundary | `npm test -- tests/package-contents.test.ts` | exit 0 when package files or metadata change |
| Agent hooks | `npm test -- tests/agent-hooks.test.ts` | exit 0 when agent governance hooks or docs change |
| Typecheck | `npm run typecheck` | exit 0 when source changes |
| Full tests | `npm test` | exit 0 for broad source changes |

Planning-only edits under this directory require:

- `git diff --check -- advisor-plans/013-monetization-product-roadmap
  advisor-plans/013-monetization-product-roadmap.md advisor-plans/README.md`
- a section-presence check for every proposal README.
- `git status --short -- advisor-plans/013-monetization-product-roadmap
  advisor-plans/013-monetization-product-roadmap.md advisor-plans/README.md`

## Shared Stop Conditions

Stop before implementation if:

- The change would add telemetry, license keys, billing SDKs, hosted scans, or
  customer-data storage to the local CLI.
- The implementation asks customers to paste secrets, production database URLs,
  service-role keys, or private schema dumps into public issues.
- The implementation publishes fixed prices, SLA terms, warranty language, or
  license grants without explicit approval.
- The implementation creates duplicate scanners, report renderers, policy
  engines, or onboarding artifacts instead of extending the canonical owners.
- The implementation needs a hosted tenant, retention, deletion, or secret
  custody model and that model is not approved.

## Proposal Folder Contract

Each proposal folder includes:

- value proposition by user type.
- actionable pain points.
- market size, SAM estimate, client value, and revenue model.
- onboarding automation requirements.
- upstream verification notes.
- automation-first workflow.
- full rollout gaps, missing features, and implementation steps.
- implementation waves.
- exact scope boundaries.
- validation gates.
- stop conditions.
