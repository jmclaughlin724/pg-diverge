# Proposal 02: RLS And Tenant-Isolation Security Review

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: Follow this plan step by step. Start as a local, secret-safe review and only productize repeated findings into policy-pack checks. Do not add hosted scanning or customer-data storage.

> Drift check: `git diff --stat fb8c461..HEAD -- src/core.ts src/sql/extract.ts src/sql/facts.ts src/catalog.ts src/check.ts src/check-reporters.ts src/config-contract.ts src/cli.ts docs/guides/rls-policy-migration-safety.mdx tests advisor-plans/013-monetization-product-roadmap/02-rls-tenant-isolation-security-review`

> Before executing: read the **Executor Readiness Contract** in `../README.md`. The `supaschema rls *` commands and `check --pack rls` named below DO NOT EXIST yet — they are TO CREATE. Write the Phase 0 design spec (new `src/cli-rls.ts` registered via `src/cli-tools.ts`; the rule-engine module over `SchemaModel` / `MigrationPlan` in `src/core.ts` emitting diagnostics through `src/check-reporters.ts`; per-rule detection predicates; named to-create tests) before building, and convert prose done criteria to command + expected output.

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: security / monetization
- Execution lens: elegant canonical-owner execution.
- Protected invariant: RLS is a tenant-isolation surface. Fail closed and keep migration behavior unchanged unless rule diagnostics prove the change.

## Why This Matters

Postgres RLS is application security, but migration tools often treat policies as opaque SQL. Supaschema already models RLS and policies as schema objects. That makes tenant isolation a defensible paid review and a clear path to a reusable policy pack.

## User Types And Value Proposition

| User type | Trigger | Value proposition |
| --- | --- | --- |
| AppSec engineer | Needs tenant-isolation proof before release | Turns RLS into reviewable, reportable security evidence |
| Supabase founder/team | Uses RLS as the application authorization layer | Finds missing RLS and dangerous policy changes before deploy |
| Platform engineer | Owns CI checks across services | Adds policy diagnostics to existing local and GitHub reporters |
| Compliance owner | Needs control evidence around data access | Creates durable proof that tenant policies were reviewed |

## Actionable Pain Points

- RLS coverage is invisible in normal migration review.
- Policy bodies are hard to diff and easy to weaken.
- Tenant predicates drift across tables.
- Permissive policies can slip into PRs.
- AppSec review often happens after deployment.
- SARIF output lacks Postgres policy context.

## Market And Client Value

- Public TAM anchor: application security testing, `$1.83B` in 2025 and `$7.60B` by 2031.
- Supaschema SAM estimate: `0.5%-2%` Postgres/Supabase tenant-isolation wedge, or about `$9M-$37M` current annual spend.
- Client value:
  - `$5k-$15k` one-time RLS review.
  - `$10k-$60k/year` for recurring RLS policy-pack subscription or quarterly reviews.
- First-24-month opportunity: `15-50` reviews or subscriptions at `$7.5k-$30k` ACV produces `$112k-$1.5M`.

## Revenue Generation Model

- Start with fixed-scope security reviews.
- Convert repeated findings into a paid RLS policy pack.
- Meter subscriptions by protected repo/project, active schema contributors, and policy-pack support.
- Add hosted org policy only after local rule-pack demand is proven.

## Current State Evidence

- `src/core.ts` includes `rls` and `policy` object kinds.
- `src/sql/extract.ts` extracts `CreatePolicyStmt`.
- `src/catalog.ts` reads live RLS and `pg_policies`.
- `src/sql/facts.ts` and `src/sql/canonical-nodes.ts` support stable policy body facts.
- `src/check-reporters.ts` already renders GitHub, SARIF, JSON, and text reports.
- `docs/guides/rls-policy-migration-safety.mdx` already establishes the user education surface.

## Upstream Verification Notes

