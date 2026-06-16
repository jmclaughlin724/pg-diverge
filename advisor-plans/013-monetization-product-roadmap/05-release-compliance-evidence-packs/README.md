# Proposal 05: Release And Compliance Evidence Packs

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: Follow this plan step by step. Evidence packs start as
> local, redacted artifacts. Do not build hosted retention, auditor portals, or
> customer-data storage until tenant and retention decisions exist.

> Drift check: `git diff --stat fb8c461..HEAD -- src/audit.ts src/doctor.ts src/migrations-status.ts src/check-reporters.ts src/verify.ts src/source.ts src/catalog.ts src/cli.ts docs/commands/audit.mdx docs/commands/doctor.mdx docs/commands/migrations.mdx docs/guides/ci-github-actions.mdx advisor-plans/013-monetization-product-roadmap/05-release-compliance-evidence-packs`

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: compliance / release evidence / monetization
- Execution lens: compatibility-constrained
- Compatibility constraint: evidence can affect audit and compliance claims.
  Keep wording precise and avoid hosted retention promises until the data model
  exists.

## Why This Matters

Regulated and enterprise teams need durable proof that database changes were
reviewed, validated, and tied to source control. Raw CI logs are scattered and
short-lived. Supaschema can turn existing local outputs into a release packet
without storing customer data.

## User Types And Value Proposition

| User type | Trigger | Value proposition |
| --- | --- | --- |
| Release manager | Needs go/no-go evidence before release | Gets one schema release packet with checks, lineage, and waivers |
| Compliance or GRC owner | Needs audit evidence for database change controls | Gets redacted, repeatable control evidence |
| Engineering manager | Needs fewer release surprises | Gets a concise risk summary and remediation list |
| Enterprise buyer | Needs procurement and security review evidence | Gets a path from local evidence to future retention add-on |

## Actionable Pain Points

- CI logs are scattered.
- Migration lineage is buried in generated files.
- Check output is not written for release review.
- Database changes lack a durable release artifact.
- Approvals cannot reference one canonical evidence file.
- Auditors ask for database change-control proof.
- Evidence is manually compiled and inconsistent.

## Market And Client Value

- Public TAM anchors:
  - compliance software, `$35.37B` in 2025 and `$74.12B` by 2031.
  - regulatory compliance management software, `$12.41B` in 2025 and `$19.8B`
    by 2030.
- Supaschema SAM estimate: `0.1%-0.5%` database-release evidence wedge, or about
  `$35M-$177M` using compliance software as the broad anchor.
- Client value:
  - `$2k-$8k` per release pack.
  - `$15k-$75k/year` for recurring release cadence.
  - `$75k-$150k/year` for enterprise evidence plus retention after hosted
    storage exists.
- First-24-month opportunity: `15-40` customers at `$10k-$40k` annual cadence
  produces `$150k-$1.6M`.

## Revenue Generation Model

- Start as per-release proof package.
- Sell recurring release cadence as an annual subscription.
- Meter by protected project, release cadence, evidence retention, and
  auditor/export access.
- Add hosted retention only after tenant, deletion, retention, and auditor-access
  models exist.

## Current State Evidence

- `src/audit.ts` reports object coverage and diagnostics.
- `src/doctor.ts` reports environment readiness.
- `src/check-reporters.ts` renders JSON, SARIF, GitHub, and text outputs.
- `src/migrations-status.ts` reports migration history state.
- `src/verify.ts` reports migration verification results.
- Existing commands can already generate the raw material for a release packet:
  `audit`, `doctor`, `migrations status`, `check --reporter json`,
  `check --reporter sarif`, `verify`, `inspect`, and `fingerprint`.

## Upstream Verification Notes

- GitHub code scanning accepts SARIF from third-party tools, but it supports a
  defined subset of SARIF 2.1.0. Evidence-pack SARIF attachments must be
  validated against that supported shape before they are sold as GitHub-ready.
