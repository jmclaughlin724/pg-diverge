# Plan 012: Monetization Funnel And Paid Product Proposal

Planned on 2026-06-16 against commit `fb8c461`.

## Purpose

Create an implementation plan for monetization opportunities 1-4 from the revenue review:

1. Commercial license, pricing, and support funnel.
2. Hosted or organization CI policy product.
3. Paid agent migration governance and support tier.
4. Paid adoption audits and migration rescue services.

This plan is implementation-ready, but it does not itself implement pricing,
billing, hosted infrastructure, or legal terms.

## Task-Creator Execution Record

- Persistent task API: unavailable in this Codex session after tool discovery.
  This file is the durable fallback task artifact.
- Live progress mirror: `update_plan` tracked the active work during creation.
- Execution lens: compatibility-constrained.
- Elegant end state: one public commercial and support funnel; one free OSS CLI
  and package boundary; one docs owner for each paid offer; no billing,
  telemetry, license-key, or customer-data path inside the CLI.
- Compatibility constraint: preserve AGPL/commercial dual-license baseline,
  preserve free dev-dependency and internal CI use, preserve package allowlist,
  preserve generated agent bundle behavior, and avoid hosted CI implementation
  until auth, tenancy, billing, and data-retention owners exist.
- Open assumptions: none.
- Resolved assumptions:
  - The current commercial license contact path is broken because
    `.github/ISSUE_TEMPLATE/config.yml` disables blank issues while
    `LICENSE-COMMERCIAL.md` tells buyers to open an issue.
  - Hosted CI policy is named in docs as a future direction, but the repo has no
    GitHub App, org auth, purchase-event handling, tenant model, credential
    custody model, or data-retention policy.
  - Stripe Payment Links can support early fixed-price or quote-adjacent service
    sales without product code. Stripe Pricing Table is not a fit for usage-based
    hosted CI because Stripe documents that limitation.
  - GitHub Marketplace is not a first implementation target. Paid Marketplace
    apps require a verified publisher, purchase-event handling, and a GitHub App
    or OAuth app surface. The current repo has only a composite Action.
  - Legal and pricing terms are not approved in-repo. The first implementation
    must use quote/contact language and avoid fixed prices, SLAs, warranties, or
    new license grants.
  - Paid agent governance must package review and support around the existing
    free local Claude/Codex bundle. It must not ship paid/private hooks or
    maintainer-only tooling to consumers.
  - Paid adoption audits can start from existing commands: `audit`, `doctor`,
    `migrations`, `check`, and `verify`.
  - `docs/concepts/migration-pipeline.mdx` currently overclaims support for
    publications, subscriptions, and storage objects. That correction must land
    before paid audit or rescue collateral.
- Scope ledger:
  - Plan-owned changes in this task: this file and
    `advisor-plans/README.md`.
  - Execution-owned changes: listed under "Change Inventory".
- Placeholders / TODOs: none.
- Deferral budget: zero. Every user-requested opportunity has an implementation
  lane, a non-goal, and an acceptance path in this plan.

## Source Evidence

- `package.json` declares `AGPL-3.0-only OR Commercial` and includes
  `LICENSE-COMMERCIAL.md` in the npm package allowlist.
- `README.md` mentions dual licensing only briefly.
- `LICENSE-COMMERCIAL.md` requires a commercial license for proprietary or
  hosted embedding, but directs buyers to open an issue.
- `.github/ISSUE_TEMPLATE/config.yml` disables blank issues and has no
  commercial inquiry template.
- `docs/docs.json` has no pricing, commercial license, support, hosted policy,
  or services entry.
- `docs/faq.mdx` has only a short license answer.
- `docs/guides/ci-gate.mdx` already frames hosted org-level policy enforcement
  as a possible hosted product direction.
- `action.yml` is a thin composite Action around `npx supaschema`; it is not a
  hosted product.
- `src/cli-diff.ts`, `src/cli.ts`, `src/check-reporters.ts`, and `src/verify.ts`
  already provide local CI gates and reporters.
