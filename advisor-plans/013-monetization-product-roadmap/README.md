# Plan 013 Subplans: Monetization Proposal Execution Pack

Generated on 2026-06-16 against commit `fb8c461`.

This directory is the execution bundle for
`advisor-plans/013-monetization-product-roadmap.md`. Each subfolder contains one
self-contained proposal plan for a separate executor. The parent roadmap remains
the strategy owner; this folder owns the proposal-level execution handoffs.

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

## Shared Market Anchors

- Database automation: `$2.443B` expected in 2025 and `$8.0406B` by 2030.
- Application security testing: `$1.83B` in 2025 and `$7.60B` by 2031.
- AI code tools: `$7.37B` in 2025 and `$29.96B` by 2031.
- Compliance software: `$35.37B` in 2025 and `$74.12B` by 2031.
- Regulatory compliance management software: `$12.41B` in 2025 and `$19.8B`
  by 2030.
- eGRC: `$72.4B` in 2025 and `$203.7B` by 2033.

See the parent roadmap for source links and competitor pricing anchors.

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
