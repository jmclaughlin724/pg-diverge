# Proposal 07: Market Verification, Client Value-Delivered, And Execution Of Items 1-5

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: This is a verification and economics-deepening layer, not
> a second strategy owner. The parent roadmap
> (`advisor-plans/013-monetization-product-roadmap.md`) stays the canonical
> monetization strategy owner; the five proposal folders stay the canonical
> per-offer owners. This file (a) re-verifies the market numbers those surfaces
> already cite and flags corrections, (b) adds the missing
> client-value-delivered/ROI dimension, and (c) outlines how to execute the
> user's analysis items 1-5. Apply the corrections below to the parent roadmap;
> do not duplicate the strategy text here.

## Why This File Exists

The user asked to (1) itemize real market size, opportunity, per-client value,
and revenue model; (2) define automation/onboarding and value props per user
type; (3) define actionable pain points; (4) build the SEO/AEO/GEO plan; (5)
list gaps and implementation steps; (6) verify everything against upstream; and
(7) outline the steps to implement items 1-5.

Senior-advisor disposition after reading the existing bundle:

- Items 2, 3, and 5 are already well-covered in the five proposal folders and
  the parent roadmap. They do not need rewriting; they need the verification and
  value layer below.
- Item 1 is present but measured only **top-down** (a percentage of a public
  TAM) and only as **price charged** (ACV). It was missing **bottom-up sizing**
  and **value delivered to the client** (the cost-of-pain a buyer avoids). This
  file adds both.
- Item 4 (SEO/AEO/GEO) was entirely absent. It is owned by the sibling folder
  `06-seo-aeo-geo-marketing/`.
- Item 6 (upstream verification) was partial. Market figures cited sources but
  were not re-checked for currency or firm-to-firm disagreement. This file does
  that and flags every number that does not hold.
- Item 7 had no owner. It is the last section here.

## 1. Market Size Re-Verification (Item 1 + Item 6)

Verified 2026-06-16 against the named research firms and vendor pages. Confidence
key: HIGH = named reputable firm with explicit number and year; MED = plausible
but single-source or older; LOW = speculative or only aggregator-sourced.

> Sizing caveat that must travel with every number below: no Tier-1 firm
> (Gartner, IDC, Forrester) publishes a standalone "database DevOps / migration
> governance" market. Every database-automation and compliance figure is a
> second-tier-firm extrapolation with a wide spread. Treat all TAM numbers as
> order-of-magnitude positioning anchors, never as a defensible revenue forecast.

