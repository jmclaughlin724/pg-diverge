# Plan 013: Monetization Product Roadmap And Execution System

Planned on 2026-06-16 against commit `fb8c461`.

## Purpose

Create the full monetization proposal and execution roadmap for supaschema, expanded beyond the first four revenue ideas. The roadmap answers:

1. What bigger unsolved problem each offer solves.
2. How each offer works alongside or replaces Liquibase, Flyway Enterprise, Bytebase, and Atlas.
3. How revenue scales: seat, project, database, schema size, run count, retention, support, or private procurement.
4. Whether the model should be subscription, usage based, service based, or a hybrid.
5. What must be built for each offer to be used to full potential.
6. What can be used immediately with the repo as it exists today.

This file is an implementation-ready execution plan. It does not itself implement billing, hosted infrastructure, telemetry, license enforcement, or legal terms.

## Task-Creator Execution Record

- Persistent task API: unavailable in this Codex session after tool discovery. This file is the durable fallback task artifact.
- Live progress mirror: `update_plan` tracked active creation progress.
- Multi-agent fan-out: market/context research completed; repo map completed; deeper detail and skeptic agents were replaced by local verification because the session hit the configured agent thread limit.
- Missing named support skills: `worker-prompt-craft`, `lightweight-explorer`, and `team` were not present in the local skill roots, so this plan uses the exposed multi-agent tools, Code Atlas, source reads, and market sources.
- Execution lens: elegant canonical-owner execution.
- Elegant end state: one free OSS CLI and package boundary; one commercial inquiry funnel; one paid product architecture with clear lanes; one canonical owner per paid capability; no duplicate scanners, docs owners, policy engines, or private consumer hooks.
- Protected invariants: keep current AGPL/free local usage, the npm package boundary, public CLI/API behavior unless a deliberate versioned change is approved, no customer-data storage before tenancy and retention owners exist, and no billing/license enforcement in the local CLI.
- Open assumptions: none.
- Resolved assumptions:
  - The repo has no hosted control plane, account model, billing owner, license key path, GitHub App, telemetry pipeline, tenant model, or customer database storage today.
  - Current paid revenue can start from quote/contact, services, commercial license inquiries, evidence packs, audits, and private support without product code.
  - `package.json` currently declares `AGPL-3.0-only`, while `README.md` and `LICENSE-COMMERCIAL.md` describe a dual commercial path. License metadata and public license copy need a legal/product decision before public pricing claims.
  - Current code already has revenue-grade primitives: policy and RLS modeling, live catalog extraction, SARIF/GitHub/JSON reporters, `audit`, `doctor`, `verify`, migration status, provider presets, type/Zod generation, agent bundle install, generated migration guards, and a composite GitHub Action.
  - Liquibase, Flyway Enterprise, Bytebase, and Atlas are not one product category. Supaschema should start as a Postgres schema contract and migration governance layer, then replace narrower incumbent slices only where teams value Git-native Postgres/RLS/agent workflows.
- Scope ledger:
  - Plan-owned changes in this task: this file and `advisor-plans/README.md`.
  - Product execution changes: listed under "Execution Roadmap".
  - Explicitly excluded from this task: pricing publication, legal terms, hosted app code, billing provider integration, GitHub Marketplace submission, AWS Marketplace listing, customer-data ingestion, telemetry, and license enforcement.
- Deferred markers: none.
- Deferral budget: zero. Every monetization lane below has a problem, buyer, implementation path, monetization model, incumbent relationship, and acceptance path.

## Current Product Evidence

Repo-owned capabilities that can become revenue surfaces:

- RLS and policy modeling: `ObjectKind` includes `rls` and `policy` in `src/core.ts`; SQL extraction maps `CreatePolicyStmt` in `src/sql/extract.ts`; live catalog extraction reads RLS and `pg_policies` in `src/catalog.ts`; policy hashes canonicalize policy bodies in `src/sql/facts.ts` and `src/sql/canonical-nodes.ts`.
- CI and PR evidence: `src/check-reporters.ts` renders GitHub annotations, SARIF, JSON, and text reports; `action.yml` wraps `npx supaschema` as a composite Action.
- Drift and migration state: `src/migrations-status.ts` detects pending, ghost, and out-of-order migrations; `src/cli-diff.ts` supports diff gates, summary, watch mode, and lineage checks.
- Adoption and incident diagnostics: `src/audit.ts`, `src/doctor.ts`, `src/verify.ts`, and `src/corpus.ts` provide object coverage, environment checks, idempotence checks, and corpus-level proof.
- Provider setup: `src/config-contract.ts` contains provider presets for Supabase, Neon, RDS/Aurora, AlloyDB, Cloud SQL, Azure PostgreSQL, and generic Postgres; `bin/scaffold.mjs` installs provider-specific project layouts.
- Type contracts: `src/typegen-model.ts`, `src/typegen.ts`, and `src/typegen-zod.ts` share schema shape collection and generate TypeScript and Zod outputs.
- Agent governance: `bin/scaffold.mjs`, `.codex/hooks.json`, `.codex/hooks/auto-diff-on-schema-change.mjs`, and `.codex/hooks/block-generated-migration-edits.mjs` install and enforce local agent migration guardrails.
- Package and enterprise boundary: `package.json` allows runtime, installer, licenses, README, and the consumer agent bundle; `docs/reference/package-boundary.mdx` documents that maintainer tooling stays out of the public package.

Current gaps that block full SaaS monetization:

- No account, organization, tenant, RBAC, SSO, SCIM, audit-log, or entitlement model.
- No billing provider integration, purchase lifecycle handling, tax handling, invoices, usage metering, or plan enforcement.
- No GitHub App, webhook server, installation-token storage, or GitHub Marketplace purchase-event handling.
- No hosted runner, disposable database provisioning, remote secret custody, data-retention policy, customer deletion workflow, or support SLA owner.
- No registry persistence API for schemas, snapshots, reports, or type contracts.

## Market Evidence

Use these market facts as pricing and positioning constraints during execution:

> Pricing re-verified 2026-06-16 in folder `07` Section 2. The Liquibase `$5,000/year` and Flyway `$150,000/year` figures below are HISTORICAL AWS listings, not current: Liquibase now lists no public prices (contact-sales) and Flyway Teams was retired to renewal-only on 2025-05-14. Do not quote either to a buyer. Current public benchmarks are Atlas (`$9/seat`, `$59/project`, `$39/DB`) and Bytebase (`$20/user/mo`).

- Liquibase sells a commercial secure tier with plan limits around applications and database types. A legacy AWS Marketplace listing showed Liquibase Pro at about `$5,000/year` for 10 targets: <https://www.liquibase.com/pricing>, <https://www.liquibase.com/community-vs-secure>, <https://aws.amazon.com/marketplace/pp/prodview-asxd5dbnayzu6>.
- Flyway Enterprise sells enterprise database deployment with policy library, drift/check reports, audit history, and contact-sales pricing. Redgate documents per-contributing-user licensing, and an AWS listing showed a 50-user Enterprise package at `$150,000/year`: <https://www.red-gate.com/products/flyway/enterprise/>, <https://documentation.red-gate.com/fd/how-flyway-per-user-licensing-works-206605237.html>, <https://aws.amazon.com/marketplace/pp/prodview-eyxtrwubfunwq>.
- Bytebase prices cloud Pro at `$20/user/month` with database instance limits, while Enterprise adds SSO, SCIM, audit logs, approvals, masking, and custom scale: <https://www.bytebase.com/pricing/>, <https://docs.bytebase.com/administration/license>.
- Atlas prices around projects, target databases, monitored databases, and developer seats. Public examples include Pro pipeline pricing per project, extra target databases, and schema monitoring per monitored database: <https://atlasgo.io/pricing>, <https://atlasgo.io/cloud/pricing>, <https://atlasgo.io/cloud/features/registry>.
- GitHub code security uses an active-committer style meter; GitHub Marketplace paid apps need a verified publisher, purchase lifecycle handling, and an app surface: <https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file>, <https://docs.github.com/en/apps/github-marketplace/selling-your-app-on-github-marketplace/pricing-plans-for-github-marketplace-apps>, <https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app>.
- Stripe Billing supports subscriptions, usage-based billing, credits, and overages; Stripe charges a billing volume fee for Billing: <https://stripe.com/billing/pricing>, <https://stripe.com/billing/usage-based-billing>.
- AWS Marketplace private offers support negotiated pricing, SaaS contracts, SaaS subscriptions, and custom dimensions such as users, hosts, requests, data, units, or custom units: <https://docs.aws.amazon.com/marketplace/latest/userguide/private-offers-overview.html>, <https://docs.aws.amazon.com/marketplace/latest/userguide/saas-pricing-models.html>.
- Supabase, Neon, and PlanetScale all monetize branching or database resources with compute, storage, branch, resource, and deploy-request style meters: <https://supabase.com/docs/guides/platform/manage-your-usage/branching>, <https://neon.com/pricing>, <https://planetscale.com/pricing>.

## Strategic Positioning

The paid product should be:

> Postgres schema contract and migration governance for Git-native teams.

That position is narrower than Bytebase and less database-generic than Liquibase/Flyway. It is also sharper for Supabase/Postgres teams because supaschema can model policy bodies, RLS, generated types, provider layouts, and agent guardrails as one workflow.

Do not try to beat every incumbent at once. Win by owning problems they only partially solve:

- RLS and policy safety is usually treated as migration text, not as a first class application security contract.
- AI agents now modify database schemas, but most migration tools do not ship agent-specific generated migration guards.
- Git-native teams need CI-quality schema review before a DBA platform rollout.
- Supabase and branch-heavy Postgres users need migration and policy governance that understands preview branches, generated types, local verification, and declarative schema files.
- Small teams need immediate rescue, audits, and release evidence before they are ready for a hosted control plane.

## Highest-Margin Lowest-Setup Filter

Use this filter for the first revenue push. A top-five offer must satisfy all four constraints:

1. It can be sold before hosted infrastructure exists.
2. It does not require billing SDKs, telemetry, license keys, marketplace purchase events, or customer-data storage.
3. It uses existing supaschema capabilities as proof or delivery material.
4. It can turn into repeatable software, subscription, or annual contract value after customer demand is proven.