- GitHub artifact attestations and SLSA provenance are useful only when the
  consumer verifies artifact subject, signer identity, timestamp, and integrity.
  A plain hash is tamper-evidence, not provenance.
- NIST SSDF guidance treats provenance integrity and verification as secure
  development practices. Evidence packs should record how evidence was produced
  and how it can be verified.
- OWASP ASVS is a security verification standard, not a compliance certificate.
  Any control mapping must be labeled as internal control evidence unless a
  separate certification authority is involved.

## Automation And Onboarding Needed

1. Evidence command:
   - commit SHA.
   - config fingerprint.
   - schema fingerprint.
   - migration lineage.
   - audit output.
   - check output.
   - migrations status.
   - verify result.
   - SARIF/JSON report paths.
   - redaction metadata.
2. Evidence schema:
   - stable JSON manifest.
   - human-readable Markdown summary.
   - optional hash/signature.
   - optional control mapping fields.
3. Release metadata:
   - release ID.
   - environment.
   - approver.
   - PR or change request link.
   - migration files included.
   - known waivers.
4. Output:
   - one release packet.
   - one executive summary.
   - one auditor-safe technical appendix.
   - one remediation list for failed controls.

## Automation-First Workflow

This offer should become a release artifact generator that runs in CI. Manual
work should be limited to approvals, control mapping ownership, and exception
review.

1. `supaschema evidence init` creates evidence config for release metadata,
   control mappings, redaction policy, artifact outputs, and waiver fields.
2. `supaschema evidence collect --release <id>` runs or imports `audit`,
   `doctor`, `migrations status`, `check`, `verify`, fingerprints, SARIF, JSON,
   and lineage outputs.
3. The collector writes `evidence-manifest.json`, `evidence-summary.md`,
   `technical-appendix.md`, artifact hashes, redaction metadata, and failed
   control remediation.
4. `supaschema evidence validate` checks schema validity, required fields,
   secret redaction, SARIF compatibility, artifact existence, and waiver
   metadata.
5. `supaschema evidence sign` optionally signs or hashes the artifact bundle and
   writes verification instructions.
6. A release-evidence agent reads the validated manifest and drafts auditor
   summaries, release notes, and remediation issues.
7. A GitHub Action runs collect, validate, and optional attestation steps on
   every release.
8. Human approval is required only for release signoff, failed-control
   acceptance, control mapping changes, and certification-sensitive language.

First automation deliverable:

- `supaschema evidence collect` plus JSON/Markdown outputs from existing command
  results.

Full automation deliverable:

- evidence config, collector, validator, signer/attestation integration,
  release-evidence agent, GitHub Action, and annual cadence reports.

## Implementation Waves

### Wave 1: Manual Evidence Pack

Create report templates and service intake:

- release evidence checklist.
- redaction policy.
- report outline.
- control mapping fields.

Verification:

- docs checks exit 0 if public docs change.
- report template contains no secret collection request.

### Wave 2: Evidence Bundle Command

Add a local command or report mode that gathers existing outputs into one
artifact.

Verification:

- artifact schema snapshot tests pass.
- redaction tests pass.
- `npm run typecheck` exits 0.
- `npm test` exits 0 for changed source areas.

### Wave 3: Recurring Evidence Cadence

Productize repeat usage:

- release cadence config.
- waiver metadata.
- control mapping.
- artifact hashing.
- export guidance.

Verification:

- docs explain local storage and hosted non-goals.
- no hosted retention promise is added.

## Scope

In scope:

- release evidence artifact.
- local evidence command/report mode.
- redaction metadata.
- Markdown and JSON summaries.
- per-release service offer.

Out of scope:

- hosted retention.
- auditor portal.
- SSO/SCIM.
- customer schema upload.
- compliance guarantee.
- legal certification claims.

## Full Rollout Gap Analysis

### Product Gaps

- Evidence bundle command is not built. Full rollout needs a local command or
  report mode that gathers existing outputs into one manifest.