| Anchor | Roadmap's current claim | Re-verified finding (2026-06-16) | Confidence | Action |
| --- | --- | --- | --- | --- |
| Database automation | `$2.443B` 2025 -> `$8.0406B` 2030 (Grand View) | Range across firms: SNS Insider `$2.1B` (2024) -> `$13.3B` by 2032 (CAGR ~25.6%); PS Market Research endpoint `$8.85B` by 2030. The exact `$2.443B`/`$8.04B` pair was not reproducible from a current Grand View page. | MED | Keep as order-of-magnitude; relabel source as "second-tier firms, ~`$2-3B` 2025, ~24-26% CAGR" and stop attributing a single precise pair |
| Application security testing | `$1.83B` 2025 -> `$7.60B` 2031 (MarketsandMarkets) | MarketsandMarkets narrow scope supports ~`$1.83B` 2025 -> `$7.6B` 2031. Other firms put 2025 at `$4B-$11B` (broader SAST/DAST/IAST/RASP/API scope). | MED | Keep, but annotate "narrow MarketsandMarkets scope; broader-scope firms cite `$4-11B`" |
| AI code tools | `$7.37B` 2025 -> `$29.96B` 2031 (Mordor) | Mordor ~`$7.4B` (2025) -> ~`$26B+` by 2030 (CAGR ~26.6%). Spherical Insights is far more conservative (`$3.7B` 2024). Copilot alone: ~20M users, ~1.3M paid, ~42% share (mid-2025). | MED | Keep Mordor figure; add the Copilot adoption proof point as the concrete signal |
| Compliance software | `$35.37B` 2025 -> `$74.12B` 2031 (Mordor) | Business Research Insights puts it far higher: `$60.4B` (2025) -> `$229B` by 2035. Scope definitions diverge wildly. | LOW | Demote to "directional only"; pick one firm and state the scope, or drop in favor of the eGRC anchor |
| Regulatory compliance mgmt software | `$12.41B` 2025 -> `$19.8B` 2030 | No clean current primary source found; most recent standalone report (IndustryARC) covers 2020-2025 and is dated. | LOW | Stop citing as current; fold into eGRC or compliance-software anchor |
| eGRC | `$72.4B` 2025 -> `$203.7B` 2033 (Grand View) | Confirmed: Grand View `$72.4B` (CAGR ~13.7%); Fortune Business Insights `$70.4B` (CAGR ~15.5%). IMARC's narrower GRC-platform subset `$49.2B` (2024). | MED-HIGH | Keep; this is the strongest compliance-side anchor |
| Postgres / Supabase adoption | "PostgreSQL top SO database; Supabase reported **8M developers** in 2026" | PostgreSQL #1 most-used DB, **55.6%** of professional developers (2025 Stack Overflow), most desired + most admired. Supabase: **4M+ developers**, ~`$70M` ARR, `$5.1B` valuation (Series E, Oct 2025) per aggregators citing founder interviews. | HIGH (Postgres rank); MED (Supabase figures) | **Correct the "8M" claim** — verified sources point to ~4M+; cite Supabase numbers as aggregator-sourced, not audited |

### Corrections applied to the parent roadmap (all done 2026-06-16)

These were applied to `advisor-plans/013-monetization-product-roadmap.md` and the
bundle index. An executor does not re-apply them — it only guards against
regression (see Validation Gates):

1. APPLIED — Supabase "eight million developers in 2026" replaced with "~4M+
   developers (aggregator-sourced; not audited)", flagged to replace with a
   primary Supabase source before public use.
2. APPLIED — the database-automation table row no longer asserts a single precise
   `$2.443B`/`$8.0406B` pair; it shows the order-of-magnitude band (~`$2-3B`
   2025, ~`$8-13B` by 2030-2032) and names the firm spread.
3. APPLIED — compliance-software and regulatory-compliance anchors demoted to
   "directional only" (caveat block); eGRC (`$70-72B`) leads the compliance
   story.
4. APPLIED — the "no Tier-1 firm sizes this exact category" caveat is in the
   market-section banner; the stale Liquibase `$5k` / Flyway `$150k` AWS-listing
   figures are flagged HISTORICAL in both the Market Evidence prose and the
   competitor-pricing subsection.

## 2. Competitor Pricing Re-Verification (Item 1 + Item 6)

| Vendor | Roadmap's current claim | Re-verified finding (2026-06-16) | Confidence |
| --- | --- | --- | --- |
| Liquibase | "Pro ~`$5,000/yr` for 10 targets (legacy AWS listing)" | liquibase.com/pricing now shows four tiers (Starter/Growth/Business/Enterprise) with **no dollar amounts**. The `$5,000/yr` figure is an uncorroborated aggregator number from a retired AWS listing. | LOW |
| Redgate Flyway | "Enterprise `$150,000/yr` for 50 users (AWS listing); per-contributing-user" | **Flyway Teams was retired to renewal-only on 2025-05-14.** Last public Teams price was ~`$591/user/yr` (ComponentSource, historical). Flyway Enterprise is now **contact-sales only**; the `$150k/50-user` figure is a stale AWS listing. | MED (model), LOW (current price) |
| Bytebase | "Pro `$20/user/month`; Enterprise custom" | Confirmed: Community free (<=20 users, 10 instances); **Pro `$20/user/mo`** (10 instances); Enterprise contact-sales (SSO/SCIM/audit/masking). | HIGH |
| Atlas / Atlas Cloud | "prices around seats, projects, monitored DBs" (no figures) | Now explicit: Starter free (1 project); **Pro `$9/seat/mo`** (max 50), **`$59/CI-CD-project/mo`** (incl. 2 target DBs), **`$39/additional-DB/mo`**; Enterprise min 20 DBs, contact-sales. | HIGH |