### Top 5

| Rank | Offer | Why margin is high | Why setup is low | First sale motion | Scalable product path |
| --- | --- | --- | --- | --- | --- |
| 1 | Commercial license and OEM/private-build rights | Annual license revenue has near-zero marginal software delivery cost after legal terms exist | Requires copy, intake, license metadata alignment, and sales handling before product code | "Request a commercial license for proprietary embedding or hosted redistribution" | OEM engine, private builds, enterprise license renewals |
| 2 | RLS and tenant-isolation security review | Specialized security review commands premium pricing and can become a reusable policy pack | Current parser, catalog, policy hashing, audit, check, SARIF, and JSON outputs already exist | "Paid RLS/tenant isolation review for Supabase/Postgres apps" | Paid RLS policy pack, hosted org policy, compliance evidence |
| 3 | Agent database change-control review | AI database guardrails are urgent, specialized, and sellable as an expert review | Current agent bundle, hooks, generated migration guards, and install prompts already exist | "Review and harden your Codex/Claude database migration workflow" | Organization agent governance pack and hosted policy sync |
| 4 | Adoption audit and migration rescue | High-value expert service with no platform build; customers pay to reduce migration risk now | Uses `audit`, `doctor`, `migrations status`, `check`, `verify`, `inspect`, and `fingerprint` | "Supaschema adoption audit or migration rescue assessment" | Evidence bundle command, recurring governance retainer |
| 5 | Release and compliance evidence packs | Standardized proof packages command premium pricing because they reduce audit and release risk | Existing `audit`, `doctor`, `check`, `verify`, `migrations status`, SARIF, JSON, fingerprints, and lineage outputs already provide the raw material | "Release evidence pack for schema change controls and migration readiness" | Evidence bundle command, compliance retention add-on, recurring release governance |

### Per-Proposal Execution Subfolders

Detailed execution handoffs live in `advisor-plans/013-monetization-product-roadmap/`:

- `01-commercial-license-oem/README.md`
- `02-rls-tenant-isolation-security-review/README.md`
- `03-agent-database-change-control-review/README.md`
- `04-adoption-audit-migration-rescue/README.md`
- `05-release-compliance-evidence-packs/README.md`
- `06-seo-aeo-geo-marketing/README.md` (cross-cutting: SEO/AEO/GEO marketing plan for all five offers)
- `07-market-and-value-verification/README.md` (cross-cutting: re-verified market data and pricing, client value-delivered economics, and the meta-plan for executing analysis items 1-5)

The parent roadmap remains the strategy owner. The subfolder index is the proposal-level task system and should be updated when a proposal enters implementation. Each proposal folder also contains upstream verification notes for the official docs or standards that change rollout scope. The subplans now use an automation-first execution model: scripts, local commands, GitHub Actions, structured JSON artifacts, and AI-agent drafting workflows do the repeatable work; humans approve only legal terms, pricing exceptions, destructive operations, customer commitments, and risky waivers.

### Market Size And Client Economics

> Verification status (2026-06-16): these figures were re-verified in `advisor-plans/013-monetization-product-roadmap/07-market-and-value-verification/`. No Tier-1 firm sizes this exact category, so treat every TAM number as an order-of-magnitude positioning anchor. The compliance-software and regulatory-compliance-management anchors are "directional only"; eGRC (`~$70-72B`, corroborated by Grand View and Fortune Business Insights) is the strongest compliance-side anchor. The tables below state price charged (ACV); the client value-delivered (cost-of-pain avoided) per offer lives in folder `07` Section 3 and is the decisive selling argument.

Sizing policy:

- Public TAM is the nearest public market category, not a claim that supaschema can sell to the whole category.
- Supaschema SAM is the estimated current addressable wedge for Postgres schema governance inside that category.
- First-24-month opportunity assumes founder-led sales, no hosted product, and a manual service/license motion.
- ACV means expected first-year contract value per customer, not customer ROI.
- Exact public prices remain quote/contact until license, tax, legal, and support terms are approved.

Public market anchors:

| Anchor | Current public size | Forecast | Why it matters | Source |
| --- | --- | --- | --- | --- |
| Database automation | ~`$2-3B` (2025), order-of-magnitude | ~`$8-13B` by 2030-2032 at ~24-26% CAGR (firms disagree) | Core market for schema automation, migration governance, drift, and database delivery | Second-tier firms only (no Tier-1 sizing): Grand View Research <https://www.grandviewresearch.com/industry-analysis/database-automation-market-report>, SNS Insider, PS Market Research. See folder `07` Section 1 for the spread. |
| Application security testing | `$1.83B` in 2025 | `$7.60B` by 2031 | RLS and tenant isolation sell as application security and DevSecOps controls | MarketsandMarkets, application security testing market: <https://www.marketsandmarkets.com/Market-Reports/application-security-testing-market-147329639.html> |
| AI code tools | `$7.37B` in 2025 | `$29.96B` by 2031 | Agent governance rides the growth of AI coding tools and enterprise demand for controls, audit trails, and governance | Mordor Intelligence, AI code tools market: <https://www.mordorintelligence.com/industry-reports/artificial-intelligence-code-tools-market> |
| Compliance software | `$35.37B` in 2025 (directional only) | `$74.12B` by 2031 | Release evidence packs monetize the shift from episodic audit work to continuous control evidence; figures vary widely by firm (see folder `07` §1) | Mordor Intelligence, compliance software market: <https://www.mordorintelligence.com/industry-reports/compliance-software-market> |
| Regulatory compliance management software | `$12.41B` in 2025 (directional only) | `$19.8B` by 2030 | Narrower compliance anchor; no current Tier-1 source — prefer the eGRC anchor (folder `07` §1) | The Business Research Company, regulatory compliance management software: <https://www.thebusinessresearchcompany.com/report/regulatory-compliance-management-software-global-market-report> |
| eGRC | `$72.4B` in 2025 | `$203.7B` by 2033 | Enterprise buyers already budget for governance, risk, compliance, audit trails, and control monitoring | Grand View Research, eGRC market: <https://www.grandviewresearch.com/industry-analysis/enterprise-governance-risk-compliance-egrc-market> |
| Postgres/Supabase ecosystem | PostgreSQL is the #1 most-used database (55.6% of professional developers) and most-desired/most-admired in the 2025 Stack Overflow survey; Supabase is cited at ~4M+ developers with a `$5.1B` Series E valuation (Oct 2025) | Growing developer and startup adoption | Validates the Postgres/Supabase wedge inside broader database and application-security markets | Stack Overflow 2025 technology survey: <https://survey.stackoverflow.co/2025/technology>. NOTE: the prior "eight million developers" figure is uncorroborated; the ~4M+ count is aggregator-sourced (founder interviews), not audited — replace with a primary Supabase source before public use. See folder `07` Section 1. |

Competitor pricing anchors:

- Bytebase Pro is `$20/user/month`; Enterprise is custom and adds SLA support, custom users/instances, OIDC/LDAP SSO, SCIM, 2FA, and audit logs: <https://www.bytebase.com/pricing/>.
- Atlas (verified 2026-06-16): Pro is `$9/seat/month` (max 50), `$59/CI-CD project/month` (includes 2 target DBs), and `$39/additional-database/month`; Enterprise (min 20 DBs) is contact-sales. This is the best current public benchmark for supaschema's eventual hosted meters: <https://atlasgo.io/pricing>.
- Flyway: per-contributing-user licensing. STALE FIGURE — the `$150,000`/50-user AWS-listing number reflects a retired listing, and Flyway Teams was retired to renewal-only on 2025-05-14; Flyway Enterprise is now contact-sales only. Do not cite the `$150k` figure as current: <https://www.red-gate.com/products/flyway/enterprise/>.
- Liquibase: STALE FIGURE — liquibase.com/pricing now lists tiers with no dollar amounts (contact-sales). The legacy `$5,000`/10-targets AWS listing is uncorroborated and must not ship to buyer-facing copy: <https://www.liquibase.com/pricing>.

See folder `07` Section 2 for the full pricing re-verification. The take-away: Liquibase and Flyway have both gone contact-sales-only, so a transparent self-serve Postgres/Supabase price is a differentiator, not just a feature.

Top-five economics:

| Rank | Offer | Public TAM anchor | Supaschema SAM estimate | Value per client | Revenue model | First-24-month opportunity |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Commercial license and OEM/private-build rights | Database automation: ~`$2-3B` (2025, order-of-magnitude; folder `07` §1) | `0.5%-2%` Postgres/OEM/schema-engine wedge, or about `$12M-$49M` current annual spend | `$5k-$25k/year` for commercial internal/proprietary use; `$25k-$150k/year` for OEM/private build; `$150k+` for broad redistribution | Annual subscription or commercial/OEM contract, metered by embedding scope, redistribution rights, private build, support tier, and number of proprietary products | `10-40` contracts at `$10k-$75k` ACV produces `$100k-$3M` ARR without hosted infrastructure |
| 2 | RLS and tenant-isolation security review | Application security testing: `$1.83B` in 2025 | `0.5%-2%` Postgres/Supabase tenant-isolation wedge, or about `$9M-$37M` current annual spend | `$5k-$15k` one-time review; `$10k-$60k/year` for recurring RLS policy-pack subscription or quarterly reviews | Fixed-scope security review first; then subscription by protected repo/project, active schema contributors, and policy-pack support | `15-50` reviews or subscriptions at `$7.5k-$30k` ACV produces `$112k-$1.5M` with the existing scanner primitives |
| 3 | Agent database change-control review | AI code tools: `$7.37B` in 2025 | `0.25%-1%` database-governance wedge around AI coding tools, or about `$18M-$74M` current annual spend | `$5k-$20k` setup review; `$15k-$75k/year` for ongoing governance pack across agent-enabled repos | Fixed review plus annual subscription by agent-enabled repo, protected project, active schema contributors, and support tier | `10-30` customers at `$10k-$50k` ACV produces `$100k-$1.5M`; demand signal should come from teams already using Codex/Claude/Cursor against DB-backed apps |
| 4 | Adoption audit and migration rescue | Database automation: ~`$2-3B` (2025, order-of-magnitude; folder `07` §1) | `1%-3%` Postgres adoption/rescue wedge, or about `$24M-$73M` current annual spend | `$3k-$12k` assessment; `$10k-$40k` rescue; `$2k-$8k/month` governance retainer after remediation | Fixed-scope service, urgent rescue premium, then monthly retainer or conversion to RLS/evidence subscription | `20-60` engagements at `$5k-$25k` produces `$100k-$1.5M`; best immediate cash generator but less scalable until evidence/rules are productized |
| 5 | Release and compliance evidence packs | Compliance software / regulatory compliance: directional only — lead with eGRC `~$70-72B` (folder `07` §1) | `0.1%-0.5%` database-release evidence wedge, or about `$35M-$177M` using compliance software as the broad anchor | `$2k-$8k` per release pack; `$15k-$75k/year` for recurring release cadence; `$75k-$150k/year` for enterprise evidence plus retention once hosted storage exists | Per-release package first; annual subscription by protected project, release cadence, evidence retention, and auditor/export access | `15-40` customers at `$10k-$40k` annual cadence produces `$150k-$1.6M`; hosted retention comes after the local evidence bundle proves demand |