- `src/verify.ts` and `src/db-admin.ts` intentionally restrict remote or
  non-local database behavior. Hosted CI needs a credential and disposable
  database design before code changes.
- `docs/coding-agents/agent-bundle.mdx`, `bin/scaffold.mjs`, and
  `.codex/hooks.json` define the free local agent bundle and hooks.
- `services/agent-mcp/**` is repo-local/read-only maintainer tooling and is
  excluded from consumer paid packaging.
- `docs/commands/audit.mdx`, `docs/commands/doctor.mdx`, and related source
  files provide a credible paid adoption audit basis.
- `docs/concepts/migration-pipeline.mdx` overclaims unsupported object classes
  and must be corrected before selling audit outcomes.

## External Channel Evidence

Use these sources as current upstream constraints when executing this plan:

- GitHub Marketplace paid plans require verified publisher status and app-side
  Marketplace event handling:
  <https://docs.github.com/en/apps/github-marketplace/selling-your-app-on-github-marketplace/pricing-plans-for-github-marketplace-apps>
- GitHub Marketplace listings require a support link or email, valid privacy
  links, and purchase-event handling:
  <https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app>
- Stripe Payment Links can create hosted payment pages for products,
  subscriptions, and one-off fixed-price products without product code:
  <https://docs.stripe.com/payment-links/create>
- Stripe Pricing Table supports subscription models but does not support
  usage-based pricing, so it is not the hosted CI billing owner:
  <https://docs.stripe.com/payments/checkout/pricing-table>
- GitHub Sponsors can support OSS sponsorship tiers, but it is not the
  commercial license owner:
  <https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/managing-your-sponsorship-tiers>

## Product Shape

### Opportunity 1: Commercial License And Support Funnel

Implement a docs and GitHub inquiry path that turns existing license rights into
an actionable sales path.

Public offer:

- Commercial license inquiry for proprietary embedding, hosted redistribution,
  white-label use, or private SaaS integration.
- Support inquiry for organizations that want implementation help without a
  commercial redistribution license.
- OSS usage remains AGPL and free.
- Internal CI and development use remains free unless redistribution or hosted
  embedding triggers the commercial license language.

First surfaces:

- Add `docs/commercial-license.mdx`.
- Add `.github/ISSUE_TEMPLATE/commercial_license.yml`.
- Update `LICENSE-COMMERCIAL.md` to point to the commercial docs page and issue
  template instead of a disabled generic issue path.
- Update `README.md`, `docs/faq.mdx`, and `docs/docs.json`.

Do not add:

- Fixed prices.
- SLA promises.
- Warranty language.
- License-key checks.
- Telemetry.
- Billing SDKs.

### Opportunity 2: Hosted Or Organization CI Policy Product

Implement the product design and waitlist/contact surface, not hosted execution
code.

Public offer:

- Org-level schema policy enforcement for teams that want centralized checks
  around `diff`, `check`, optional `verify`, GitHub Checks, and SARIF.
- Clear distinction between free local CI and a paid managed policy service.

First surfaces:

- Add `docs/guides/hosted-ci-policy.mdx`.
- Update `docs/guides/ci-gate.mdx` to clarify current local Action usage versus
  hosted product design.
- Link the hosted policy page from the commercial/support surface.

Design contract that must exist before code:

- GitHub App or equivalent installation owner.
- Auth and authorization model for orgs, repos, users, and installations.
- Tenant data model.
- Billing and plan ownership.
- Secret custody policy for database URLs and GitHub tokens.
- Data retention and cancellation deletion policy.
- Runner model for disposable verification databases.
- Failure-mode policy for unavailable hosted checks.
- Audit logging policy.

Do not add in this plan:

- Changes to `action.yml`.
- A GitHub App.
- Cloud service code.
- Stripe SDK integration.
- Usage-based billing.
- Any remote database verification path that weakens current local safety
  guards.

### Opportunity 3: Paid Agent Migration Governance And Support

Package review and support around the existing free local agent bundle.

Public offer:

- Agent migration governance review for teams using Claude/Codex with
  supaschema.
- Setup review for rules, hooks, generated migration protection, typegen, and
  sync guardrails.
- Policy review for teams that need safe human approval around migration apply.

First surfaces:

- Update `docs/coding-agents.mdx` or add
  `docs/coding-agents/governance-support.mdx`.
- Update `docs/coding-agents/agent-bundle.mdx` only to clarify what stays free
  and what a paid review covers.
- Link this offer from `docs/commercial-license.mdx`.

Do not add:

- Paid/private hook files to consumer installs.
- Changes to `bin/scaffold.mjs`.
- Changes to `.codex/hooks.json`, `.claude/settings.json`, or `.agents/**`.
- FastMCP as a consumer product dependency.
- Promises that agents apply production migrations.

### Opportunity 4: Paid Adoption Audits And Migration Rescue

Package the existing audit and diagnostic commands into a paid service path.

Public offer:

- Adoption audit for teams moving existing PostgreSQL or Supabase projects into
  supaschema.
- Migration rescue for teams with drift, generated-file divergence, broken
  local verification, or unclear hand-authored migrations.
- Deliverables can include a written audit summary, recommended schema owner
  map, risk list, and migration remediation plan.

First surfaces:

- Add `docs/guides/adoption-audit-service.mdx`.
- Update `docs/commands/audit.mdx`, `docs/commands/doctor.mdx`, and
  `docs/commands/migrations.mdx` only where they should link to the service
  offer.
- Update `docs/whats-included.mdx` if it is the current feature-scope owner.
- Correct `docs/concepts/migration-pipeline.mdx` before adding sales language.

Do not add:

- Claims that supaschema supports unsupported object classes.
- Claims that the service can guarantee rescue for every hand-authored data
  migration.
- Requests for customers to paste secrets, database URLs, or private schema
  dumps into public GitHub issues.

## Change Inventory

### Add

- `advisor-plans/012-monetization-implementation-proposal.md`.
- `.github/ISSUE_TEMPLATE/commercial_license.yml`.
- `docs/commercial-license.mdx`.
- `docs/guides/adoption-audit-service.mdx`.
- `docs/guides/hosted-ci-policy.mdx`.
- `docs/coding-agents/governance-support.mdx` only if the executor chooses a
  separate page over extending `docs/coding-agents.mdx`.

### Update

- `advisor-plans/README.md`.
- `LICENSE-COMMERCIAL.md`.
- `README.md`.
- `docs/docs.json`.
- `docs/faq.mdx`.
- `docs/guides/ci-gate.mdx`.
- `docs/concepts/migration-pipeline.mdx`.
- `docs/coding-agents.mdx`.
- `docs/coding-agents/agent-bundle.mdx`.
- `docs/commands/audit.mdx`.
- `docs/commands/doctor.mdx`.
- `docs/commands/migrations.mdx`.
- `docs/whats-included.mdx`.

### Remove

- None.

### Keep Unchanged

- `package.json#license`.
- `package.json#files`.
- `action.yml`.
- `src/**`.
- `bin/scaffold.mjs`.
- `.claude/**`, `.codex/**`, and `.agents/**` hook or skill behavior.
- `services/agent-mcp/**`.
- Cloudflare Worker code.
- Stripe billing code.
- GitHub App code.
- License-key, telemetry, or entitlement code.

### Dependencies

- No new runtime dependencies.
- No new production dependencies.
- No Stripe SDK.
- No GitHub App framework.

### Generated Files

- None for the first implementation.

## Implementation Waves

### Wave 1: Commercial Funnel And Scope Correction

Subject: commercial license and support inquiry path.

Active form:

- Add a commercial docs page.
- Add a structured GitHub commercial inquiry issue template.
- Update current license, README, FAQ, and docs nav links.
- Correct the migration-pipeline support overclaim.

Write scope:

- `.github/ISSUE_TEMPLATE/commercial_license.yml`.
- `LICENSE-COMMERCIAL.md`.
- `README.md`.
- `docs/commercial-license.mdx`.
- `docs/docs.json`.
- `docs/faq.mdx`.
- `docs/concepts/migration-pipeline.mdx`.

Acceptance criteria:

- A buyer can find the commercial license path from README and docs nav.
- The license file no longer sends buyers to a disabled issue flow.
- The issue template requests business context, use case, expected scale, and
  contact method, but does not request secrets or private database details.
- The commercial page distinguishes commercial licensing from paid support.
- No fixed pricing, SLA, or legal guarantee is introduced.
- Unsupported object-class claims are removed.

Verification:

- `npm run docs:lint`
- `npm run docs:check`
- `npm run check:package`
- `npx vitest run tests/package-contents.test.ts tests/docs-standard.test.ts`
- `git diff --check`

STOP if:

- Legal terms, fixed price points, or SLA language are required before approval.
- Any change would alter package licensing semantics beyond contact and
  documentation.

### Wave 2: Paid Services And Agent Governance

Subject: support, adoption audit, migration rescue, and agent governance service
pages.

Active form:

- Add adoption audit service guide.
- Add or extend agent governance support page.
- Link service pages from commercial and relevant command docs.
- Keep free local commands and generated agent bundle clearly free.

Write scope:

- `docs/guides/adoption-audit-service.mdx`.
- `docs/coding-agents.mdx` or
  `docs/coding-agents/governance-support.mdx`.
- `docs/coding-agents/agent-bundle.mdx`.
- `docs/commands/audit.mdx`.
- `docs/commands/doctor.mdx`.
- `docs/commands/migrations.mdx`.
- `docs/whats-included.mdx`.
- `docs/docs.json`.

Acceptance criteria:

- Adoption audit and migration rescue have clear intake, scope, deliverables,
  exclusions, and privacy boundaries.
- Agent governance support describes review and advisory services, not a paid
  private agent bundle.
- Existing free commands remain documented as free local tooling.
- Public issues do not become a private-schema intake path.
- FastMCP and maintainer-only Code Atlas tooling remain excluded from consumer
  packaging.

Verification:

- `npm run docs:lint`
- `npm run docs:check`
- `npx vitest run tests/docs-standard.test.ts tests/editor-surfaces.test.ts`
- `git diff --check`

STOP if:

- The implementation requires shipping new hooks, private skills, FastMCP, or
  maintainer-only tooling to consumers.
- The service copy promises production apply, guaranteed rescue, or handling of
  secrets in public channels.

### Wave 3: Hosted CI Policy Design

Subject: hosted CI policy design and interest funnel.

Active form:

- Add hosted policy page as a product design and inquiry surface.
- Update current CI guide to distinguish local CI from managed policy.
- Record required system owners before any hosted product code.

Write scope:

- `docs/guides/hosted-ci-policy.mdx`.
- `docs/guides/ci-gate.mdx`.
- `docs/commercial-license.mdx`.
- `docs/docs.json`.

Acceptance criteria:

- The current composite Action remains the documented free local path.
- The hosted policy page describes proposed checks, reports, and organization
  controls without claiming the service exists as code.
- Required pre-code decisions are explicit: auth, tenancy, billing,
  Marketplace or Stripe ownership, secret custody, data retention, cancellation,
  runner isolation, and customer support.
- The page states that `verify` requires safe disposable databases and does not
  weaken current local-only protections.

Verification:

- `npm run docs:lint`
- `npm run docs:check`
- `npx vitest run tests/docs-standard.test.ts`
- `git diff --check`

STOP if:

- Hosted execution, GitHub App, Stripe, or remote database code becomes required
  before the design owners exist.
- `action.yml` changes become necessary. If that happens, create a separate plan
  and include `npx vitest run tests/action.test.ts tests/editor-surfaces.test.ts`.

### Wave 4: Adversarial Review And Release Readiness

Subject: validate that the monetization implementation is honest, scoped, and
non-invasive.

Active form:

- Run an adversarial verification pass after Waves 1-3.
- Run an update pass for impacted docs and package surfaces.
- Check for unsupported claims and accidental monetization code.