### What the pricing re-check changes

- Atlas is the most directly comparable public price grid and is the best
  external benchmark for supaschema's eventual hosted meters: `$9/seat`,
  `$59/project`, `$39/DB`. Use these as the pricing-sanity anchor.
- Liquibase and Flyway have both gone dark on public pricing (contact-sales).
  That is a tailwind: a transparent, self-serve price for the Postgres/Supabase
  wedge is a differentiator, not just a feature.
- Remove the stale `$5k`/`$150k` AWS-listing figures from any buyer-facing copy;
  they are historical and will not survive a procurement fact-check.

## 3. Client Value-Delivered / ROI Per Offer (Item 1 — the missing dimension)

The existing economics tables state **what supaschema charges** (ACV). They do
not state **what the buyer avoids** by paying. For high-consideration B2B
security/compliance buyers, value-delivered is the decisive selling argument.
The anchors below are verified cost-of-pain figures; the ROI framing converts
each offer's price into a multiple of avoided loss.

Verified cost-of-pain anchors (all HIGH confidence unless noted):

- Average data breach: **`$4.44M`** global (IBM 2025, down from `$4.88M` 2024);
  **`$10.22M`** US (record). Multi-environment breaches (closest public proxy
  for multi-tenant SaaS) **`$5M+`**, 283-day lifecycle. Stolen credentials /
  access-control are the top breach class. Shadow/ungoverned AI adds **`$670K`**
  per breach; extensive security-AI controls save **`$1.9M`**. <https://www.helpnetsecurity.com/2025/08/04/ibm-cost-data-breach-report-2025/>
- Downtime: **90%+** of mid/large enterprises put a single outage hour above
  **`$300K`**; 41% at `$1M-$5M+`/hr; Gartner baseline ~**`$5,600/min`**
  (`$336K/hr`). <https://itic-corp.com/itic-2024-hourly-cost-of-downtime-report/>
- Failed migrations: 47% of migration projects report a major post-migration
  outage; GitHub itself had a platform-wide June 2025 outage from a "routine
  database migration." (MED — aggregated.) <https://gitnux.org/cloud-migration-failure-statistics/>
- AI-agent DB destruction (documented 2025-2026): a Cursor/Claude agent deleted a
  production database **and its backups in ~9 seconds**; Replit's agent deleted a
  production database in a public session. (Qualitative incidents; no aggregate
  defect rate exists.) <https://www.red-gate.com/simple-talk/ai/vibe-coding-and-databases-the-hidden-risks-of-ai-generated-database-code/>
- RLS misconfiguration epidemic: a scan of AI-built Supabase apps found **10.3%**
  with exploitable RLS bypasses exposing PII; CVE-2025-48757. <https://vibeappscanner.com/supabase-row-level-security>
- SOC 2 Type II: **`$30K-$150K`** all-in first year; **100-600 engineer-hours**
  of evidence gathering (`$20K-$150K` opportunity cost). ISO 27001 **`$15K-$250K+`**. <https://secureframe.com/hub/soc-2/audit-cost>
- Alternative human cost: senior DBA fully-loaded **`$150K-$196K/yr`**
  (`$72-$94/hr`); AppSec engineer **`$190K-$236K/yr`** (`$91-$113/hr`);
  independent senior DB/security consultant **`$1,200-$4,800/day`**. <https://www.glassdoor.com/Salaries/senior-database-administrator-salary-SRCH_KO0,29.htm>

Per-offer value-delivered model:

| Offer | Price (ACV) | Primary loss it averts | Verified anchor | ROI framing for the buyer |
| --- | --- | --- | --- | --- |
| 1. Commercial / OEM license | `$5k-$150k+/yr` | Building and maintaining a worse in-house Postgres schema engine; AGPL legal exposure in a closed product | 1 engineer-year of a worse engine ~= `$190k-$236k` loaded; legal risk is open-ended | License at a fraction of one in-house engineer-year, with legal certainty as the real product |
| 2. RLS / tenant-isolation review | `$5k-$15k` review; `$10k-$60k/yr` pack | One multi-tenant data-isolation breach | Multi-environment breach `$5M+`; 10.3% of AI-built Supabase apps already exploitable | A `$10k` review vs. a `$5M` breach is ~500x on a single avoided incident; cheaper than 6 weeks of an AppSec hire |
| 3. Agent DB change-control | `$5k-$20k` review; `$15k-$75k/yr` | One AI agent destroying or corrupting a production database | Prod-DB+backup deletion in 9s; downtime `$336k/hr`; ungoverned AI adds `$670k`/breach | A year of governance costs less than one hour of the outage it prevents |
| 4. Adoption audit / migration rescue | `$3k-$40k`; `$2k-$8k/mo` retainer | A failed migration outage and an unowned source-of-truth | Outage hour `$300k+`; 47% of migrations hit a major outage; DBA hire `$150k-$196k/yr` | A `$25k` rescue vs. one outage hour, delivered faster than hiring a DBA |
| 5. Release / compliance evidence packs | `$2k-$8k/release`; `$15k-$75k/yr` | 100-600 engineer-hours of manual audit evidence gathering per cycle | SOC 2 all-in `$30k-$150k`; evidence labor `$20k-$150k` | Eliminates `$30k-$75k` of engineer evidence time per audit cycle for a `$15-75k/yr` subscription |

This table is the answer to "value of each potential client": each buyer's
willingness to pay is anchored not to supaschema's cost but to a six-to-seven-
figure avoided loss. It belongs in sales copy and in the per-offer proposal
folders' value sections.

## 4. Bottom-Up SAM Framework (Item 1 — adds to the top-down estimate)

The existing SAM is top-down (a fixed percentage of TAM). A bottom-up estimate
multiplies addressable accounts by ACV. Precise account counts are not publicly
knowable, so this is an explicit **framework with stated assumptions**, not a
false-precision number. Fill the inputs with real funnel data once the inquiry
pages exist.

```
Bottom-up SAM (per offer) =
  (addressable companies) x (share with the acute pain) x (annual win rate) x (ACV)
```

Worked illustration for Offer 2 (RLS review), with assumptions labeled:

- Addressable companies: Postgres/Supabase teams running multi-tenant production
  apps. Anchor: Supabase has 4M+ developers; assume ~1% are companies with a
  real multi-tenant compliance/security need = a few thousand accounts (ASSUMED).
- Share with acute pain now: a fraction prioritizing tenant-isolation review in a
  given year (ASSUMED low, e.g., 5-10%).
- Annual win rate at founder-led sales (ASSUMED single-digit %).
- ACV: `$7.5k-$30k` (from the verified per-offer table).

The output is a range, not a point. The discipline that matters: every input is
labeled ASSUMED until replaced by funnel data (fit-quiz completions, inquiries,
close rate). This converts SAM from a marketing number into an operating model.

> Do not publish bottom-up SAM as a precise figure. Publish the framework and the
> top-down band together, and update the inputs from the activation metrics the
> parent roadmap already defines.

## 5. Consolidated Cross-Proposal Gap Rollup (Item 5)

Each proposal folder has a thorough per-offer gap analysis. What was missing is
the **cross-cutting** view: the shared primitives that, if built once, unblock
multiple offers. Build these in dependency order; they are the true critical
path.