Revenue model detail:

1. Commercial license and OEM/private build:
   - Sell an annual legal/commercial right, not usage.
   - Invoice by embedding scope, redistribution, support tier, and private build needs.
   - Keep local OSS CLI free. Do not add license-key enforcement in the CLI.
   - Expansion path: OEM renewal, private support, private build, and enterprise procurement.
2. RLS and tenant-isolation security review:
   - Start as a fixed assessment with redacted command outputs and a written security report.
   - Productize repeated findings into a paid RLS policy pack.
   - Meter subscription by active schema contributors, protected projects, and policy-pack support.
   - Expansion path: hosted org policy and compliance evidence.
3. Agent database change-control review:
   - Start as setup/hardening review for agent-enabled repositories.
   - Include generated migration guards, auto-diff/check hooks, sync guardrails, and approval workflow review.
   - Meter ongoing subscription by agent-enabled repo, protected project, and support tier.
   - Expansion path: organization policy registry and hosted policy sync.
4. Adoption audit and migration rescue:
   - Start as fixed-scope assessment or rescue.
   - Price urgent rescue higher than planned adoption.
   - Convert repeat customers to monthly governance retainers or annual RLS and evidence packages.
   - Expansion path: evidence bundle command and drift monitor requirements.
5. Release and compliance evidence packs:
   - Start as per-release proof package generated from existing local commands.
   - Sell recurring release cadence as annual subscription.
   - Add hosted retention only after tenant, deletion, retention, and auditor access models exist.
   - Expansion path: tamper-evident bundle, auditor portal, and retention add-on.

First revenue math:

- First `$100k`: one OEM/private-build deal at `$50k`, three RLS/security reviews at `$10k`, two agent governance reviews at `$7.5k`, and one evidence cadence at `$5k`.
- First `$250k`: two commercial/OEM deals at `$50k`, ten RLS or adoption engagements at `$10k`, three agent governance subscriptions at `$15k`, and one evidence customer at `$5k`.
- First `$1M`: ten commercial/OEM customers averaging `$50k`, twenty RLS/evidence customers averaging `$15k`, ten agent governance customers averaging `$15k`, and five rescue/adoption retainers averaging `$10k/month` for one quarter.

### Launch Bundle

Sell these as one coherent package:

> Supaschema Governance Jumpstart: commercial usage review, RLS/tenant isolation audit, agent migration guardrails, adoption/rescue assessment, and release evidence pack.

This keeps the sales motion simple. A buyer does not need to understand the full portfolio; they buy a safer Postgres migration workflow.

Recommended initial packaging:

- Entry: fixed-scope assessment with redacted local command outputs and one written report.
- Team: assessment plus agent/RLS hardening and one release evidence pack.
- Enterprise: commercial license discussion, governance assessment, private release evidence cadence, and follow-up implementation support.

Use quote/contact language until legal and pricing are approved. Internally, price by scope, urgency, number of repos/databases, release cadence, regulatory pressure, and commercial redistribution risk.

### Why The Other Offers Wait

| Offer | Reason it is not top five now | Keep as |
| --- | --- | --- |
| Enterprise support and procurement | High margin, but requires SLA, legal, security questionnaire, support process, and renewal handling | Add after first paid service customers exist |
| Drift observatory | Strong product value, but needs persistence, retention, alerting, and monitored database model | Convert audit findings into drift product requirements |
| GitHub PR bot | Good subscription potential, but needs GitHub App, webhooks, runner queue, entitlements, and purchase handling | Build after policy pack demand is proven |
| Provider setup packs | Low setup, but lower standalone margin than security, agent governance, and audits | Include inside audits and evidence packs |
| Private training and implementation workshops | Removed from the first revenue push by product decision; also requires curriculum, delivery time, and a sales channel that is not currently the intended motion | Reuse only as documentation and customer enablement |
| Compliance evidence platform | The manual evidence pack is now top five; hosted retention and auditor portal still need persistence, tenancy, and deletion policy | Build after the evidence bundle command proves demand |
| Schema registry | High setup: hosted API, auth, persistence, retention, and UI | Build after evidence artifacts exist |
| Type contract registry | Productizable, but buyer urgency is lower than RLS/security and rescue | Add as later expansion from audits |
| Policy pack marketplace | Needs rule engine, registry, entitlements, review process, and partner contracts | Build after first-party RLS pack works |
| Managed migration sandboxes | Usage revenue potential, but requires provider credentials, cleanup, queueing, and cost controls | Revisit after hosted control plane exists |
| Incident response | High willingness to pay, but implies on-call, SLA, escalation, and customer access policy | Offer only as scheduled rescue until support process exists |

### First 30 Days

1. Align commercial license metadata and public copy.
2. Add commercial/support inquiry pages and secret-safe issue forms.
3. Publish one page for each top-five offer.
4. Create internal report templates for RLS review, agent governance review, adoption audit, migration rescue, and release evidence.
5. Run the top-five offers manually for the first customers.
6. Track repeated findings as product requirements for the RLS policy pack and evidence bundle.

### First 90 Days

1. Convert repeated RLS review checks into a local rule engine and policy pack.
2. Convert repeated audit deliverables into an evidence bundle command.
3. Convert repeated agent governance findings into install verification output.
4. Build lightweight service playbooks and sample redacted reports.
5. Decide whether demand justifies hosted policy subscriptions before starting a GitHub App or registry.

### Automated Experience And User-Type Value Proposition

Automation objective:

Turn a cold visitor into a qualified, secret-safe paid opportunity without manual maintainer triage. The first automated experience should not run a hosted database scan. It should guide the user to run local commands, produce a redacted onboarding bundle, classify the best paid lane, and generate the next action: commercial inquiry, RLS review, agent governance review, adoption/rescue, or release evidence pack.

Core rule:

- Customer secrets, production database URLs, private schema dumps, and raw credentials stay out of public GitHub issues and out of any hosted onboarding path until a tenant, retention, deletion, and secret custody model exists.

#### Automated Onboarding Flow

1. Fit quiz:
   - Ask whether the user is embedding supaschema commercially, securing RLS, using AI agents, adopting from another migration workflow, or preparing release/compliance evidence.
   - Ask provider: Supabase, Neon, RDS/Aurora, Cloud SQL, AlloyDB, Azure PostgreSQL, generic Postgres, or unknown.
   - Ask current migration system: none, Supabase CLI, Flyway, Liquibase, Bytebase, Atlas, Prisma, Drizzle, Rails, Django, custom SQL, or unknown.
   - Ask urgency: planned adoption, upcoming release, failed migration, suspected drift, tenant/security concern, audit request, or commercial embedding.
   - Return one recommended paid lane and one local command to run.
2. Local collector:
   - Add a local command such as `supaschema onboard` or `supaschema evidence collect`.
   - Detect config, provider preset, schema paths, migrations dir, generated type outputs, GitHub Action presence, agent hooks, migration status, validators, and supported object coverage.
   - Detect incumbent tool files such as `flyway.conf`, `liquibase.properties`, `db/changelog/**`, `atlas.hcl`, `supabase/migrations/**`, Prisma schema, Drizzle config, Rails migrations, Django migrations, and custom SQL dirs.
   - Run safe local checks: `doctor`, `audit`, `migrations status`, `check` reporters, `inspect`, `fingerprint`, and optional `verify` only when local disposable database requirements are met.
   - Redact URLs, credentials, tokens, JWTs, service-role keys, hostnames if configured, and user-provided sensitive labels.
3. Score and route:
   - Score commercial risk, RLS risk, agent-governance risk, adoption/rescue risk, and evidence readiness.
   - Generate a short action report with the recommended paid lane, severity, missing setup, and exact next command or inquiry link.
   - Avoid generic "contact us" dead ends. Every result must say what to do next.
4. Paid intake:
   - Create a private-safe inquiry form for each top-five lane.
   - Require the redacted onboarding bundle ID or local report summary.
   - Capture buyer type, urgency, number of repos, number of databases, release cadence, regulatory pressure, commercial redistribution scope, and preferred communication channel.
5. Delivery automation:
   - Generate report templates from the same artifact schema used by the local collector.
   - Generate issue/task lists for remediation.
   - Generate a quote checklist with scoped assumptions, excluded secrets, required customer actions, and acceptance criteria.
6. Productization loop:
   - Track repeated manual findings as named rule-pack checks, evidence fields, or onboarding detectors.
   - Add a detector only when it maps to a repeated pain point and has a clear remediation step.

#### User-Type Value Matrix