Write scope:

- Only files changed by Waves 1-3.

Acceptance criteria:

- No unsupported object-class claims remain.
- No production dependency was added.
- No billing, telemetry, entitlement, or license-key code exists.
- No package allowlist expansion occurs without an explicit package boundary
  review.
- No consumer agent bundle change introduces paid/private surfaces.
- All changed docs are reachable from docs navigation or intentionally linked
  from a canonical page.

Verification:

- `npm run docs:lint`
- `npm run docs:check`
- `npm run code-atlas:query -- regression-scope --json`
- `npm run check:package`
- `git diff --check`
- `rg -n "storage objects|publications|subscriptions|guarantee|SLA|license key|telemetry|production apply" README.md docs LICENSE-COMMERCIAL.md .github/ISSUE_TEMPLATE`

STOP if:

- Any finding requires product, legal, security, or data-retention decisions that
  are not represented in repo rules, docs, or an accepted design plan.

## Enforcement-Surface Ledger

- Docs owner: `docs/docs.json`.
- Docs standard guard: `scripts/check-docs-standard.mjs`.
- Docs test owner: `tests/docs-standard.test.ts`.
- Package boundary owner: `package.json#files`.
- Package boundary tests: `tests/package-contents.test.ts` and
  `tests/editor-surfaces.test.ts`.
- GitHub Action owner: `action.yml`.
- GitHub Action tests: `tests/action.test.ts`.
- Agent scaffold owner: `bin/scaffold.mjs`.
- Generated agent bundle guards: `.codex/hooks.json`, `.claude/settings.json`,
  and package boundary tests.
- FastMCP owner: `services/agent-mcp/**`; excluded from paid consumer scope.

## Privacy And Security Requirements

- Commercial issue template must not request secrets, private schema dumps,
  database URLs, API keys, service-role keys, or customer production data.
- Paid audit intake must direct private materials to a private agreed channel,
  not GitHub public issues.
- Hosted CI page must state that remote verification requires explicit opt-in,
  disposable databases, credential custody, log redaction, and retention policy.
- Any future hosted product must redact database URLs, tokens, JWTs, and
  connection strings in reports.
- Any future Marketplace app must handle cancellation data deletion according to
  the upstream Marketplace requirements.

## STOP Conditions

Stop implementation and ask for an owner decision if any of these become true:

- Fixed prices, discounts, refunds, SLAs, warranties, indemnity, or license
  grants are required.
- The CLI would gain license keys, telemetry, entitlement checks, billing code,
  or customer identity collection.
- `package.json#license` or `package.json#files` would change.
- Hosted CI code is requested before auth, tenancy, billing, data retention,
  runner isolation, and secret custody are designed.
- A remote database verification path would bypass current local safety guards.
- Service copy must claim support for unsupported PostgreSQL, Supabase, or
  storage object classes.
- Paid/private hooks, skills, FastMCP, or maintainer-only tooling would ship in
  the npm consumer bundle.
- A public GitHub issue would become an intake path for private customer data.

## Required Skills For Execution

- `mintlify` for docs structure and docs validation.
- `write-docs` for public-facing page edits.
- `api-design` if hosted CI product contracts move beyond docs.
- `adversarial-verification` for Wave 4.
- `update` after docs and package-surface edits land.

## Final Acceptance Criteria

- Opportunity 1 has a reachable commercial license and support inquiry path.
- Opportunity 2 has a scoped hosted CI policy design page and no premature code.
- Opportunity 3 has a paid agent governance support surface that preserves the
  free local agent bundle.
- Opportunity 4 has a paid adoption audit and migration rescue surface based on
  existing commands.
- Commercial copy avoids fixed pricing, SLA, warranty, and unapproved legal
  terms.
- Unsupported capability claims are corrected.
- Docs checks pass.
- Package boundary checks pass if package-visible files are touched.
- No production dependency is added.
- The final executor response lists changed files, commands run, results, and
  remaining risks.
