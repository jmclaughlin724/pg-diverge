# Proposal 01: Commercial License And OEM Private-Build Rights

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: Follow this plan step by step. This is a planning
> handoff, not permission to implement legal terms, pricing, billing, hosted
> services, or license enforcement. If implementation is requested later, run
> the drift check first and honor every stop condition.

> Drift check: `git diff --stat fb8c461..HEAD -- LICENSE-COMMERCIAL.md README.md docs/faq.mdx docs/docs.json package.json .github/ISSUE_TEMPLATE advisor-plans/013-monetization-product-roadmap/01-commercial-license-oem`

> Before executing: read the **Executor Readiness Contract** in `../README.md`.
> Any `supaschema <command>` or `scripts/<path>` named below that is not already in
> the existing CLI surface is TO CREATE — write its Phase 0 design spec (module
> path, CLI registration in `src/cli-tools.ts` / `src/cli-reports.ts`, input/output
> schema, exit codes, named to-create test) before building, and convert any prose
> done criterion to a command + expected output.

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: direction / monetization
- Execution lens: compatibility-constrained
- Compatibility constraint: commercial terms affect public licensing,
  packaging, and legal claims. Preserve free OSS local usage and do not add
  license-key checks to the CLI.

## Why This Matters

Commercial/OEM rights are the highest-margin, lowest-setup revenue path. The
product already has a Postgres schema engine, package boundary, and commercial
license artifact. The missing piece is a clear, secret-safe buyer path for
proprietary embedding, hosted redistribution, private builds, and support.

## User Types And Value Proposition

| User type | Trigger | Value proposition |
| --- | --- | --- |
| CTO or founder | Wants to use supaschema inside a proprietary product or internal platform | Get a clear commercial path without replacing the free OSS workflow |
| Platform-vendor owner | Wants to embed schema diff, policy, or typegen behavior | Avoid building a weaker internal Postgres schema engine |
| Agency or consultant | Ships Supabase/Postgres workflows for clients | Clarify redistribution and client-delivery rights |
| Procurement or legal owner | Needs approved terms before adoption | Get a structured commercial inquiry path and scope checklist |

## Actionable Pain Points

- "Can we legally use this in a closed-source product?"
- "Can we embed this in a hosted developer platform without AGPL exposure?"
- "Which APIs are safe to build against?"
- "Do we need a private build, security review, or support agreement?"
- "Where do commercial buyers ask without posting private product details?"

## Market And Client Value

- Public TAM anchor: database automation, `$2.443B` expected in 2025 and
  `$8.0406B` by 2030.
- Supaschema SAM estimate: `0.5%-2%` Postgres/OEM/schema-engine wedge, or about
  `$12M-$49M` current annual spend.
- Client value:
  - `$5k-$25k/year` for commercial internal or proprietary use.
  - `$25k-$150k/year` for OEM or private build.
  - `$150k+` for broad redistribution or platform embedding.
- First-24-month opportunity: `10-40` contracts at `$10k-$75k` ACV produces
  `$100k-$3M` ARR without hosted infrastructure.

## Revenue Generation Model

- Sell annual legal/commercial rights, not local usage.
- Meter by embedding scope, redistribution rights, proprietary products, private
  build needs, and support tier.
- Use quote/contact language until legal, tax, support, and pricing owners
  approve public terms.
- Keep local OSS CLI usage unmetered.
- Do not add license-key enforcement or telemetry to the CLI.

## Current State Evidence

- `LICENSE-COMMERCIAL.md` exists and is included in the package allowlist.
- `package.json` currently declares `AGPL-3.0-only`, while README and license
  copy describe a commercial path. This needs product/legal alignment before
  public sales claims.
- `.github/ISSUE_TEMPLATE/config.yml` disables blank issues, so a generic issue
  instruction is not a reliable buyer path.