| User type | Buying trigger | Actionable pain points | Supaschema value proposition | Automated onboarding needed | Best paid lane |
| --- | --- | --- | --- | --- | --- |
| CTO, founder, or platform-vendor owner | Wants to embed supaschema in a proprietary product, internal platform, hosted service, or client delivery workflow | AGPL/commercial uncertainty blocks adoption; team may build a weak in-house schema diff engine; no clear redistribution rights; no support path for private builds; public API stability is unclear for embedding | Provides a maintained Postgres schema engine with a clean commercial path and private support option while preserving free OSS local use | License-fit questionnaire, redistribution classifier, package/API usage inventory, commercial inquiry form, private-build checklist | Commercial license and OEM/private-build rights |
| AppSec or security engineer | Needs proof that RLS and tenant policies do not regress | RLS coverage is invisible in normal migration review; policy bodies are hard to diff; tenant predicates drift across tables; permissive policies slip into PRs; security review happens after deploy; SARIF lacks Postgres policy context | Turns Postgres RLS into a first-class application security control with repeatable local checks, reportable findings, and CI annotations | RLS scan profile, policy baseline wizard, tenant-key detector, policy diff report, SARIF/GitHub annotations, waiver/severity config | RLS and tenant-isolation security review |
| Platform engineer or DevOps owner | Owns CI gates, migration reliability, and provider setup | Database changes break CI late; generated migrations get hand-edited; provider config differs by repo; migration history has pending/ghost/out-of-order state; drift is found manually; no single report says what to fix | Gives one local Postgres governance workflow for diff, check, verify, migration status, provider presets, and evidence output | Repo/provider detector, migration-system detector, CI readiness score, generated migration guard check, remediation checklist, redacted onboarding bundle | Adoption audit and migration rescue |
| AI tooling owner or agent governance lead | Agents are editing database-backed applications | Agents edit generated migrations directly; agent prompts do not encode schema rules; apply commands can be attempted without human approval; hooks differ across repos; no proof that generated migration protection is installed; agent-authored schema PRs are hard to review | Converts agent database work from prompt trust to deterministic local guardrails and install verification | Agent hook verifier, AGENTS/Claude/Codex rule checker, generated migration guard proof, sync/apply guard detector, suggested patch generator, agent-risk scorecard | Agent database change-control review |
| DBA or database owner | Must protect production schema state while product teams move fast | Live DB diverges from Git; manual hotfixes are not represented in schema intent; existing migrations are hand-authored and inconsistent; initial adoption may lose object ownership context; verification needs safe disposable DB behavior | Builds a migration-state owner map and remediation sequence without asking the DBA to adopt a full portal first | Catalog snapshot import, fingerprint comparison, migration-history analyzer, object coverage report, unsupported-object list, adoption sequence generator | Adoption audit and migration rescue |
| Release manager | Needs a go/no-go packet before release | CI logs are scattered; migration lineage is buried in generated files; check output is not written for release review; database changes lack a durable release artifact; approvals cannot reference one canonical evidence file | Produces a repeatable schema release packet that shows what changed, what passed, what failed, and what lineage applies | `evidence collect` command, release ID metadata, report renderer, hash/signature option, artifact manifest, GitHub release/PR attachment guidance | Release and compliance evidence packs |
| Compliance, GRC, or audit owner | Needs durable proof for SOC 2, HIPAA, fintech, enterprise security review, or internal control testing | Auditors ask for database change-control evidence; CI output is not retained; approvals are disconnected from schema diffs; release evidence is manually compiled; data-control claims are hard to prove without exposing secrets | Converts local schema checks into repeatable, redacted, reviewable control evidence | Evidence schema, redaction proof, retention/export plan, auditor-safe summary, control mapping fields, private upload option after tenancy exists | Release and compliance evidence packs |
| Engineering manager | Wants fewer blocked releases and fewer database incidents | Migration work is risky and hard to estimate; developers do not know whether a schema PR is safe; database review depends on one expert; adoption has no visible finish line; AI-generated changes add review load | Provides a measurable readiness score, remediation list, and repeatable checks that reduce dependency on one database expert | Executive summary, risk score, project/repo rollup, remediation task export, first-30-day implementation checklist | Adoption audit, RLS review, or agent governance review |
| Agency or consultant delivering Postgres/Supabase projects | Needs to standardize client delivery without owning a custom migration framework | Each client repo has different migration habits; RLS reviews are inconsistent; handoff evidence is weak; commercial redistribution terms are unclear; support burden grows after launch | Provides a standard delivery checklist, evidence pack, and commercial path that can be reused across client projects | Client-project intake, provider preset detector, report template, commercial-use classifier, evidence handoff package | Commercial/OEM license, adoption audit, and evidence packs |

#### Offer-Specific Automation Requirements

##### 1. Commercial License And OEM/Private-Build Rights

Manual sale:

- Buyer fills out a commercial use inquiry.
- Maintainer reviews redistribution, embedding, hosted use, support, and private build needs.
- Legal/commercial owner produces quote and terms.

Automated onboarding needed:

1. Commercial-use classifier:
   - Internal business use.
   - Proprietary embedding.
   - Hosted service use.
   - Redistribution to customers.
   - Client-delivery or agency use.
   - OEM/private-label use.
2. API/package usage inventory:
   - Detect whether the buyer uses CLI only, library exports, package files, generated agent bundle, or private internals.
   - Flag unsupported private API reliance.
3. Quote inputs:
   - Number of proprietary products.
   - Internal users or contributing engineers.
   - Distribution model.
   - Support expectations.
   - Private build or security review needs.
4. Output:
   - License fit result.
   - Required commercial path.
   - Suggested contract tier.
   - Scope checklist for legal review.

Specific pain points solved:

- "Can we legally use this in our closed-source product?"
- "Can we embed it in a hosted platform without AGPL exposure?"
- "Which APIs are safe to build against?"
- "Do we need a private build or support agreement?"

##### 2. RLS And Tenant-Isolation Security Review

Manual sale:

- Customer runs local checks and provides a redacted report.
- Reviewer evaluates tenant tables, RLS enablement, policy predicates, policy changes, and migration diff.
- Customer receives findings and fixes.

Automated onboarding needed:

1. RLS scan profile:
   - Detect tables that likely contain tenant/user/org/account boundaries.
   - Detect missing RLS on candidate tenant tables.
   - Detect permissive policy patterns.
   - Detect policy-body changes between intent and catalog.
   - Detect grants that bypass intended policy posture.
2. Baseline wizard:
   - Ask for tenant key names.
   - Ask for shared/system tables.
   - Ask for accepted bypass roles.
   - Ask whether policies are deny-by-default or allow-by-role.
3. Report output:
   - Security severity.
   - Affected table/policy.
   - Suggested SQL or review action.
   - SARIF/GitHub annotation.
   - Waiver and expiration metadata.

Specific pain points solved:

- "Which tables should have RLS but do not?"
- "Which policy changed in this PR?"
- "Does this policy still enforce tenant isolation?"
- "Can AppSec review schema security before deployment?"

##### 3. Agent Database Change-Control Review

Manual sale:

- Customer shares repo setup and agent rules.
- Reviewer checks hooks, generated migration protection, sync policy, and agent instructions.
- Customer receives a guardrail report and patch list.

Automated onboarding needed:

1. Agent readiness command:
   - Verify `.codex/hooks.json`, `.claude/settings.json`, AGENTS guidance, supaschema skill files, and generated migration guard hooks.
   - Verify auto-diff/check hooks exist and do not apply migrations.
   - Verify sync/apply commands require explicit human action.
   - Verify generated migrations with lineage markers are protected.
2. Agent-risk score:
   - Missing guard.
   - Weak instruction.
   - Direct generated migration edit path.
   - Apply command exposure.
   - Missing CI check.
3. Patch generator:
   - Suggest exact docs/rule/hook changes.
   - Avoid overwriting user-owned instructions.
   - Produce a human-reviewable diff.
4. Output:
   - Agent governance report.
   - Installed guard proof.
   - Required remediation list.
   - Evidence pack section for agent controls.

Specific pain points solved:

- "How do we stop agents from hand-editing generated migrations?"
- "How do we prove agents cannot apply production migrations?"
- "Which repos are missing database guardrails?"
- "How do reviewers trust agent-authored schema PRs?"

##### 4. Adoption Audit And Migration Rescue

Manual sale:

- Customer describes current database workflow and pain.
- Customer runs local diagnostics.
- Reviewer produces owner map, risk list, and remediation sequence.

Automated onboarding needed:

1. Migration-system detector:
   - Identify Supabase CLI, Flyway, Liquibase, Atlas, Prisma, Drizzle, Rails, Django, custom SQL, or mixed workflows.
2. State collector:
   - Read supaschema config if present.
   - Read schema paths and migrations dir.
   - Run `doctor`, `audit`, `migrations status`, `inspect`, `fingerprint`, and `check` where applicable.
   - Run `verify` only when local disposable DB conditions are satisfied.
3. Risk classifier:
   - No source-of-truth schema.
   - Generated migration edits.
   - Pending/ghost/out-of-order migration state.
   - Unsupported objects.
   - Drift between live catalog and Git intent.
   - Missing generated types/Zod outputs at runtime boundaries.
4. Output:
   - Adoption readiness score.
   - Current owner map.
   - Remediation sequence.
   - Exact commands to reach green state.
   - Scope estimate for paid rescue.

Specific pain points solved:

- "Can this repo adopt supaschema safely?"
- "What is the source of truth today?"
- "Why do migrations keep failing?"
- "What order should we fix drift, generated files, and schema intent in?"

##### 5. Release And Compliance Evidence Packs

Manual sale:

- Customer runs local release evidence commands.
- Reviewer assembles a release evidence packet.
- Customer stores it with release or audit records.

Automated onboarding needed:

1. Evidence command:
   - Collect commit SHA, config fingerprint, schema fingerprint, migration lineage, audit output, check output, migrations status, verify result, SARIF/JSON report paths, and redaction metadata.
2. Evidence schema:
   - Stable JSON manifest.
   - Human-readable Markdown summary.
   - Optional hash/signature.
   - Optional control mapping fields.
3. Release metadata:
   - Release ID.
   - Environment.
   - Approver.
   - PR or change request link.
   - Migration files included.
   - Known waivers.
4. Output:
   - One release packet.
   - One executive summary.
   - One auditor-safe technical appendix.
   - One remediation list for failed controls.

