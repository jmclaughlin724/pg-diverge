# Plan 012: Monetization funnel, hosted CI policy design, agent governance support, and adoption audit services

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fb8c461..HEAD -- README.md LICENSE-COMMERCIAL.md docs action.yml bin/scaffold.mjs .agents/prompts/supaschema-install.md .claude/skills/supaschema/SKILL.md advisor-plans/README.md` - if any of these surfaces changed materially, compare the current state below against the live files before editing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction / monetization
- **Planned at**: commit `fb8c461`, 2026-06-16

## Purpose

Create the first monetization execution handoff for revenue opportunities 1-4:

1. Commercial license and OEM/private-build intake.
2. Hosted CI policy and release evidence design.
3. Agent database change-control governance support.
4. Adoption audit and migration rescue services.

This plan is a proposal and execution handoff. It does not implement billing, hosted infrastructure, license enforcement, legal terms, support SLAs, customer-data storage, or marketplace purchase handling.

## Current state

- `package.json` declares `AGPL-3.0-only`.
- `README.md` and `LICENSE-COMMERCIAL.md` describe a commercial licensing path, but pricing, terms, and sales workflow are not productized.
- `action.yml` wraps `npx supaschema` for GitHub Actions, but there is no hosted CI control plane, account model, installation-token storage, or billing meter.
- `.agents/prompts/supaschema-install.md`, `.claude/skills/supaschema/SKILL.md`, `.claude/settings.json`, and `.codex/hooks.json` already provide install guidance and generated-migration guardrails for AI coding agents.
- `src/audit.ts`, `src/doctor.ts`, `src/verify.ts`, `src/migrations-status.ts`, `src/check-reporters.ts`, and `src/catalog.ts` already provide the evidence needed for paid audits, rescue work, and release readiness reports.
- `advisor-plans/013-monetization-product-roadmap.md` expands this plan into a broader product roadmap and proposal bundle. Plan 013 depends on this file as the first monetization handoff.

## Scope

In scope:

- Clarify the public inquiry path for commercial licensing and proprietary embedding.
- Design the hosted CI policy product without building hosted infrastructure.
- Package agent database change-control support as a paid review service.
- Package adoption audit and migration rescue as a paid service.
- Add docs or README copy only where it routes prospects to existing contact or issue channels.

Out of scope:

- Billing provider integration.
- License keys or entitlement checks.
- Hosted database runners.
- GitHub App implementation.
- Marketplace submission.
- Customer telemetry or report retention.
- Legal-term drafting beyond marking where maintainer/legal approval is required.

## STOP conditions

- The change would alter the package license metadata or legal terms without maintainer approval.
- The change would add hosted infrastructure, billing SDKs, telemetry, customer-data storage, or license enforcement.
- The change would publish exact pricing before legal, tax, support, and procurement terms are approved.
- The change would expose service-role credentials, customer database URLs, or private report data.

## Revenue lane 1: Commercial license and OEM/private-build intake

Goal: make the existing commercial-license path easy to discover and qualify.

Steps:

1. Inspect `README.md`, `LICENSE-COMMERCIAL.md`, `package.json`, and docs navigation.
2. Add or update concise copy that points proprietary embedding, hosted redistribution, OEM, and private-build prospects to the approved contact path.
3. Keep all exact legal terms in `LICENSE-COMMERCIAL.md` or maintainer-owned legal material. Do not invent legal rights in marketing copy.
4. Add an intake checklist for maintainers: intended use, redistribution scope, support needs, private build needs, and procurement channel.

Acceptance:

- A prospect can find the commercial-license path from the README.
- The copy does not contradict `package.json` or `LICENSE-COMMERCIAL.md`.
- No exact price is published.

## Revenue lane 2: Hosted CI policy and release evidence design

Goal: define the paid hosted-CI direction without implementing the hosted product.

Steps:

1. Inventory existing local evidence: `check`, `verify`, `audit`, `doctor`, `migrations status`, SARIF, JSON, fingerprints, lineage, and GitHub annotations.
2. Draft the hosted product boundary: policy packs, release evidence, report retention, organization settings, and support tier.
3. Identify implementation prerequisites: account model, tenant isolation, GitHub App installation handling, runner isolation, secret custody, billing, deletion workflow, and audit logs.
4. Keep the local CLI free path intact.

Acceptance:

- The design distinguishes current local proof from future hosted retention/control-plane work.
- The first paid motion can be a manual evidence pack or services engagement.
- No hosted claim is made before the product exists.

## Revenue lane 3: Agent database change-control governance support

Goal: turn the existing agent bundle into a paid review and hardening service.

Steps:

1. Inspect `.agents/prompts/supaschema-install.md`, `.claude/skills/supaschema/SKILL.md`, `.claude/settings.json`, `.codex/hooks.json`, `bin/scaffold.mjs`, and docs under `docs/coding-agents*`.
2. Define a review deliverable for teams using Codex, Claude Code, Cursor, or similar coding agents on database-backed projects.
3. Include checks for generated migration protection, schema-source ownership, agent install drift, hook parity, and CI guard coverage.
4. Produce a support checklist: repository type, database provider, migration source of truth, agent tools in use, CI provider, and required approval gates.

Acceptance:

- The service can be delivered using current repo capabilities and a manual report.
- The deliverable preserves the existing agent install and generated-migration guard model.
- Any future org-wide policy sync is clearly marked future work.

## Revenue lane 4: Adoption audit and migration rescue

Goal: package the current diagnostic commands into a paid assessment and rescue motion.

Steps:

1. Inventory the current commands and reports that support adoption work: `audit`, `doctor`, `inspect`, `fingerprint`, `migrations status`, `check`, and `verify`.
2. Define assessment inputs: schema tree, migrations directory, database URL handling policy, provider, CI logs, failed migration output, and generated type drift.
3. Define outputs: risk summary, blocked migration list, drift evidence, recovery plan, guard recommendations, and follow-up implementation scope.
4. Keep destructive migration application out of the default service. Require explicit approval before any `sync --local` or `sync --remote` work.

Acceptance:

- A maintainer can run the service as a manual engagement without platform code.
- The engagement states which commands produce evidence and which actions require approval.
- The service funnels repeatable checks back into docs, guards, or future product work.

## Verification

Run:

```bash
git diff --check -- README.md LICENSE-COMMERCIAL.md docs action.yml bin/scaffold.mjs .agents/prompts/supaschema-install.md .claude/skills/supaschema/SKILL.md advisor-plans
npm run docs:lint
npm run guard
```

If only this plan file changes, `git diff --check -- advisor-plans` and `npm run guard` are sufficient.

## Done means

- `advisor-plans/README.md` points to a real plan 012 handoff.
- Plan 013 can depend on plan 012 without a missing-file gap.
- No legal, billing, hosted, telemetry, or destructive migration behavior was implemented by accident.
- Verification commands pass or the blocker is documented.
