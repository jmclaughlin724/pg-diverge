# Proposal 04: Adoption Audit And Migration Rescue

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: Follow this plan step by step. Start as a fixed-scope
> assessment using local, redacted command outputs. Do not request secrets or
> direct production database access.

> Drift check: `git diff --stat fb8c461..HEAD -- src/audit.ts src/doctor.ts src/migrations-status.ts src/source.ts src/catalog.ts src/verify.ts src/cli.ts docs/commands/audit.mdx docs/commands/doctor.mdx docs/commands/migrations.mdx docs/concepts/sources.mdx advisor-plans/013-monetization-product-roadmap/04-adoption-audit-migration-rescue`

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: adoption / rescue / monetization
- Execution lens: compatibility-constrained
- Compatibility constraint: adoption and rescue touch database state. Keep all
  collection local and redacted until explicit hosted custody decisions exist.

## Why This Matters

Teams adopting supaschema often arrive with existing databases, mixed migration
systems, hand-edited migrations, drift, or unclear source-of-truth ownership.
Supaschema already has audit, doctor, migration status, verify, inspect, and
fingerprint primitives that can be packaged into a high-value paid assessment.

## User Types And Value Proposition

| User type | Trigger | Value proposition |
| --- | --- | --- |
| Platform engineer | Needs to standardize database delivery | Gets an owner map, risk score, and remediation sequence |
| DBA | Must protect production while teams adopt Git workflows | Identifies drift and unsafe migration history without a portal rollout |
| Engineering manager | Wants fewer blocked releases | Gets a concrete path from current state to green checks |
| Agency or consultant | Needs repeatable client handoff | Gets a standard audit package and evidence output |

## Actionable Pain Points

- The repo has no clear source-of-truth schema.
- Live DB state diverges from Git.
- Generated migrations were hand-edited.
- Migration history has pending, ghost, or out-of-order entries.
- Existing migrations are hand-authored and inconsistent.
- Initial adoption might lose object ownership context.
- Verification requires safe disposable database behavior.

## Market And Client Value

- Public TAM anchor: database automation, `$2.443B` expected in 2025 and
  `$8.0406B` by 2030.
- Supaschema SAM estimate: `1%-3%` Postgres adoption/rescue wedge, or about
  `$24M-$73M` current annual spend.
- Client value:
  - `$3k-$12k` planned adoption assessment.
  - `$10k-$40k` migration rescue.
  - `$2k-$8k/month` governance retainer after remediation.
- First-24-month opportunity: `20-60` engagements at `$5k-$25k` produces
  `$100k-$1.5M`.

## Revenue Generation Model

- Fixed-scope planned audit.
- Higher-priced urgent rescue package.
- Monthly governance retainer after remediation.
- Conversion path into RLS review, evidence packs, or agent governance review.

## Current State Evidence

- `src/audit.ts` summarizes schema objects and diagnostics.
- `src/doctor.ts` checks environment, parser, database reachability, history,
  and tree presence.
- `src/migrations-status.ts` detects pending, ghost, and out-of-order migration
  history.
- `src/verify.ts` validates migration behavior with disposable database logic.
- `src/source.ts` supports git and catalog snapshot sources.
- `docs/commands/audit.mdx`, `docs/commands/doctor.mdx`, and
  `docs/commands/migrations.mdx` already explain user-facing commands.

## Upstream Verification Notes

- PostgreSQL dump output can provide an internally consistent snapshot and does
  not block normal readers or writers, but upstream docs warn that it is not a
  general replacement for regular production backup strategy.
- `pg_dumpall --schema-only` can capture global objects such as roles and
  tablespaces that a per-database dump does not fully represent.
- Restoring a dump can execute arbitrary code from the source database's
  superusers. Rescue workflows must inspect untrusted dumps and must not restore
  customer dumps automatically.
- Diagnostic collection should prefer least-privilege, local, redacted outputs.
  Read-all roles still do not bypass RLS unless `BYPASSRLS` is granted.