- A commercial intake template ALREADY EXISTS: `.github/ISSUE_TEMPLATE/commercial_support.md`.
  It is the canonical buyer-intake owner. Do NOT create a second
  `commercial_license.yml` (that would duplicate the entry point and trip the
  bundle's Shared Stop Condition against duplicate onboarding artifacts). Convert
  this `.md` into a structured YAML issue form in place (rename to
  `commercial_support.yml` with typed fields) or extend the existing `.md` — one
  file, not two.
- `docs/reference/package-boundary.mdx` documents the package boundary and
  maintainer tooling exclusions.

## Upstream Verification Notes

- npm publishing docs require `package.json` metadata for published packages and
  recommend SemVer-compatible versions. Private packages still need content
  review so sensitive or unnecessary files are not published.
- SemVer only works as a customer commitment after the supported public API is
  declared precisely enough for embedders to know what is stable.
- GitHub issue forms are YAML files under `.github/ISSUE_TEMPLATE` with typed
  inputs and validation. A commercial form can collect scope metadata, but it
  must not ask for secrets, private schema dumps, or proprietary product detail
  in a public issue.
- GitHub Marketplace paid apps require a verified publisher and purchase
  lifecycle handling for new purchases, upgrades, downgrades, cancellations, and
  trials. That is not part of the low-setup direct-license path.
- AWS Marketplace private offers can support negotiated pricing and custom
  terms. SaaS contracts and subscriptions require Entitlement Service or
  Metering Service integration plus product integration testing.
- Stripe Payment Links and Quotes can support low-code quote or invoice flows.
  Usage-based subscriptions, renewals, credits, and overages still require a
  billing owner and lifecycle handling.

## Automation And Onboarding Needed

1. Commercial-use classifier:
   - internal business use.
   - proprietary embedding.
   - hosted service use.
   - redistribution to customers.
   - client-delivery or agency use.
   - OEM/private-label use.
2. API/package usage inventory:
   - CLI only.
   - public library exports.
   - package files.
   - generated agent bundle.
   - private internals.
3. Quote inputs:
   - number of proprietary products.
   - redistribution model.
   - internal users or contributing engineers.
   - support expectations.
   - private build or security review needs.
4. Output:
   - license fit result.
   - recommended commercial path.
   - scope checklist for legal review.
   - safe inquiry form payload.

## Automation-First Workflow

Manual sales work should be limited to approving terms and price exceptions.
Everything before approval should be scriptable.

1. Intake form writes a structured `commercial-intake.json` payload.
2. `scripts/commercial/classify-intake.mjs` validates the payload, rejects
   secrets, and classifies use as OSS local use, internal commercial use,
   proprietary embedding, hosted service use, redistribution, or OEM use.
3. `scripts/commercial/package-inventory.mjs` inspects `package.json`, exported
   symbols, package allowlist, docs links, and private-build artifact contents.
4. `scripts/commercial/api-stability-report.mjs` compares public docs against
   exported APIs and produces a supported/unsupported API matrix.
5. A commercial-fit agent reads only the classifier output and API matrix, then
   drafts the buyer summary, quote-scope checklist, and legal review packet.
6. `scripts/commercial/quote-draft.mjs` maps scope to an internal price band and
   renewal template. It does not publish public prices.
7. Human approval is required only for legal terms, final price, non-standard
   redistribution rights, marketplace procurement, and signed agreements.
8. After approval, `scripts/commercial/customer-record.mjs` writes a private
   customer record stub with renewal date, support scope, artifact type, and
   owner.

First automation deliverable:

- a local commercial intake classifier plus Markdown quote-scope packet.

Full automation deliverable:

- intake validation, API/package scan, quote draft, private artifact smoke
  test, renewal record, and approval checklist.

## Implementation Waves

### Wave 1: Public Commercial Funnel

Add or update only public plan-approved surfaces:

- `LICENSE-COMMERCIAL.md`
- `README.md`
- `docs/faq.mdx`
- `docs/docs.json`
- `.github/ISSUE_TEMPLATE/commercial_support.{md,yml}` — the EXISTING canonical
  intake file (see Current State Evidence); extend or convert it, do not add a
  second template.

Verification:

- `npm run docs:lint` exits 0.
- `npm run docs:check` exits 0.
- `npm test -- tests/package-contents.test.ts` exits 0 if package metadata or
  allowlist changes.

### Wave 2: Commercial Fit Automation

Build a questionnaire and local/report-only artifact before any billing code:

- commercial-use classifier.
- package/API inventory checklist.
- redaction and secret-safe intake copy.
- quote-scope fields.

Verification:

- inquiry form accepts no secrets.
- every result routes to one concrete next action.
- no CLI runtime behavior changes.

### Wave 3: OEM Readiness

Audit public APIs before selling embedding support:

- document supported exports.
- identify private/internal exports that embedders must avoid.
- add API stability tests only if public API support changes.

Verification:

- `npm run typecheck` exits 0 if source or export surfaces change.
- public API docs and package boundary docs agree.

## Scope

In scope:

- commercial inquiry docs.
- license path copy.
- issue form.
- commercial-use classifier specification.
- package/API usage inventory.

Out of scope:

- fixed prices.
- legal terms.
- SLA claims.
- billing provider integration.
- license keys.
- telemetry.
- hosted scans.
- customer schema upload.

## Full Rollout Gap Analysis

### Business And Legal Gaps

- Commercial license terms are not approved. Full rollout needs an executed
  commercial license template, order form, renewal terms, termination language,
  support boundaries, and redistribution definitions.
- Public license surfaces do not yet have one canonical commercial statement.
  Full rollout needs `package.json`, `LICENSE-COMMERCIAL.md`, README, FAQ, docs,
  and issue templates to agree.
- Pricing is not approved. Full rollout needs internal price bands, discount
  authority, quote approval rules, renewal uplift policy, and approved public
  wording.
- Procurement is not ready. Full rollout needs W-9 or equivalent vendor
  documents, invoice process, purchase-order handling, tax handling, security
  questionnaire answers, and a private-offer path if enterprise buyers require
  marketplace procurement.
- Marketplace procurement is not ready. GitHub Marketplace would require paid
  app eligibility and purchase-event handling; AWS Marketplace SaaS would
  require entitlement or metering integration. Do not present either as live
  until those operational surfaces exist.
- Support commitments are undefined. Full rollout needs support channel,
  response windows, escalation path, supported versions, vulnerability
  notification path, and explicit exclusions.

### Product Gaps

- Supported embedding APIs are not defined. Full rollout needs a public API
  support matrix that separates stable exports from internal helpers.
- Private build process does not exist. Full rollout needs a repeatable private
  artifact process, version naming, package boundary check, release notes, and
  distribution channel.
- Commercial artifact contents are not specified. Full rollout needs a decision
  on whether customers receive the public npm package only, a private package,
  private source access, private support patches, or signed archives.
- Compatibility policy is missing. Full rollout needs semver rules, deprecation
  windows, supported Node versions, and migration guidance for embedders.
- Public API stability is not declared. Full rollout needs a supported export
  matrix before SemVer can be used as a commercial compatibility promise.
- Private package release hygiene is missing. Full rollout needs package
  content review, package smoke testing, changelog review, and an explicit
  sensitive-file exclusion check before any private package or archive ships.
- Security disclosure and customer communication are not formalized. Full
  rollout needs a private advisory path and customer notification process.

### Automation And Onboarding Gaps

- Commercial-use classifier is not built.
- Package/API usage inventory is not built.
- Commercial inquiry form is not wired to a private workflow.
- Quote checklist is not generated from intake data.
- CRM, private issue tracker, or customer record system is not selected.
- No automated rejection path exists for users who do not need a commercial
  license.
- Quote, invoice, renewal, cancellation, and marketplace purchase-lifecycle
  handling are not built.
- No agent workflow exists for drafting quote packets from validated structured
  intake.

### Implementation Steps To Full Rollout

1. Resolve license metadata and public commercial copy with the legal/product
   owner.
2. Add a secret-safe commercial inquiry page and issue form.
3. Add the commercial-use classifier with six outcomes: OSS local use,
   internal commercial use, proprietary embedding, hosted service use,
   redistribution, and OEM/private-label use.
4. Add package/API usage inventory that flags unsupported internal APIs.
5. Create internal quote templates for internal commercial use, OEM/private
   build, and broad redistribution.
6. Define private build artifact policy and package boundary checks.
7. Add package content review and package smoke tests for any private package or
   signed archive.
8. Define supported public APIs, SemVer compatibility rules, and deprecation
   windows before selling embedding stability.
9. Implement the commercial intake classifier, package/API inventory, and
   commercial-fit agent prompt.
10. Add automated quote draft, invoice handoff, renewal, cancellation, and
   customer-record handling.
11. Add support process, customer notification process, and renewal owner.
12. Add procurement path only after direct quote flow has closed paying
   customers.

### Full-Rollout Exit Criteria

- A buyer can self-classify commercial need without contacting support first.
- A commercial inquiry arrives with enough scope data to quote.
- A quote-scope packet is generated automatically from validated intake.
- Public license copy and package metadata do not contradict each other.
- Private build or OEM customers use documented supported APIs only.
- Private artifacts pass package content review and package smoke tests.
- The support and renewal process is documented before the first annual
  contract is signed.

## Done Criteria

- A commercial buyer can identify whether they need a commercial license.
- A buyer has a secret-safe way to request terms.
- Public copy does not contradict package metadata.
- The free local CLI remains unchanged.
- The package boundary remains enforced.

## Stop Conditions

Stop if:

- legal or package metadata ownership is unresolved.
- the plan requires publishing fixed terms without approval.
- the implementation would add license enforcement to the CLI.
- the buyer path asks for secrets or proprietary schema dumps in public.

## Maintenance Notes

This lane should stay separate from hosted SaaS. Commercial rights can sell
before a control plane exists. Do not let this lane become a dumping ground for
support, billing, or marketplace work.