| Shared gap (build once) | Unblocks offers | Status today | Canonical owner to extend |
| --- | --- | --- | --- |
| Typed in-process rule engine over `SchemaModel` + `MigrationPlan` + reporters | 2 (RLS), later 14 (pack marketplace) | absent | `src/check.ts`, `src/check-reporters.ts` |
| Redaction + secret-forbidden intake validator (shared) | 2, 3, 4, 5 | partial (redaction exists in diagnostics) | `src/` redaction path + a new intake schema |
| Local evidence/bundle manifest + Markdown renderer | 3 (agent evidence), 4 (rescue bundle), 5 (release pack) | absent | reuse `src/check-reporters.ts`; do not fork a second reporter |
| Structured intake JSON schemas + agent prompt templates | 1, 2, 3, 4, 5 | absent | new `scripts/` intake owners |
| Migration-system detector (incumbent fingerprinting) | 4 (rescue), onboarding flow | absent | `src/doctor.ts` / new onboarding owner |
| GitHub Action wrappers around the above | 2, 3, 5 (CI delivery) | composite Action exists | `action.yml` |

The single most leveraged build is the **shared evidence/manifest renderer**: it
is the common output for offers 3, 4, and 5 and must reuse the existing reporter
owner rather than spawn a parallel reporting system (a STOP condition in three of
the five proposals).

## 6. Upstream Verification Status (Item 6)

| Domain | Where verified | Status |
| --- | --- | --- |
| Market sizes + competitor pricing | Section 1-2 above | Re-verified; corrections listed |
| Client cost-of-pain | Section 3 above | Verified against IBM, ITIC, Secureframe, Glassdoor, CVE-2025-48757 |
| PostgreSQL RLS semantics | proposal `02` Upstream Verification Notes | Already verified against PostgreSQL docs |
| npm / SemVer / GitHub / AWS Marketplace / Stripe | proposal `01` | Already verified |
| NIST SSDF / provenance / transcripts | proposal `03` | Already verified |
| pg_dump / restore-safety / globals | proposal `04` | Already verified |
| SARIF subset / attestations / OWASP ASVS | proposal `05` | Already verified |
| SEO / AEO / GEO / llms.txt / schema.org | sibling folder `06-seo-aeo-geo-marketing/` | Verified there |

No remaining unverified claim should ship to buyer-facing copy. The two stale
items to purge are the Liquibase `$5k` and Flyway `$150k` AWS-listing prices and
the Supabase "8M developers" figure.

## 7. Steps To Implement Items 1-5 (Item 7)

This is the meta-execution plan: how to turn the analysis (items 1-5) into
maintained, shippable artifacts. It is process, not product code.

### Step 1 — Lock the verified economics (items 1, 6) — DONE 2026-06-16

1. DONE — the Section 1-2 corrections are applied to the parent roadmap and bundle
   index (Supabase count, stale prices, demoted anchors, precise-pair band). See
   "Corrections applied" above. Residual scope: none to re-apply.
2. Single-owner, not propagation — Section 3 is the canonical value-delivered
   owner; proposal folders and marketing copy reference it rather than copy the
   table, so avoided-loss figures stay in one place.
3. DONE — the bottom-up SAM framework (Section 4) sits next to the top-down
   estimate with inputs labeled ASSUMED.
4. Owner: roadmap maintainer. Verification: the Validation Gates content
   assertions below (no stale figure survives); `git diff --check`.

### Step 2 — Freeze the per-user-type value + pain matrices (items 2, 3)

1. The parent roadmap's User-Type Value Matrix and each proposal's pain-point
   list are the canonical owners; do not duplicate them in marketing copy.
2. Marketing copy (folder `06`) references them by linking, so a value-prop edit
   has one source of truth.
3. Owner: roadmap maintainer + marketing. Verification: each value claim in `06`
   traces to a proposal-folder pain point or the matrix.

### Step 3 — Ship the SEO/AEO/GEO program (item 4)

1. Execute folder `06-seo-aeo-geo-marketing/` in its own wave order (foundation
   -> page builds -> content -> measurement).