Specific pain points solved:

- "What proof do we have that this database change was reviewed?"
- "Which checks passed for this release?"
- "Can we show migration lineage without exposing secrets?"
- "Can an auditor understand our database change control from one packet?"

#### Automation Build Order

Build in this order:

1. Static paid-offer pages and secret-safe issue forms.
2. Fit quiz that routes to the five active offers.
3. Local onboarding collector with redaction.
4. Risk scoring and lane recommendation.
5. Report templates for each offer.
6. Evidence bundle schema.
7. RLS scan profile and rule pack.
8. Agent guard verifier.
9. Migration-system detector and adoption readiness score.
10. Quote checklist and CRM/ticket integration.

Do not start with:

- Hosted database scanning.
- Billing integration.
- GitHub App.
- Marketplace listing.
- License-key enforcement.
- Customer schema upload.
- On-call incident response.

#### Activation Metrics

Track these before building hosted infrastructure:

| Metric | Why it matters |
| --- | --- |
| Fit quiz completion rate | Shows whether buyers understand the offer categories |
| Local collector completion rate | Shows whether onboarding is easy enough to run |
| Redacted bundle submission rate | Shows whether customers trust the secret-safe workflow |
| Paid-lane conversion rate | Shows which offer has actual willingness to pay |
| Repeated finding frequency | Shows what should become productized rules |
| Time from first visit to useful report | Measures onboarding friction |
| Percent of reports with a clear next action | Prevents generic diagnostics from becoming shelfware |
| Manual hours per paid report | Shows whether margin improves as automation lands |

## Monetization Architecture

### Free Layer

Keep these free and local:

- CLI: `diff`, `check`, `verify`, `audit`, `doctor`, `migrations`, typegen, and provider init.
- Composite GitHub Action.
- Local SARIF/GitHub/JSON/text report generation.
- Generated migration protection.
- Agent install bundle and local hooks.
- Documentation, examples, and public package.

Reason: this keeps adoption friction low, supports AGPL usage, creates a lead funnel, and gives paid products credible local primitives.

### Paid Layer

Monetize capabilities that require scale, governance, hosted coordination, expertise, procurement, or long-term evidence:

- Hosted policy packs and organization rules.
- RLS/security scanner packs.
- PR review bot and GitHub Checks app.
- Drift observatory and schema registry.
- Type contract registry and breaking-change approval.
- Evidence packs, audit logs, and compliance exports.
- Enterprise SSO, SCIM, private deployments, procurement, and support.
- Commercial/OEM license grants.
- Adoption audits, migration rescue, incident forensics, release evidence, and partner certification.

### Pricing Model

Use subscription first, with usage add-ons where compute or retention creates real cost.

Primary subscription meters:

- Active schema contributors: people who author, review, or approve schema changes. This aligns with Flyway's contributing-user model and GitHub's active-committer style.
- Protected projects or repositories: each repo or logical schema project under policy.
- Target environments or monitored databases: dev, preview, staging, prod, and customer-specific targets. This aligns with Atlas and Liquibase target meters.

Secondary usage meters:

- Hosted check runs above included quota.
- Disposable verification database minutes or branch-hours.
- Retention beyond included report history.
- Schema object count for very large deployments, only as an enterprise sizing signal, not a public self-serve nuisance meter.
- Evidence export volume for compliance-heavy customers.

Avoid these meters for the core product:

- Raw database size or row count. Supaschema is not storing customer data.
- Local CLI run count. Metering local OSS runs would damage adoption.
- Local developer machines. Keep local workflows unmetered.

Internal pricing hypothesis, not public legal terms:

- Free: local CLI, Action, docs, local reports.
- Team: per active schema contributor plus protected project caps.
- Growth: organization subscription with included projects, targets, PR checks, and short retention.
- Business: higher project/target/run limits, drift monitoring, evidence packs, approval workflows, and longer retention.
- Enterprise: annual contract or private offer sized by contributors, protected projects, monitored targets, retention, SSO/SCIM, support response, private deployment, and procurement needs.
- Services: fixed-scope audit/rescue/evidence packages and monthly incident-response or governance retainers.

Public pages should start with "contact" or "request an assessment" until legal, tax, support, SLA, and pricing owners approve exact terms.

## Incumbent Relationship

### Liquibase

Use alongside when a customer has multi-database estate governance, existing Liquibase changelogs, or broad enterprise procurement already in place.

Replace narrower slices when the customer is Postgres-first, Git-native, and wants declarative schema files, RLS/policy safety, generated types, agent guardrails, and local verification without adopting a larger enterprise database-change platform.

Monetization opening: sell Postgres/RLS policy packs, migration evidence, and provider setup around teams that already have Liquibase elsewhere but need a better Supabase/Postgres lane.

### Flyway Enterprise

Use alongside when Flyway remains the approved migration execution engine. Supaschema can run pre-merge policy scans, schema contract checks, and evidence generation before Flyway applies migrations.

Replace narrower slices when teams want declarative-to-migration generation, idempotence verification, RLS policy modeling, and GitHub-native reports without Flyway's broader database deployment platform.

Monetization opening: active schema contributor subscriptions and enterprise evidence packs are familiar to Flyway buyers.

### Bytebase

Use alongside when Bytebase owns approvals, SQL review, access control, masking, or DBA workflows. Supaschema can feed Bytebase reviewed migration SQL and schema evidence from Git.

Replace narrower slices for teams that do not want a full database DevSecOps portal and only need Git-native Postgres schema policy, PR review, generated types, and agent safety.

Monetization opening: per-user plus database-instance pricing is already accepted; supaschema can simplify to contributors plus protected projects.

### Atlas

Use alongside when Atlas Cloud already owns schema registry, monitoring, or multi-language integration. Supaschema can specialize in Postgres declarative SQL, RLS, Supabase-friendly workflows, and agent governance.

Replace narrower slices when a team wants an OSS-first Postgres CLI plus paid hosted registry/drift features, not a broader schema-as-code product.

Monetization opening: project, target database, monitored database, and developer-seat meters are proven. Supaschema can mirror the useful parts while adding RLS and agent governance as differentiation.

## Opportunity Portfolio

### 1. Commercial License And Private Build

Problem solved: teams cannot legally or operationally embed AGPL tooling inside closed commercial products, hosted developer platforms, or private control planes without a clear commercial path.

Buyer: platform companies, devtool vendors, agencies, and enterprises embedding supaschema in proprietary workflows.

Alongside or replace incumbents: complements any incumbent by licensing the engine for proprietary Postgres workflows; replaces internal one-off schema diff engines when a team wants maintained Postgres/RLS modeling.

Revenue model: annual commercial license subscription, OEM contract, private source access, or private build. Meter by product embedding, engineering seats, support tier, and redistribution scope. Do not meter local OSS usage.

Use right away:

1. Fix the commercial inquiry path.
2. Add a structured commercial-license issue template or private contact path.
3. Add docs that define when to request a commercial license.
4. Route all public copy to quote/contact until terms are approved.

Implementation steps:

1. Resolve package/license metadata with legal owner.
2. Update `LICENSE-COMMERCIAL.md`, `README.md`, `docs/faq.mdx`, and docs nav.
3. Add commercial inquiry intake with required use-case fields and secret-safe instructions.
4. Add package boundary checks for private build artifacts if private builds become a recurring release surface.
5. Add CRM or issue triage labels without exposing customer details publicly.

Full potential requires:

- Executed commercial license template.
- Private support policy.
- Release process for commercial artifacts.
- Security disclosure and customer communication path.
- Procurement-ready terms, invoice flow, and optional private marketplace path.

Acceptance path:

- Public user can find the commercial path from README and docs in two clicks.
- Buyer is never instructed to paste secrets or proprietary schemas into public issues.
- Public CLI behavior remains unchanged.

### 2. Enterprise Support And Procurement

Problem solved: larger organizations need accountable support, escalation, security review, procurement paperwork, and version guidance before adopting a schema tool in regulated delivery paths.

Buyer: platform engineering, DevOps, data platform, security, and procurement.

Alongside or replace incumbents: works alongside Liquibase/Flyway/Bytebase/Atlas as support for the Postgres lane; replaces unsupported internal scripts and unowned migration generators.

Revenue model: annual support subscription. Meter by support response tier, number of protected projects, number of active schema contributors, and private deployment needs.

Use right away:

1. Publish a support inquiry path.
2. Offer paid architecture review, migration governance review, and upgrade support without promising SLA until approved.
3. Track inquiries manually.

Implementation steps:

1. Create docs/support surface and intake template.
2. Define support package names internally: advisory, implementation, enterprise support, and incident retainer.
3. Add a private support runbook outside npm package contents.
4. Add release communication process for paying customers.
5. Add private-offer readiness only after pricing, tax, and legal owners approve.

Full potential requires:

- SLA terms.
- Security questionnaire answers.
- DPA/privacy posture for hosted offerings.
- AWS Marketplace or similar private offer listing.
- Customer advisory board and renewal process.

Acceptance path:

- Support buyer has a clear path to request help.
- Public repo does not expose private customer data.
- Package boundary tests continue to exclude maintainer-only support tooling.

### 3. RLS And Policy Security Scanner Packs

Problem solved: Postgres RLS is application security, but migration tools often review it as opaque SQL. Teams need repeatable detection for missing RLS, permissive policies, tenant boundary regressions, unaudited policy changes, and dangerous privilege drift.

Buyer: Supabase teams, SaaS teams with tenant isolation, security reviewers, and platform engineering.

Alongside or replace incumbents: runs before Liquibase/Flyway/Bytebase/Atlas apply migrations; can replace ad hoc SQL linters for Postgres policy safety.

Revenue model: subscription policy pack. Meter by active schema contributors, protected projects, and optional hosted check runs. Enterprise tiers add custom rules and compliance evidence retention.

Use right away:

1. Package a paid manual RLS audit using existing `audit`, `check`, SARIF/JSON, and source/catalog policy extraction.
2. Publish a "tenant isolation review" service page.
3. Use local CLI outputs as deliverables.

Implementation steps:

1. Add a first-class rule engine owner that consumes `SchemaModel`, `MigrationPlan`, diagnostics, and reporters.
2. Add an RLS policy pack with checks for missing RLS on tenant tables, policy-body changes, permissive policy patterns, missing owner bypass review, and inconsistent tenant predicates.
3. Add config for enabling policy packs and severity overrides.
4. Wire pack diagnostics through existing reporters in `src/check-reporters.ts`.
5. Add tests for source SQL, live catalog extraction, generated reports, and SARIF output.
6. Document local free checks versus paid hosted pack behavior.

Full potential requires:

- Custom rule API.
- Organization policy baselines.
- Policy diff UI.
- Waiver/approval workflow.
- Evidence retention and audit export.
- Rule-pack versioning and changelog.

Acceptance path:

- A PR that weakens an RLS policy can fail CI locally and in GitHub annotations.
- A paid team can define an org-level baseline without duplicating rule code.

### 4. Drift Observatory And Migration History Monitor

Problem solved: teams often discover schema drift only after a failed deploy, incident, or manual database patch. The bigger unsolved problem is proving that Git intent, generated migrations, migration history tables, and live database state still agree over time.

Buyer: platform engineering, DBAs, SRE, release engineering.

Alongside or replace incumbents: runs alongside Flyway/Liquibase execution history; can replace lightweight internal drift cron jobs for Postgres-first teams.

Revenue model: subscription plus monitored-database meter. Meter by monitored database or target environment, protected project, retention, and alert volume.

Use right away:

1. Sell drift-readiness audits using `migrations status`, `inspect`, fingerprints, and `doctor`.
2. Produce a manual drift report for early customers.

Implementation steps:

1. Define schema snapshot artifact format and storage contract.
2. Add `supaschema snapshot` or extend existing inspect/report commands if that is the canonical owner.
3. Add drift comparison between stored snapshot, repo intent, migrations, and live catalog.
4. Add scheduled runner design for customer-controlled execution.
5. Add alert outputs: GitHub issue/comment, Slack/webhook, email, and JSON.
6. Add hosted persistence only after tenancy, retention, and deletion policy exist.

Full potential requires:

- Hosted snapshot registry.
- Monitored database inventory.
- Retention policy.
- Drift timeline UI.
- Audit log and notification routing.
- Private network or customer-runner model for databases that cannot expose connection strings.

Acceptance path:

- A customer can see when drift began, which object changed, whether migration history agrees, and which PR or manual change likely caused it.

### 5. GitHub PR Review Bot And Checks App

Problem solved: local CI reports exist, but reviewers need high-signal PR comments, policy decisions, and change summaries without reading raw migration SQL or SARIF artifacts.

Buyer: engineering managers, platform teams, GitHub-heavy product teams.

Alongside or replace incumbents: complements Bytebase approval flows or Flyway pipelines by improving GitHub review; replaces custom GitHub Action scripts and manual migration reviewer checklists.

Revenue model: subscription. Meter by active schema contributors, protected repositories, included check runs, and retention. GitHub Marketplace can be a later distribution channel after app and purchase lifecycle support exist.

Use right away:

1. Position the existing composite Action plus GitHub annotations as the free PR review path.
2. Offer paid PR review setup support and custom policy configuration.

Implementation steps:

1. Design GitHub App installation model.
2. Add webhook endpoint for `pull_request`, `check_suite`, `installation`, and marketplace purchase events when applicable.
3. Store installation tokens securely and rotate them.
4. Run supaschema checks in a controlled runner.
5. Post check runs, annotations, and concise review comments.
6. Add repository settings for policy packs, required checks, and severity mapping.
7. Add billing entitlements before paid enforcement.

Full potential requires:

- GitHub App.
- Hosted runner queue.
- Entitlements.
- Organization settings UI.
- Audit logs.
- Waivers.
- Purchase lifecycle handling.
- Support for private repositories and forks.

Acceptance path:

- A reviewer sees one migration risk summary, one policy decision, and linked evidence for the exact schema change in a PR.

### 6. Agent Database Change-Control Plane

Problem solved: AI agents can edit schema SQL and migrations faster than humans can review them. Teams need deterministic guardrails around what agents may change, when migrations are generated, and how production apply stays human controlled.

Buyer: teams using Codex, Claude Code, Cursor, or internal agents against database-backed apps.

Alongside or replace incumbents: complements all incumbent migration engines by governing agent edits before migration execution; replaces unstructured agent prompts and repo-local safety scripts.

Revenue model: support subscription, governance pack, or enterprise managed policy. Meter by active agent-enabled repositories, active schema contributors, and support tier.

Use right away:

1. Sell an agent migration governance review.
2. Review `.codex/hooks.json`, `.claude/settings.json`, generated migration guards, and install prompts for a customer repo.
3. Produce a written approval map and safety checklist.

Implementation steps:

1. Document paid review scope without changing free hooks.
2. Add evidence-pack output that proves generated migration protection, auto-diff/check hooks, and sync guards are installed.
3. Add optional org policy templates for agent schema work.
4. Add concise enablement material for agent-safe migration workflows.
5. Add hosted policy sync only after account and entitlement models exist.

Full potential requires:

- Organization policy registry.
- Agent-event evidence logs.
- Approval workflow integrations.
- Private rule packs.
- Security review for any hosted agent coordination.

Acceptance path:

- A team can prove agents edit declarative schema only, generated migrations are guarded, apply remains explicit, and CI checks are enforced.

### 7. Compliance Evidence Packs

Problem solved: regulated teams need proof that database changes were reviewed, validated, and tied to source control. Raw CI logs are not durable compliance evidence.

Buyer: regulated SaaS, healthcare, fintech, enterprise platform teams, auditors.

Alongside or replace incumbents: supplements Liquibase/Flyway/Bytebase/Atlas with Postgres-specific evidence; can replace manual spreadsheet evidence for schema change reviews.

Revenue model: subscription add-on. Meter by protected project, evidence export volume, retention period, and auditor access seats.

Use right away:

1. Offer manual adoption or release evidence reports built from `audit`, `doctor`, `check --reporter json`, `check --reporter sarif`, `verify`, and `migrations status`.

Implementation steps:

1. Define evidence bundle schema: source commit, config fingerprint, migration lineage, diagnostics, reporters, verification result, and redaction metadata.
2. Add `supaschema evidence` or an equivalent report mode in the canonical CLI owner.
3. Sign or hash evidence bundles.
4. Add docs for secret-safe collection.
5. Add export formats: JSON, Markdown, PDF through external process, and SARIF references.
6. Add hosted retention and auditor portal only after tenancy exists.

Full potential requires:

- Tamper-evident storage.
- Retention policies.
- Auditor read-only seats.
- Approval workflows.
- Report signing.
- Private customer runners.

Acceptance path:

- A release can produce one evidence bundle that explains what changed, what passed, what failed, who approved, and which migration lineage applies.

### 8. Adoption Audit, Migration Rescue, And Incident Forensics

Problem solved: teams with existing databases often cannot tell what is safe to declare, what is drift, what migrations are hand-edited, and what failure mode caused a broken release.

Buyer: teams adopting supaschema, teams leaving manual migrations, teams recovering from drift incidents.

Alongside or replace incumbents: works with any incumbent as a professional service; replaces internal emergency debugging where no one owns schema state.

Revenue model: fixed-scope service, emergency retainer, or monthly advisory. Meter by database complexity, number of schemas, urgency, and deliverables.

Use right away:

1. Publish audit/rescue service page.
2. Use current local commands as intake and deliverables.
3. Require customers to run commands locally and provide redacted outputs.

Implementation steps:

1. Define safe intake process that never asks for secrets in public channels.
2. Add an audit checklist mapped to `doctor`, `audit`, `migrations status`, `inspect`, `fingerprint`, `check`, and `verify`.
3. Add redaction guidance.
4. Add report template.
5. Add triage labels and private communication process.

Full potential requires:

- Repeatable audit package.
- Private support portal.
- Emergency escalation policy.
- Migration incident runbooks.
- Optional customer-runner bundle for confidential environments.

Acceptance path:

- A customer receives an owner map, risk list, remediation sequence, and verification commands that can be run in their repo.

### 9. Provider Setup Packs And Branch Spend Optimizer

Problem solved: Supabase, Neon, cloud Postgres, and branch-heavy teams need provider-specific schema paths, verification environments, and cost controls. Generic migration tooling often ignores provider branching economics.

Buyer: startups on Supabase/Neon, platform teams standardizing Postgres providers, agencies setting up client projects.

Alongside or replace incumbents: complements any execution engine by standardizing provider setup; replaces internal starter templates and manual branch-cost spreadsheets.

Revenue model: service package first; later subscription add-on. Meter by provider, number of projects, branch verification minutes, and monitored target environments.

Use right away:

1. Sell provider setup reviews and implementation packages around existing `init` provider presets.
2. Offer branch-cost review for Supabase/Neon workflows.

Implementation steps:

1. Document paid provider setup packages.
2. Add provider readiness checks to `doctor` where they are deterministic.
3. Add branch verification cost estimator based on user-provided provider and run frequency.
4. Add templates for CI with preview branches.
5. Add hosted branch verification only after account, billing, and secret custody exist.

Full potential requires:

- Provider API integrations.
- Customer-controlled credentials.
- Branch lifecycle management.
- Cost dashboard.
- Policy limits for branch creation and retention.

Acceptance path:

- A team knows which provider layout to use, how CI verifies branches, and what the expected branch/run cost is before adopting hosted verification.

### 10. Schema Registry And Contract Hub

Problem solved: generated migration files prove history, but organizations lack a living registry of current schema contracts, past snapshots, environment differences, and ownership metadata.

Buyer: platform engineering, service owners, data teams, API governance teams.

Alongside or replace incumbents: complements Atlas registry or Bytebase portal if those own broader workflows; replaces homegrown schema docs, stale diagrams, and environment spreadsheets for Postgres-first teams.

Revenue model: subscription. Meter by protected project, target database, snapshot retention, and read-only viewer seats.

Use right away:

1. Produce manual schema contract snapshots as paid audit deliverables.
2. Use existing inspect/fingerprint/typegen outputs.