## Automation And Onboarding Needed

1. Migration-system detector:
   - Supabase CLI.
   - Flyway.
   - Liquibase.
   - Atlas.
   - Prisma.
   - Drizzle.
   - Rails.
   - Django.
   - custom SQL.
   - mixed workflows.
2. State collector:
   - read supaschema config if present.
   - read schema paths and migrations dir.
   - run local diagnostics.
   - run verify only when local disposable DB requirements are satisfied.
3. Risk classifier:
   - no source-of-truth schema.
   - generated migration edits.
   - pending, ghost, or out-of-order migration state.
   - unsupported objects.
   - drift between live catalog and Git intent.
   - missing generated runtime validators.
4. Output:
   - adoption readiness score.
   - current owner map.
   - remediation sequence.
   - exact commands to reach green state.
   - scope estimate for paid rescue.

## Automation-First Workflow

This offer should become an onboarding scanner and remediation-plan generator.
Manual rescue work should focus on approving risky changes, not assembling the
diagnosis.

1. `supaschema onboard scan` discovers config, schema paths, migrations
   directories, package metadata, CI workflows, incumbent migration tools, and
   current supaschema installation state.
2. The scanner runs safe local diagnostics: `audit`, `doctor`, `migrations
   status`, `inspect`, `fingerprint`, and optional `verify` only when disposable
   database requirements are satisfied.
3. The collector redacts secrets and writes `adoption-bundle.json`,
   `adoption-summary.md`, and a command transcript summary.
4. `supaschema onboard classify` scores source-of-truth clarity, migration
   history health, generated migration integrity, unsupported objects, type
   output readiness, and CI readiness.
5. `supaschema onboard plan` builds a remediation DAG with ordered safe fixes,
   review-only fixes, and blocked/destructive steps.
6. An adoption-rescue agent reads the bundle and drafts a customer handoff,
   remediation PR plan, and quote complexity estimate.
7. `supaschema onboard apply-safe-fixes` can apply approved non-destructive
   config/docs/scaffold fixes. It must not apply migrations.
8. Human approval is required only for source-of-truth decisions, destructive
   actions, data migration scope, or production database changes.

First automation deliverable:

- `supaschema onboard scan` with redacted bundle output and migration-system
  detection.

Full automation deliverable:

- scanner, classifier, remediation DAG, safe-fix applier, rescue-agent handoff,
  CI readiness check, and recurring governance retainer report.

## Implementation Waves

### Wave 1: Manual Audit Package

Create a repeatable report template and service page:

- command collection checklist.
- redaction guidance.
- adoption readiness report.
- rescue estimate shape.

Verification:

- docs checks exit 0 if public docs change.
- report template excludes secret values.

### Wave 2: Local Onboarding Collector

Add a local collector or report mode that assembles safe diagnostics.

Verification:

- collector tests cover missing config, mixed migration tool detection, and
  redaction.
- `npm run typecheck` exits 0.
- `npm test` exits 0 for changed source areas.

### Wave 3: Rescue Productization

Convert repeated rescue patterns into deterministic checks:

- generated migration edit evidence.
- drift and migration history classification.
- unsupported-object inventory.
- remediation sequence export.

Verification:

- migration status tests pass.
- audit/doctor tests pass.
- docs explain current local scope.

## Scope

In scope:

- adoption audit report.
- migration rescue intake.
- local diagnostic collector.
- migration-system detector.
- remediation sequence output.

Out of scope:

- production database access by maintainers.
- hosted schema upload.
- automatic migration apply.
- on-call incident response.
- guarantees for every hand-authored data migration.

## Full Rollout Gap Analysis

### Product Gaps

- Migration-system detector is not built. Full rollout needs detection for
  Supabase CLI, Flyway, Liquibase, Atlas, Prisma, Drizzle, Rails, Django, custom
  SQL, and mixed workflows.
- Local onboarding collector is not built. Full rollout needs a command that
  gathers config, schema paths, migrations dir, audit output, doctor output,
  migration status, inspect/fingerprint output, and optional verify results.