- PostgreSQL RLS policies only apply when row security is enabled on the table. When RLS is enabled and no applicable policy exists, access is denied by default.
- `USING` controls which existing rows are visible or targetable. `WITH CHECK` controls rows created or modified by `INSERT` and `UPDATE`; for some policy forms PostgreSQL can use the `USING` expression as the default check.
- Superusers and roles with `BYPASSRLS` bypass row security. Table owners also normally bypass row security unless the table uses `FORCE ROW LEVEL SECURITY`.
- Permissive policies combine with `OR`; restrictive policies combine with `AND`. A rule pack must model both forms before declaring a policy weakened or strengthened.
- `ALTER POLICY` can change roles and expressions, but changing the command or permissive/restrictive nature requires dropping and recreating the policy.
- PostgreSQL predefined read/write roles do not bypass RLS unless the role also has `BYPASSRLS`.

## Automation And Onboarding Needed

1. RLS scan profile:
   - candidate tenant table detection.
   - missing RLS detection.
   - permissive policy detection.
   - policy-body change detection.
   - grant and role posture review.
2. Baseline wizard:
   - tenant key names.
   - shared/system tables.
   - accepted bypass roles.
   - deny-by-default or allow-by-role posture.
3. Report output:
   - severity.
   - affected table or policy.
   - suggested review action.
   - SARIF/GitHub annotation.
   - waiver and expiration metadata.

## Automation-First Workflow

The RLS offer should become a local policy-pack workflow, not a hand-written security review.

1. `supaschema rls init` detects candidate tenant keys, shared/system tables, existing policies, roles, grants, and RLS posture, then writes a draft baseline file.
2. `supaschema check --pack rls` runs deterministic RLS rules over source, planned migration changes, and live catalog facts when available.
3. The rule engine emits text, JSON, GitHub annotation, and SARIF findings with table, policy, role, severity, and remediation metadata.
4. `supaschema rls explain --finding <id>` generates structured context for an RLS remediation agent.
5. The RLS remediation agent drafts review notes, suggested policy changes, and waiver text from finding JSON. It does not change policies automatically.
6. `supaschema rls waive` records owner, reason, scope, and expiration.
7. A GitHub Action runs the same pack in CI and uploads SARIF when enabled.
8. Human approval is required only for accepting waivers, changing tenant baseline assumptions, or merging policy changes.

First automation deliverable:

- `check --pack rls` with baseline config, JSON output, and GitHub/SARIF reporter support.

Full automation deliverable:

- baseline inference, RLS rule pack, waiver lifecycle, remediation-agent drafts, CI gate, and recurring policy-pack reports.

## Implementation Waves

### Wave 1: Manual Review Package

Create service docs and internal report templates around existing CLI outputs:

- `audit`.
- `check --reporter json`.
- `check --reporter sarif`.
- source/catalog policy extraction.

Verification:

- docs checks exit 0.
- no customer secret intake in public surfaces.

### Wave 2: Rule Engine And RLS Pack

Add a typed in-process rule owner that consumes `SchemaModel`, `MigrationPlan`, diagnostics, and reporters.

Checks to implement:

- missing RLS on candidate tenant tables.
- changed policy body.
- permissive policy review.
- inconsistent tenant predicates.
- risky grants or bypass roles.

Verification:

- targeted rule tests pass.
- reporter snapshot tests pass.
- `npm run typecheck` exits 0.
- `npm test` exits 0 when shared diagnostics change.

### Wave 3: Subscription Readiness

Add policy-pack config:

- enabled packs.
- severity overrides.
- waivers.
- org baseline export/import.
- rule-pack version metadata.

Verification:

- config schema tests pass.
- docs explain free local checks versus paid pack checks.

## Scope

In scope:

- local rule engine.
- RLS policy pack.
- reporter integration.
- policy-pack config.
- review report templates.

Out of scope:

- hosted scanning.
- customer database upload.
- production database access.
- SSO/SCIM.
- license-key checks.
- general SQL lint marketplace.

## Full Rollout Gap Analysis

### Product Gaps