Implementation steps:

1. Define registry artifact: object identity, canonical SQL, fingerprints, policy bodies, owners, generated type versions, and source commit.
2. Add local export command or documented JSON output if existing commands already produce enough data.
3. Design API:
   - `POST /v1/projects`
   - `GET /v1/projects`
   - `POST /v1/projects/{project_id}/schema-snapshots`
   - `GET /v1/projects/{project_id}/schema-snapshots`
   - `GET /v1/projects/{project_id}/schema-snapshots/{snapshot_id}`
   - `GET /v1/projects/{project_id}/drift`
4. Add auth with org membership and project roles.
5. Add retention and deletion.
6. Add UI after API and data model stabilize.

Full potential requires:

- Hosted persistence.
- Org/project RBAC.
- Snapshot retention.
- Environment comparison UI.
- API keys for CI uploads.
- Audit logs.
- Import/export contract.

Acceptance path:

- A team can answer: what schema is in prod, what changed last week, which service owns it, and whether staging matches.

### 11. Type Contract Registry And Breaking-Change Gate

Problem solved: generated `database.types.ts` and Zod files are often treated as build artifacts, but application teams need a versioned contract showing when schema changes break runtime code and API expectations.

Buyer: application platform teams, frontend/backend teams sharing schema types, API governance owners.

Alongside or replace incumbents: complements migration engines; replaces unreviewed generated-type diffs and hand-maintained schema compatibility docs.

Revenue model: subscription add-on. Meter by project, generated package, active contributors, and retained versions.

Use right away:

1. Add paid review service for generated type adoption and runtime boundary validation.
2. Use existing typegen/Zod outputs.

Implementation steps:

1. Define type contract version artifact.
2. Add breaking-change classifier for table/column/type/enum/policy changes.
3. Add CI gate that compares generated type contract against mainline.
4. Publish contract to registry or npm/private artifact store.
5. Add docs for application boundary validation with generated Zod.

Full potential requires:

- Version registry.
- Contract consumers and dependency graph.
- Breaking-change approval workflow.
- Generated changelogs.
- Integration with package managers or artifact registries.

Acceptance path:

- A schema PR can say which generated runtime contracts changed and whether the change is backward compatible.

### 12. OEM Engine And Embeddable Library

Problem solved: devtool companies and internal platforms need a maintained Postgres schema engine but do not want to build and maintain parsing, planning, policy modeling, and typegen themselves.

Buyer: platform vendors, internal developer platforms, migration platforms, consultancies.

Alongside or replace incumbents: embeds inside products that may also call Liquibase/Flyway/Bytebase/Atlas; replaces custom internal Postgres diff engines.

Revenue model: OEM license, commercial support, or private engine subscription. Meter by embedding product, redistribution scope, support tier, and annual usage band. Do not meter local OSS CLI.

Use right away:

1. Route OEM users through commercial license inquiry.
2. Offer private architecture review for embedders.

Implementation steps:

1. Audit `src/index.ts` public API and document supported exported surface.
2. Decide which internals remain public, get deprecated, or move behind versioned APIs.
3. Add API stability tests for supported exports.
4. Add embedding docs with examples that avoid internal-only functions.
5. Add private support process for OEM customers.

Full potential requires:

- Public API policy.
- Semver support guarantees.
- Compatibility test suite.
- Commercial build artifacts if needed.
- Private vulnerability communication path.

Acceptance path:

- An OEM customer can embed supported library APIs without relying on internal helpers or undocumented package files.

### 13. Removed From Active Roadmap: Training And Certification

Decision: do not pursue private training, certification, or partner enablement as a revenue lane.

Reason:

- It requires curriculum, delivery time, scheduling, and a sales channel that is not the intended first motion.
- It has lower product leverage than commercial licensing, RLS review, agent governance, adoption/rescue, and release evidence packs.
- Any useful material should exist as documentation, enablement copy, or support collateral for the active paid offers, not as a standalone product.

Disposition:

- Do not add training inquiry pages.
- Do not publish workshop pricing.
- Do not create certification or partner-program surfaces.
- Reuse concise educational material only when it directly supports one of the five active revenue lanes.

### 14. Policy Pack Marketplace

Problem solved: every organization writes slightly different database policies, but the enforcement mechanics are reusable. A marketplace turns compliance, provider, and industry policies into installable packs.

Buyer: security teams, compliance consultants, agencies, and ecosystem partners.

Alongside or replace incumbents: complements incumbent migration tools by selling review logic; replaces copy-pasted SQL review checklists.

Revenue model: revenue share, partner subscription, or enterprise custom pack. Meter by installed protected project, active contributors, and custom support.

Use right away:

1. Sell custom policy-pack development as a service.
2. Keep packs private until the rule engine and versioning exist.

Implementation steps:

1. Build typed rule engine and pack manifest.
2. Add pack versioning, severity mapping, and compatibility metadata.
3. Add pack installation config.
4. Add tests for pack diagnostics and reporters.
5. Add marketplace only after entitlements and billing exist.

Full potential requires:

- Pack registry.
- Entitlements.
- Revenue share contracts.
- Review process.
- Compatibility matrix.
- Security review for third-party code or declarative rules.

Acceptance path:

- A team can install a policy pack and receive deterministic diagnostics without duplicating scanner logic.

### 15. Managed Migration Simulation Sandboxes

Problem solved: migration verification needs realistic disposable databases, but teams do not want to wire branch creation, seed data policy, cost limits, and cleanup for every repo.

Buyer: platform engineering, release teams, Supabase/Neon users, agencies.

Alongside or replace incumbents: complements Flyway/Liquibase deployment by testing before apply; replaces manually managed preview database scripts.

Revenue model: usage-based add-on. Meter by verification run, database minute, branch-hour, retained artifact, and protected project. Subscription tiers should include quotas.

Use right away:

1. Provide setup service for local disposable verification using existing `verify` safety constraints.
2. Review provider branch workflows.

Implementation steps:

1. Keep local verification safe and explicit.
2. Add provider adapter interface for sandbox creation only after provider APIs and credentials model are approved.
3. Add run queue and cleanup guarantees.
4. Add budget caps and branch TTL policy.
5. Add evidence bundles for each simulation.

Full potential requires:

- Provider credentials custody model.
- Private network strategy.
- Run queue.
- Cost controls.
- Cleanup watchdog.
- Usage billing.
- Failure-mode guarantees.

Acceptance path:

- A team can verify a migration in an isolated environment, see cost, and trust cleanup without exposing production credentials.

### 16. Database Change Incident Response

Problem solved: when a schema deploy fails or drift causes an outage, teams need fast forensics and a repeatable recovery sequence. Generic support does not provide a Postgres schema-state incident workflow.

Buyer: production SaaS teams, agencies, platform teams.

Alongside or replace incumbents: works regardless of execution engine; replaces ad hoc emergency debugging.

Revenue model: incident retainer plus hourly overage or fixed emergency package. Meter by response tier, number of covered projects, and incident count.

Use right away:

1. Offer incident forensics retainer to early customers.
2. Use redacted local outputs and screen-share workflow.

Implementation steps:

1. Build incident intake checklist.
2. Define redacted evidence package.
3. Create runbooks for drift, failed apply, generated migration mismatch, and policy regression.
4. Add customer communication policy.
5. Add post-incident report template.

Full potential requires:

- On-call policy.
- SLA and escalation terms.
- Private support system.
- Customer environment access policy.
- Incident knowledge base.

Acceptance path:

- An incident engagement produces a timeline, root cause, remediation, and durable guardrail that prevents recurrence.

## Execution Roadmap

### Wave 0: Decision And Evidence Lock

Objective: align product scope before public claims.

Tasks:

1. Confirm license metadata owner and legal stance for AGPL/commercial wording.
2. Confirm whether public pricing is allowed or contact-only pages are required.
3. Confirm support channels and private customer-data handling.
4. Confirm whether paid services can start before hosted product code.
5. Preserve this plan as the product execution contract.

Acceptance:

- License copy, package metadata, README, and docs do not contradict each other.
- No public surface promises billing, SLA, hosted checks, or legal grants that have not been approved.

### Wave 1: Revenue Usable Immediately

Objective: generate revenue without hosted infrastructure.

Build:

1. Commercial license inquiry path.
2. Support inquiry path.
3. Adoption audit and migration rescue service page.
4. Agent governance review service page.
5. Provider setup package page.
6. Release evidence pack inquiry page.
7. Secret-safe intake templates.
8. Internal service runbooks and report templates.

Canonical owners:

- `LICENSE-COMMERCIAL.md`
- `README.md`
- `docs/faq.mdx`
- `docs/docs.json`
- `.github/ISSUE_TEMPLATE/**`
- `docs/guides/**`
- `docs/coding-agents/**`

Do not build:

- Billing SDKs.
- License keys.
- Hosted check server.
- Customer database upload.
- Marketplace listing.

Checks:

- `npm run docs:lint`
- `npm run docs:check`
- `npm test -- tests/docs-standard.test.ts`
- `npm test -- tests/package-contents.test.ts` if package allowlist changes.

Business acceptance:

- A buyer can request a commercial license, support, audit, rescue, or evidence pack engagement from public docs.
- A maintainer can safely respond without asking for secrets in public.

### Wave 2: Open-Core Security Product MVP

Objective: create the first paid-capable product surface while preserving the free local CLI.

Build:

1. In-process rule engine over `SchemaModel` and `MigrationPlan`.
2. RLS/security policy pack.
3. Config surface for rule packs, severities, waivers, and org baselines.
4. Reporter integration through current GitHub/SARIF/JSON/text renderers.
5. Docs for local free mode, paid pack mode, and CI usage.
6. Tests across source SQL, catalog extraction, reports, and CLI behavior.

Canonical owners:

- `src/core.ts`
- `src/sql/extract.ts`
- `src/catalog.ts`
- `src/check.ts`
- `src/check-reporters.ts`
- `src/config-contract.ts`
- `src/cli.ts`
- `tests/**`
- `docs/guides/rls-policy-migration-safety.mdx`
- `docs/guides/ci-github-actions.mdx`