- Adoption readiness score is not defined. Full rollout needs scoring for
  source-of-truth clarity, migration history health, generated migration
  integrity, object coverage, unsupported objects, type output readiness, and
  CI readiness.
- Remediation sequencing is not automated. Full rollout needs a deterministic
  order for fixing config, schema intent, generated migrations, drift, type
  outputs, CI, and verification.
- Rescue report schema is missing. Full rollout needs a standard owner map,
  risk list, command transcript summary, remediation steps, and acceptance
  criteria.
- Dump, backup, and restore boundaries are not defined. Full rollout needs
  explicit guidance that collected dumps are diagnostic artifacts, not managed
  backups, and that untrusted restore inputs require inspection.
- Global object capture is incomplete. Full rollout needs a roles, tablespaces,
  grants, extensions, and ownership inventory when adoption risk depends on
  database-level or cluster-level state.

### Automation And Onboarding Gaps

- Adoption fit quiz is not built.
- Redacted collector bundle is not defined.
- Unsupported-object inventory is not surfaced as a paid audit section.
- Incumbent-tool migration paths are not documented.
- Quote estimator for rescue complexity is not built.
- Dump inspection, global-object inventory, and restore-risk classification are
  not built.
- Customer-safe evidence upload is not available and should remain absent until
  custody is approved.
- No remediation DAG or safe-fix executor exists.
- No adoption-rescue agent prompt exists for turning local bundle JSON into a
  handoff and quote estimate.

### Commercial And Operational Gaps

- Planned audit and urgent rescue are not separated commercially.
- Scope boundaries for data migrations, unsupported objects, and production
  incidents are not defined.
- Retainer conversion process is missing.
- Report review process is not defined.
- There is no standard customer handoff template.

### Implementation Steps To Full Rollout

1. Define the adoption readiness score and report schema.
2. Add migration-system detection.
3. Add local collector with redaction and no hosted upload.
4. Add risk classifiers for no source-of-truth, generated migration edits,
   pending/ghost/out-of-order state, unsupported objects, drift, missing type
   outputs, and CI gaps.
5. Add dump and restore safety classification, including untrusted-dump review
   and an explicit "not a backup service" boundary.
6. Add global-object inventory for roles, tablespaces, grants, extensions, and
   ownership where supported by local inputs.
7. Add remediation DAG generation with safe, review-only, blocked, and
   destructive categories.
8. Add `apply-safe-fixes` for non-destructive config, docs, scaffold, and CI
   fixes only.
9. Add adoption-rescue agent prompt templates for customer handoff and quote
   estimate generation.
10. Add incumbent-specific guidance for Supabase CLI, Flyway, Liquibase, Atlas,
   Prisma, Drizzle, Rails, Django, and custom SQL.
11. Add planned-audit and rescue intake forms with scope boundaries.
12. Add report template and customer handoff checklist.
13. Convert repeated rescue findings into rule-pack checks or evidence bundle
   fields.

### Full-Rollout Exit Criteria

- A customer can run one local collector and receive a redacted adoption bundle.
- The report identifies the current migration system and source-of-truth owner.
- The report classifies migration history defects.
- The report separates schema diagnostics from backup, restore, and data
  migration responsibilities.
- The report gives an ordered remediation path.
- Approved non-destructive fixes can be applied automatically without applying
  migrations.
- Rescue pricing can be scoped from redacted evidence without production
  credentials.

## Done Criteria

- A customer can run local commands and submit a redacted report.
- The report identifies current source-of-truth state.
- The report names migration history defects.
- The report provides an ordered remediation sequence.
- Rescue scope can be estimated without secrets.

## Stop Conditions

Stop if:

- the plan needs production credentials.
- the correct tenant or source-of-truth owner is unclear.
- local verification would require destructive database behavior.
- unsupported object claims are overstated.

## Maintenance Notes

This lane is the best immediate cash generator but the least scalable until
findings are converted into evidence bundles and rule-pack checks.