2. Gate every page through `npm run docs:lint` and `npm run docs:check`; new
   docs components must pass `tests/docs-standard.test.ts`.
3. Owner: marketing + docs. Verification: docs gates green; structured-data and
   llms.txt checks defined in `06`.

### Step 4 — Convert the gap rollup into a build backlog (item 5)

1. Take Section 5's shared-primitive table as the engineering critical path.
2. Build the shared rule engine, redaction/intake validator, and evidence
   manifest renderer **before** any per-offer productization, because three
   offers depend on each.
3. Each shared primitive is a separate plan with its own tests; reuse canonical
   owners (`src/check-reporters.ts`, `src/check.ts`, `action.yml`) and never fork
   a parallel reporter/scanner.
4. Owner: engineering. Verification: `npm run typecheck`, `npm test`,
   `npm run lint`, package-boundary tests when allowlist changes.

### Step 5 — Close the loop with activation data

1. Wire the activation metrics already defined in the parent roadmap (fit-quiz
   completion, collector completion, paid-lane conversion, repeated-finding
   frequency).
2. Feed real funnel numbers back into the bottom-up SAM inputs (Section 4) and
   into which shared primitive to build next (the most-requested finding wins).
3. Owner: founder/PM. Verification: each ASSUMED input in Section 4 replaced by a
   measured value.

### Sequencing

```
Step 1 (economics) ─┬─> Step 2 (value/pain freeze) ─> Step 3 (marketing, folder 06)
                    └─> Step 4 (shared-primitive backlog) ─> Step 5 (activation loop)
```

Steps 1, 2, and 4 can start immediately and in parallel (all are analysis/doc or
backlog work). Step 3 depends on Step 2 (so marketing copy links a single value
source). Step 5 depends on Steps 3 and 4 producing surfaces that emit metrics.

## Scope

In scope: market/pricing re-verification, client value-delivered model,
bottom-up SAM framework, cross-proposal gap rollup, item 1-5 execution outline,
and the corrections list for the parent roadmap.

Out of scope: rewriting the parent roadmap or the five proposal folders;
publishing prices or terms; any product code; any hosted/billing/telemetry path.

## Validation Gates

- `git diff --check -- advisor-plans/013-monetization-product-roadmap` (whitespace
  only — does not prove content correctness).
- Section-presence check: this file contains sections 1-7.
- **Content regression assertions** (these, not whitespace, prove the corrections
  hold — run from repo root):
  - No uncaveated Supabase 8M figure survives:
    `grep -rn "eight million\|8M developers" advisor-plans/013-monetization-product-roadmap*` returns
    only lines that also say "uncorroborated"/"not audited" (or nothing).
  - No precise database-automation pair is asserted as fact:
    `grep -rn '\$2.443B' advisor-plans/013-monetization-product-roadmap.md` returns
    only the band/caveat context (the canonical Market Size row must not pair
    `$2.443B` with `$8.0406B` as a single Grand-View claim).
  - Stale prices are flagged, not quoted as current:
    `grep -rn '\$5,000/year\|\$150,000/year' advisor-plans/013-monetization-product-roadmap.md`
    returns only lines under a HISTORICAL/legacy caveat.
  - The bundle index does not restate raw market figures (it points to this
    folder): `grep -n 'expected in 2025' advisor-plans/013-monetization-product-roadmap/README.md`
    returns nothing.

## Stop Conditions

Stop if:

- A market or price number is about to ship to buyer-facing copy still flagged
  LOW confidence or "unverified" here.
- A value-delivered claim implies a guarantee (use "avoided-loss anchor," never
  "we will prevent your breach").
- This file starts duplicating the parent roadmap strategy instead of verifying
  and deepening it.

## Maintenance Notes

This file is the verification and economics layer. When a market figure, a
competitor price, or a cost-of-pain anchor changes, update it here once and
propagate the corrected number to the parent roadmap and proposal folders. Do not
let three surfaces drift to three different breach-cost numbers.