Checks:

- Targeted unit tests for rules and reporters.
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run docs:lint`

Business acceptance:

- A customer can buy or request a policy-pack engagement.
- The same diagnostics work locally, in CI, and in SARIF.
- Free users still get baseline checks without license-key enforcement.

### Wave 3: Evidence, Registry, And Drift MVP

Objective: turn CLI outputs into durable governance artifacts.

Build:

1. Evidence bundle schema.
2. Evidence command/report mode.
3. Snapshot export artifact.
4. Drift comparison using repo intent, migrations, history table, and live catalog.
5. Local retention folder or customer-controlled artifact upload.
6. API design for hosted registry, without implementing hosted storage until account and retention decisions are done.

API contract:

- `POST /v1/projects`
- `GET /v1/projects`
- `POST /v1/projects/{project_id}/schema-snapshots`
- `GET /v1/projects/{project_id}/schema-snapshots`
- `GET /v1/projects/{project_id}/schema-snapshots/{snapshot_id}`
- `POST /v1/projects/{project_id}/checks`
- `GET /v1/checks/{check_id}`
- `GET /v1/projects/{project_id}/drift`

API rules:

- Use organization-scoped auth.
- Use project-scoped API keys for CI upload.
- Use cursor pagination for list endpoints.
- Use stable error bodies with machine-readable codes.
- Keep database URLs out of stored request bodies.

Canonical owners:

- `src/audit.ts`
- `src/doctor.ts`
- `src/migrations-status.ts`
- `src/source.ts`
- `src/catalog.ts`
- `src/check-reporters.ts`
- `src/cli.ts`
- `src/index.ts`
- `docs/reference/**`
- `docs/commands/**`

Checks:

- Evidence artifact snapshot tests.
- Drift comparison tests.
- CLI report tests.
- Docs checks.

Business acceptance:

- A release can produce evidence that is useful before hosted SaaS exists.
- Hosted registry design is precise enough to estimate build cost and compliance risk.

### Wave 4: Hosted PR Bot And Control Plane

Objective: monetize organization governance at scale.

Build:

1. Account, organization, project, repository, and installation model.
2. GitHub App.
3. Webhook server.
4. Runner queue.
5. Entitlements and plan limits.
6. Hosted policy settings.
7. PR comments, check runs, annotations, and evidence links.
8. Billing integration after entitlement design.
9. Audit log, deletion, retention, and export.

Canonical owner decision:

- Create a separate hosted service package or app only after choosing runtime, database, auth provider, billing provider, tenant model, and deployment provider.
- Do not place hosted-only code inside the npm CLI package unless it is a client SDK with a documented public API.

Checks:

- API contract tests.
- Tenant isolation tests.
- Webhook signature tests.
- Billing entitlement tests.
- Secret redaction tests.
- Package boundary tests.
- End-to-end GitHub App sandbox tests.

Business acceptance:

- A paid organization can install the app, configure policy, receive checks, and manage subscription state without manual maintainer intervention.

### Wave 5: Enterprise And Marketplace Scale

Objective: make the product purchasable by large organizations.

Build:

1. SSO and SCIM.
2. Audit-log retention.
3. Enterprise support terms.
4. Procurement documentation.
5. Private deployment option.
6. AWS Marketplace private offer path.
7. GitHub Marketplace path only if the GitHub App is product-grade.
8. Customer security questionnaire and trust materials.

Checks:

- SSO/SCIM integration tests.
- Audit log immutability tests.
- Data deletion tests.
- Marketplace purchase lifecycle tests.
- Security review.

Business acceptance:

- An enterprise buyer can complete procurement, security review, deployment, and renewal without custom engineering for each deal.

## Scale Monetization Matrix

| Capability | Primary meter | Secondary meter | Model | Why it scales |
| --- | --- | --- | --- | --- |
| Commercial license | Embedding scope | Support tier | Annual subscription | Value grows with proprietary redistribution risk |
| Enterprise support | Protected projects | Response tier | Annual subscription | More projects create more governance burden |
| RLS policy packs | Active schema contributors | Protected projects | Subscription | More contributors create more review risk |
| Drift observatory | Monitored databases | Retention | Subscription plus usage | More environments create more drift states |
| PR bot | Protected repos | Check runs | Subscription plus overage | Review volume scales with PR activity |
| Agent governance | Agent-enabled repos | Support tier | Subscription/service | More agent-edited repos need stricter guardrails |
| Evidence packs | Protected projects | Retention/export volume | Add-on subscription | Compliance value grows with audit surface |
| Rescue/audits | Schema complexity | Urgency | Service/retainer | Expertise scales by project risk, not software usage |
| Provider packs | Projects | Branch/run minutes | Service plus usage | Branch-heavy teams consume setup and compute |
| Registry | Projects | Snapshots/retention | Subscription | History and environment count create storage value |
| Type contracts | Generated packages | Retained versions | Subscription | More app teams depend on schema compatibility |
| OEM engine | Embedding product | Redistribution scope | Annual license | OEM value follows customer product revenue |
| Policy marketplace | Installed projects | Pack support | Revenue share/subscription | Partner packs scale across customers |
| Sandboxes | Verification runs | Branch-hours | Usage plus included quota | Compute cost and value are run-driven |
| Incident response | Covered projects | Incident count | Retainer/overage | Production risk maps to response readiness |

## Product Work Breakdown

### Foundation Tasks

1. License and commercial path alignment.
2. Support and services intake.
3. Secret-safe customer communication rules.
4. Public docs navigation.
5. Internal runbooks for audit, rescue, agent governance, provider setup, and release evidence.
6. Package boundary verification after any public package metadata change.

### Product MVP Tasks

1. Rule engine and RLS pack.
2. Evidence bundle command.
3. Drift snapshot artifact.
4. Type contract artifact.
5. PR review summary format.
6. Local-to-hosted API design.

### Hosted Tasks

1. Tenant model.
2. Auth and org membership.
3. Project/repo/installation model.
4. Secret custody and redaction.
5. Runner queue.
6. Billing and entitlements.
7. Retention and deletion.
8. GitHub App and webhooks.
9. Customer-runner option for private databases.

### Enterprise Tasks

1. SSO.
2. SCIM.
3. Audit logs.
4. Private deployment.
5. Private marketplace offers.
6. Security review pack.
7. Support SLA.
8. Renewal process.

## Enforcement-Surface Ledger

Rule surfaces to update only when behavior changes:

- Root `AGENTS.md` if the paid product changes repo-wide workflow.
- `.claude/rules/supaschema.md` and matching Codex rules if schema workflow guardrails change.
- Docs standard guard if new docs components or navigation patterns are added.
- Package boundary docs and tests if package contents, license files, or public APIs change.
- Release guards if package metadata, action version surfaces, or marketplace surfaces change.

Hook and guard surfaces:

- Generated migration edit protection must remain enabled.
- Auto-diff/check hooks must remain local and must not apply migrations.
- CI guards must run the same deterministic checks as local guards.
- New hosted code must add tenant, auth, secret, and billing tests before public launch.

Skill and documentation surfaces:

- Supaschema skill updates are required if paid policy packs alter schema-change workflow.
- Coding-agent docs must distinguish free local hooks from paid reviews or hosted governance.
- Commercial and support docs must avoid fixed terms until legal approval.

## Stop Conditions For Product Execution

Stop before implementation if:

- A change would add telemetry, license-key checks, billing SDKs, or hosted customer-data storage to the local CLI without explicit approval.
- A hosted feature lacks an auth, tenant, retention, deletion, and secret custody design.
- A commercial claim conflicts with package license metadata.
- A service page asks customers to paste secrets or private schema dumps into public issues.
- A marketplace path is attempted before app purchase lifecycle handling exists.
- A paid feature duplicates the free scanner, reporter, registry, or policy engine instead of extending the canonical owner.

## Immediate Use Checklist

This is the shortest revenue path that can be used before hosted code exists:

1. Resolve license copy and metadata.
2. Add commercial/support inquiry pages.
3. Add secret-safe GitHub issue forms.
4. Publish service pages for adoption audits, migration rescue, agent governance review, provider setup, and release evidence packs.
5. Create internal report templates for audit, rescue, RLS review, drift review, provider setup, agent governance, and release evidence.
6. Run `audit`, `doctor`, `migrations status`, `check --reporter json`, `check --reporter sarif`, `verify`, `inspect`, and `fingerprint` as the first paid deliverable toolkit.
7. Convert repeated paid service findings into rule-pack checks.
8. Convert repeated rule-pack demand into hosted policy subscriptions.
9. Convert repeated hosted policy demand into registry, drift, PR bot, and enterprise procurement features.

## Validation Plan

For this proposal artifact:

- `git diff --check`
- Section-presence check for this roadmap file.
- `git status --short`

For Wave 1 docs/service implementation:

- `npm run docs:lint`
- `npm run docs:check`
- `npm test -- tests/docs-standard.test.ts`
- `npm test -- tests/package-contents.test.ts` if package metadata or package allowlist changes.

For Wave 2 product implementation:

- Targeted rule-pack tests.
- Reporter snapshot tests.
- CLI tests.
- `npm run typecheck`
- `npm run lint`
- `npm test`

For hosted waves:

- API contract tests.
- Tenant isolation tests.
- Secret redaction tests.
- Webhook signature tests.
- Entitlement and billing tests.
- Data retention/deletion tests.
- Security review.

## Implementation Order

Recommended order:

1. Wave 0: license and product decision lock.
2. Wave 1: immediate services and inquiry funnel.
3. Wave 2: RLS/security scanner packs.
4. Wave 3: evidence bundles, registry artifacts, and drift.
5. Wave 4: GitHub PR bot and hosted control plane.
6. Wave 5: enterprise procurement, marketplace, private deployment, and partner ecosystem.

Do not skip Wave 1. It validates willingness to pay and creates customer evidence before expensive hosted work.

Do not skip Wave 2. Hosted governance without a differentiated policy engine is too easy to compare directly against incumbents.

Do not skip Wave 3. Enterprise buyers need evidence, retention, and drift history before they pay for a control plane at scale.