- Evidence schema is not defined. Full rollout needs stable JSON, Markdown
  summary, artifact manifest, redaction metadata, optional hash/signature, and
  control mapping fields.
- Release metadata is not captured. Full rollout needs release ID, environment,
  approver, PR or change-request link, migration files included, waivers, and
  known failed controls.
- Report renderers are not unified. Full rollout needs one evidence packet that
  composes audit, doctor, check, migration status, verify, SARIF, JSON,
  fingerprint, and lineage outputs without duplicating reporter logic.
- Tamper-evidence is not designed. Full rollout needs hashing or signing rules,
  artifact ordering, and drift behavior when files change after collection.
- Provenance verification is not designed. Full rollout needs a signer identity,
  timestamp, subject artifact, verification command, and clear label for
  unsigned local evidence.
- SARIF compatibility is not guaranteed. Full rollout needs validation against
  GitHub's supported SARIF subset and documented behavior when SARIF cannot be
  uploaded or code scanning is unavailable.

### Automation And Onboarding Gaps

- Evidence fit quiz is not built.
- Release evidence collector is not built.
- Control mapping wizard is not built.
- Auditor-safe summary is not generated.
- Retention/export path is not defined.
- Attestation verification, signer policy, and SARIF validation are not built.
- No release-evidence agent prompt exists for drafting auditor summaries and
  remediation issues from validated manifests.
- Hosted retention and auditor access are absent by design until tenancy,
  deletion, retention, and access-control models exist.

### Commercial And Operational Gaps

- Per-release package and annual cadence packaging are not finalized.
- Support boundary is not defined for failed controls discovered during release
  evidence collection.
- Compliance copy must avoid certification or guarantee claims.
- Evidence retention responsibility is not defined for local-only packages.
- Control mappings are not approved. Full rollout needs an owner for ASVS,
  SSDF, SOC 2, ISO 27001, or customer-specific mappings and wording that avoids
  certification claims.
- Enterprise evidence plus retention cannot launch until hosted custody is
  approved.

### Implementation Steps To Full Rollout

1. Define the evidence bundle schema.
2. Define release metadata and waiver fields.
3. Add local evidence collection that composes existing report owners.
4. Add JSON manifest and Markdown summary output.
5. Add redaction metadata and tests.
6. Add SARIF compatibility validation for GitHub-ready attachments.
7. Add optional hash/signature behavior plus verification instructions.
8. Add provenance fields for signer, timestamp, subject artifact, and evidence
   generation command.
9. Add release-evidence agent prompt templates for auditor summary, release
   notes, and remediation issue drafting.
10. Add failed-control remediation list.
11. Add service report template and per-release intake.
12. Add annual cadence workflow.
13. Add hosted retention only after tenant, deletion, retention, and
    auditor-access models exist.

### Full-Rollout Exit Criteria

- A release produces one evidence packet from local commands.
- The packet includes commit, config fingerprint, schema fingerprint, migration
  lineage, audit output, check output, migration status, verify result, and
  redaction metadata.
- The packet has a human-readable summary and machine-readable manifest.
- Failed controls produce an actionable remediation list.
- Evidence copy is audit-useful without claiming legal certification.
- Signed or attested evidence includes verification instructions; unsigned
  evidence is labeled as local evidence.
- CI can generate and validate the evidence packet without a manual compiler.

## Done Criteria

- A release can produce one evidence packet.
- The packet names commit, config fingerprint, schema fingerprint, migration
  lineage, check results, migration status, and verification result.
- The packet can be reviewed without exposing secrets.
- Failed controls produce a remediation list.

## Stop Conditions

Stop if:

- evidence collection would require secrets.
- hosted retention is needed before tenant and deletion models exist.
- compliance copy overstates certification or guarantee.
- the command duplicates existing report owners instead of composing them.

## Maintenance Notes

This lane is the cleanest bridge from manual service revenue to repeatable
software revenue. It should reuse existing reporters instead of creating a
parallel reporting system.