- There is no first-class rule engine owner. Full rollout needs a typed rule interface over `SchemaModel`, `MigrationPlan`, diagnostics, and reporters.
- There is no RLS policy pack manifest. Full rollout needs pack metadata, versioning, compatibility range, severity defaults, waiver format, and changelog.
- Tenant baseline config is missing. Full rollout needs tenant key names, shared/system table exclusions, accepted bypass roles, policy posture, and waiver ownership.
- Rule coverage is incomplete. Full rollout needs deterministic checks for missing RLS, changed policy bodies, permissive policies, inconsistent tenant predicates, risky grants, owner bypass, and policy drift between source and catalog.
- PostgreSQL RLS semantic coverage is incomplete. Full rollout must explicitly model default deny, `USING`, `WITH CHECK`, permissive and restrictive policy combination, table-owner bypass, `FORCE ROW LEVEL SECURITY`, `BYPASSRLS`, predefined role behavior, and `ALTER POLICY` limitations.
- False-positive controls are not defined. Full rollout needs severity mapping, suppressions, waiver expiration, and report language that avoids overstating certainty.

### Automation And Onboarding Gaps

- RLS fit quiz is not built.
- Tenant-key detector is not built.
- Baseline wizard is not built.
- SARIF and GitHub annotations do not yet include policy-pack context.
- Redacted RLS review bundle is not defined.
- There is no conversion path from manual review findings to persistent rule configuration.
- No agent prompt or command exists for turning RLS findings into remediation drafts.

### Commercial And Operational Gaps

- Review report template is not finalized.
- Scope boundaries are missing for what counts as a tenant-isolation review versus a full application authorization audit.
- Reviewer workflow is not defined.
- Paid-pack entitlement is not defined. Full rollout can start without license enforcement, but a hosted or private pack needs clear access rules.
- Support process for disputed findings is not defined.

### Implementation Steps To Full Rollout

1. Define the rule engine owner and diagnostic contract.
2. Add the RLS pack manifest and version metadata.
3. Add tenant baseline config and validation.
4. Implement the first checks: missing RLS, changed policy body, permissive policy review, inconsistent tenant predicate, and risky grant review.
5. Add upstream RLS semantic tests for default deny, `USING`, `WITH CHECK`, permissive/restrictive policy combination, owner bypass, `FORCE ROW LEVEL SECURITY`, `BYPASSRLS`, predefined roles, and `ALTER POLICY` limitations.
6. Add `supaschema rls init`, `supaschema rls explain`, and RLS remediation agent prompt templates.
7. Wire diagnostics into text, JSON, GitHub, and SARIF reporters.
8. Add waiver support with owner, reason, expiration, and affected object.
9. Add an automated redacted RLS review bundle and report renderer.
10. Add docs that distinguish RLS policy checks from full application authorization review.
11. Add subscription packaging only after repeated paid reviews confirm demand.

### Full-Rollout Exit Criteria

- A customer can configure tenant baseline without sharing secrets.
- RLS findings are reproducible from local source and catalog evidence.
- Reports show exact table, policy, severity, and remediation action.
- Findings account for PostgreSQL RLS semantics rather than treating policy SQL as plain text.
- CI can run the paid RLS pack without a human reviewer in the loop.
- Waivers are scoped, reviewable, and expiring.
- Policy-pack diagnostics work in local CLI, CI, GitHub annotations, SARIF, and JSON.

## Done Criteria

- A PR that weakens tenant policy can fail locally and in CI.
- Findings flow through text, JSON, GitHub, and SARIF reporters.
- A paid review can produce a redacted RLS report from local outputs.
- Waivers are explicit, scoped, and reviewable.

## Stop Conditions

Stop if:

- tenant source is unclear and cannot be supplied by config.
- a rule would create false confidence without evidence.
- implementation requires hosted customer data.
- implementation duplicates existing reporter or diagnostic owners.

## Maintenance Notes

Keep this pack Postgres/RLS-specific. The differentiation is tenant isolation, not generic SQL linting.
