# Proposal 06: SEO / AEO / GEO Marketing Plan

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: This is the online-marketing owner for the five paid offers. It is a planning handoff, not permission to publish prices, terms, or claims. Value propositions and pain points are owned by the parent roadmap's User-Type Value Matrix and the per-offer proposal folders (`01`-`05`); this file links to them and adds the search, answer-engine, generative-engine, and distribution layer. Do not restate offer economics here. Gate every published page through `npm run docs:lint` and `npm run docs:check`.

> Drift check: `git diff --stat fb8c461..HEAD -- README.md docs/docs.json docs/ package.json advisor-plans/013-monetization-product-roadmap/06-seo-aeo-geo-marketing`

## Status

- Priority: P1
- Effort: L
- Risk: LOW (content/marketing; no runtime behavior change)
- Depends on: none to start; links to proposal folders `01`-`05` for value props
- Category: marketing / direction
- Execution lens: elegant canonical-owner execution.
- Protected invariant: use the docs owner model from plans 008-011 and do not add competing docs components.

## Why This Matters And Why Now

supaschema's buyers discover tools through three surfaces that now overlap: classic search (Google), answer engines (AI Overviews, featured snippets), and generative engines (ChatGPT, Perplexity, Claude, Copilot). A 2024-2026 shift made this urgent: Google AI Overviews appear on 30%+ of queries and cut position-1 click-through by ~58% when present, while a citation inside the Overview adds ~35% CTR. Winning is no longer "rank #1" — it is "be the source the answer cites." Source: <https://cxl.com/blog/answer-engine-optimization-aeo-the-comprehensive-guide/>

Competitive timing makes the AI-agent lane especially time-sensitive: Liquibase shipped **"Agent Safe Governance"** in June 2026, signaling the AI-database- governance category is being created now by an incumbent. Liquibase's framing is enterprise/compliance and multi-database; supaschema's open wedge is the developer-native, Postgres-specific, hooks/`SKILL.md`/file-system angle that a 65-database Java enterprise product cannot credibly own. Source: <https://www.businesswire.com/news/home/20260610524258/en/Liquibase-Introduces-Agent-Safe-Governance-for-AI-Generated-Database-Change>

## Positioning Foundation (the one message everything reuses)

The differentiation wedge, validated against incumbent content gaps (Section "Competitor gaps"): supaschema is the only tool combining **Postgres-native declarative migrations + RLS-as-security + AI-agent commit-hook governance + audit-ready evidence + a transparent dual license**. No incumbent owns all five.

Canonical product description — use this paragraph verbatim across GitHub `About`, npm `description`, the docs hero, `llms.txt`, and any roundup submission. Entity-consistent wording across surfaces is not cosmetic: divergent descriptions cause a measured ~30-40% drop in LLM citation confidence. Source: <https://ziptie.dev/blog/how-to-optimize-content-for-perplexity-ai/>

> supaschema is a declarative PostgreSQL migration and governance CLI. It generates migration SQL from a declarative schema tree, runs replay-safety checks, models row-level security as a first-class object, generates TypeScript and Zod types, and ships AI-agent migration guardrails (commit hooks plus a SKILL.md). It generates, checks, and governs; it does not apply migrations by default. It supports Supabase, Neon, RDS/Aurora, Cloud SQL, AlloyDB, Azure PostgreSQL, and generic Postgres, and is open source (AGPL-3.0) with a commercial/OEM license path.

Per-offer value propositions and actionable pain points are NOT restated here. They live in:

- `01-commercial-license-oem/` and parent matrix row "CTO/founder/platform-vendor."
- `02-rls-tenant-isolation-security-review/` and matrix row "AppSec engineer."
- `03-agent-database-change-control-review/` and matrix row "AI tooling owner."
- `04-adoption-audit-migration-rescue/` and matrix rows "platform engineer"/"DBA."
- `05-release-compliance-evidence-packs/` and matrix rows "release manager"/"compliance owner."

Every marketing claim below must trace to a value prop or pain point in those owners, so messaging has one source of truth.

## 1. SEO Plan (classic search)

Upstream basis: Google's helpful-content guidance is now part of the core ranking system; it rewards first-hand, people-first content and E-E-A-T (Experience, Expertise, Authoritativeness, Trust), with Trust load-bearing. Core Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1) are tiebreakers. Source: <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>

Tactics (the docs site is Mintlify):

- Demonstrate first-hand operational experience on every page: show real `supaschema diff` output, actual schema diffs, real `SUPA_*` diagnostics, and benchmark numbers — not marketing prose. Google rewards proof the author ran the tool.
- Set unique, specific page titles via Mintlify frontmatter `title:` (e.g. "supaschema Config Reference: adapter, schemaPaths, environments, transactionMode" instead of "Configuration"). Source: <https://www.mintlify.com/docs/optimize/seo>
- Write a distinct 150-160 char `description:` per page focused on the one problem the page solves.
- Build topic clusters: pillar pages ("PostgreSQL migration governance overview") linking to spokes (hints, renames, transactionMode, RLS safety). The sidebar is the internal-link graph.
- Canonicalize duplicate/versioned pages with frontmatter `canonical:`; avoid npm-README vs docs duplicate-content dilution.
- Confirm passing Core Web Vitals in Google Search Console CrUX; submit the Mintlify-generated `/sitemap.xml` and verify `<lastmod>` reflects real edits.
- Wire 301 redirects whenever a docs path changes (preserve ranking equity; honor the docs owner model from plans 008-011).

## 2. AEO Plan (answer engines: AI Overviews, featured snippets, PAA)

Upstream basis: ~55% of AI Overview citations come from a page's first section; question-first headings that match conversational phrasing are favored. Source: <https://cxl.com/blog/answer-engine-optimization-aeo-the-comprehensive-guide/>

Tactics:

- Open every high-traffic page with a 50-150 word self-contained **direct answer block** that fully answers the page's core question without scrolling (the primary extraction target for AI Overviews and Perplexity).
- Use question-first H2/H3 headings matching real queries: "How does supaschema diff work?", "What is the difference between supaschema and Flyway?", "Does supaschema support Supabase?", "What does SUPA_DIFF_LINEAGE_BROKEN mean?", "How do I use supaschema with Claude Code or Cursor?". Source: <https://www.frase.io/blog/what-is-answer-engine-optimization-the-complete-guide-to-getting-cited-by-ai>
- Keep a standalone FAQ + FAQ sections on high-intent pages. (FAQPage schema no longer yields SERP rich results for non-health/gov sites, but the Q&A content is still parsed for AI answer extraction — see Section 5.)
- Use numbered/bulleted lists and tables for procedures and comparisons (more citable than narrative): "supaschema workflow: 1. edit schema SQL, 2. diff, 3. check, 4. commit."
- Raise entity density: name PostgreSQL, Supabase, Neon, RDS, libpg-query, RLS, transactionMode, declarative schema, etc. (~15+ named entities per 1,000 words). Source: <https://ziptie.dev/blog/google-ai-overviews-source-selection/>
- Add a visible "Last updated" date and emit `dateModified`; Perplexity cites content updated within 30 days ~3.2x more. Source: <https://ziptie.dev/blog/how-to-optimize-content-for-perplexity-ai/>

## 3. GEO Plan (generative engines: ChatGPT, Perplexity, Claude, Copilot)

Upstream basis: the GEO paper (Aggarwal et al., ACM SIGKDD 2024, arXiv:2311.09735) tested 9 interventions over 10,000 queries; five produced 30-41% citation gains, with disproportionate gains (up to ~115%) for lower-ranked sources — directly favorable to a newer tool competing with Flyway/Liquibase. Source: <https://arxiv.org/abs/2311.09735>

Apply the five winning interventions to the top ~10 landing/answer pages, ranked by measured effect:

1. **Cite sources (+30-40%, up to ~115% for lower-ranked sites):** add inline citations to PostgreSQL docs, libpg-query, Supabase platform docs, and relevant NIST/ISO/OWASP references.
2. **Quotation addition (+41% PAWC):** add attributed quotes from named domain experts (PostgreSQL maintainers on migration safety, Supabase team on schema management).
3. **Statistics addition (+31% PAWC):** replace vague claims with specifics. The two examples here — "replay-checks a 50-table migration in under 2 seconds" and "zero hand-authored SQL for 90% of DDL-expressible changes" — are ILLUSTRATIVE PLACEHOLDERS, not approved copy: do not publish either until it is actually measured (run the benchmark / count the corpus) and recorded with its method. The Stop Conditions forbid shipping an unverified statistic.
4. **Fluency optimization (+15-30%):** rewrite dense technical prose for readability without changing facts; pairs best with statistics.
5. **Authoritative voice (+10-20%):** remove hedging. "supaschema blocks destructive drops until the object key appears in hints.destructive," not "may warn." Source for all five: <https://derivatex.agency/blog/princeton-geo-paper-plain-english/>

Cross-surface GEO hygiene:

- Entity consistency: identical product name/description/positioning across GitHub, npm, and docs (see the canonical paragraph above).
- Confirm `robots.txt` allows `PerplexityBot` (and does not block GPTBot/CCBot) — blocking AI crawlers is self-defeating for a tool that wants to be recommended.
- Run a 60-day content refresh loop: bump `dateModified`, refresh "Last updated," add one new data point per cycle (highest-leverage tactic for Perplexity share).

## 4. llms.txt And Structured Data

> Repo resolution notes (resolved 2026-06-16 — do not leave these as guesses):
>
> - **Docs domain** is `https://supaschema.com` (docs served under `/docs`; `docs/docs.json` canonical = `https://supaschema.com/docs`). Confirm whether Mintlify serves `llms.txt` at the site root (`/llms.txt`) or under `/docs` and use the path that resolves.
> - **JSON-LD injection** is not standard Mintlify frontmatter. Inject `<script type="application/ld+json">` via a global head/custom-script setting in `docs.json` (or a page body where supported). Treat "add JSON-LD" as: first confirm the Mintlify mechanism, then add — it is a research-then-edit step.
> - **robots.txt** is generated by Mintlify at the hosting layer; there is no `robots.txt` in `docs/`. "Allow AI crawlers" is a verify-or-configure step at the Mintlify dashboard/config, not a file edit — STOP for a human if it is not controllable from the repo.
> - **Comparison pages**: the existing one lives at `docs/comparisons/supaschema-vs-supabase-cli.mdx`. New `/vs/*` pages (Section 6) are public URL slugs; create the files under `docs/comparisons/` to match the established pattern, do not start a parallel `/vs/` tree.

llms.txt — upstream: Jeremy Howard's Sept-2024 proposal (llmstxt.org), targeting inference-time LLM context (not training). Mintlify co-developed `/llms-full.txt` with Anthropic and auto-generates both files. Sources: <https://llmstxt.org/>, <https://www.mintlify.com/blog/simplifying-docs-with-llms-txt>

- Verify `https://supaschema.com/llms.txt` and `/llms-full.txt` exist (confirm root vs `/docs` path per the resolution note above; Mintlify auto-generates; confirm by visiting them).
- Hand-craft the `llms.txt` H1 + blockquote to be the canonical product paragraph above — this is what an LLM quotes verbatim for "what is supaschema?"
- Point the H2 link sections at substantive pages (declarative workflow, migration governance, AI-agent integration, multi-provider, `SUPA_*` codes), not stubs. Confirm Mintlify serves `<url>.md` clean-markdown variants.

Structured data — Google retired several types in 2024-2026; implement only what still works. Sources: <https://developers.google.com/search/docs/appearance/structured-data/software-app>, <https://developers.google.com/search/docs/appearance/structured-data/organization>

| Schema type | Status (2026) | Action |
| --- | --- | --- |
| SoftwareApplication | ACTIVE — rich result card | Add JSON-LD on landing page: `name`, `offers.price:"0"` (OSS), `applicationCategory:"DeveloperApplication"`, `operatingSystem`; validate in Rich Results Test |
| Organization | ACTIVE — entity signal | Root JSON-LD with `name`, `url`, `logo`, and `sameAs` (GitHub, npm, X, LinkedIn) — `sameAs` drives cross-platform entity consistency |
| BreadcrumbList | ACTIVE — readable SERP path | Emit on every docs page alongside Mintlify sidebar |
| FAQPage | Rich result DEPRECATED (May 2026) for non-health/gov | Keep markup (still parsed for AI extraction); do not expect SERP icons |
| HowTo | DEPRECATED (2025) | Remove/de-prioritize; page content still matters |
| TechArticle | DEPRECATED (Jun 2025) | Downgrade blog/changelog to plain `Article` with `dateModified` |

## 5. Per-Offer Keyword And Content Targeting (item 4 core)

Demand/competition are research INFERENCES (no licensed volume tool), not hard numbers. "Ownable gap" = low competition + clear buyer intent + an incumbent content vacuum. Map each target page to the value prop/pain point in its proposal folder.

### Offer 1 — Commercial / OEM license

- Ownable gaps (build first): "can I embed AGPL software in closed source product", "postgres migration tool OEM license", "AGPL commercial license alternative", "dual license postgres tool".
- Transactional: "postgres migration tool commercial license pricing", "AGPL commercial exception buy" (low volume, high intent — short sales cycle).
- Content: a single "Can I use supaschema commercially?" page with a clear decision tree (precedent: ParadeDB's "Why We Picked AGPL"). Neither Atlas nor Liquibase publishes a transparent OEM-buyer dual-license page.

### Offer 2 — RLS / tenant-isolation security review

- Ownable gaps: "supabase RLS missing policy data leak", "RLS policy testing postgres", "supabase row level security audit tool", "postgres RLS security scanner", "postgres tenant isolation audit".
- Informational (rank with depth): "postgres multi-tenant RLS isolation", "supabase row level security best practices".
- Transactional: "RLS security audit service postgres", "supabase multi-tenant security review".
- Content: "RLS-as-application-security" pillar + a tenant-isolation audit service page. Supabase's own Security Advisor is an automated scanner, not an expert review — that is the gap.

### Offer 3 — AI-agent database change-control review

- First-mover gaps (near-zero competition today): "Claude Code database migration guard", "how to prevent AI agent from breaking database", "AI agent editing database migrations safely", "Cursor agent postgres migration risk".
- Transactional: "supaschema agent guardrails" (own the brand term), "AI database migration audit service".
- Content: reference the documented Cursor/Claude "wiped prod DB + backups in 9 seconds" incident as the pain narrative; show the hook + `SKILL.md` enforcement. Move before Liquibase's enterprise "Agent Safe Governance" content matures in SERPs.

### Offer 4 — Adoption audit / migration rescue

- Ownable gaps: "postgres no source of truth schema", "mixed migration tools postgres chaos", "hand-edited migration files problem", "schema migration rescue postgresql", "fix broken migrations postgres service".
- Commercial: "migrate from Prisma to declarative schema postgres", "replace Flyway postgres declarative".
- Avoid head-on: "best postgres migration tool 2026" / "...comparison 2026" — Bytebase listicles dominate; pursue via comparison pages (Section 6) + backlinks.
- Content: "migration debt / rescue" framing is owned by nobody; generic consultancies (MeteorOps, JusDB) publish no search-optimized rescue content.

### Offer 5 — Release / compliance evidence packs

- Ownable gaps: "SOC 2 database change evidence pack", "release evidence pack database schema postgres", "SOC 2 CC8.1 database change evidence", "migration provenance SOC 2".
- Informational/commercial (compete carefully — Liquibase is strong here): "SOC 2 database change management controls", "database change governance SOC 2 postgres".
- Content: the "evidence pack" deliverable framing (a product, not a tool) is the clearest open position; Liquibase owns GRC narrative, Bytebase owns audit logging, neither sells a packaged auditor-ready deliverable.

## 6. Comparison / Alternative-To Pages (high commercial intent)

These rank in Google and are ingested as LLM citation sources for "what migration tool should I use." Ranked by buyer intent. Source: <https://estuary.dev/blog/postgres-migration-tools/>

1. `/vs/atlas` — closest declarative competitor; differentiate on Supabase-native
   - RLS + agent hooks + compliance deliverables (Atlas has none of these).
2. `/vs/flyway` — "Flyway alternative for Supabase" — Flyway is the tool teams most often inherit and want to escape; it knows nothing about RLS/Supabase/AI agents.
3. "declarative schema migrations for Supabase" — high intent, owned by nobody.
4. `/vs/liquibase` — "Liquibase is Java/multi-DB/enterprise; supaschema is Postgres-native, TypeScript, developer-first"; wedge on AI-agent + RLS.
5. `/vs/bytebase` — "Bytebase adds a GUI process layer; supaschema keeps governance in your codebase."
6. "postgres migration tool without Java" (no JVM, no XML changelogs) — pain-first for Node/TS shops.
7. `/vs/prisma-migrate` — "source of truth in the DB AST, not the ORM model."

Also: request inclusion in existing "best Postgres migration tools" roundups (Estuary, Hevo, Bytebase, Toolradar) with a factual differentiated blurb — zero-cost distribution that feeds both Google and LLM citations.

## 7. Distribution Channels And Watering Holes

LLMs disproportionately cite Reddit (~40% of citations per Semrush), Wikipedia, and YouTube; GitHub topics and "alternative-to" roundups feed training/citation. Sources: <https://productleadersdayindia.org/blogs/generative-engine-optimization-b2b-saas-guide/reddit-linkedin-most-cited-llm-sources-2025.html>, <https://www.markepear.dev/blog/dev-tool-hacker-news-launch>

- **GitHub:** one-sentence `About` with key terms; add all 20 Topics (`postgresql`, `database-migrations`, `supabase`, `schema-management`, `cli`, `typescript`, `rls`, `ai-coding-agents`, `neon`, `rds`, `cloud-sql`, `governance`, ...). README = SEO + sales landing page (elevator pitch, one install command, asciinema, comparison table, "who uses it"). Topics compound permanently; stars drive topic-page rank.
- **npm:** keyword-rich `description` + `keywords` array + README (indexed by Google); same wording as GitHub.
- **Reddit (authentic, expertise-first):** r/PostgreSQL, r/Supabase, r/devops, r/ClaudeAI; answer "what migration tool" threads factually, no promo copy.
- **Hacker News:** "Show HN: supaschema – declarative PostgreSQL migrations with AI-agent guardrails" (Tue-Thu 9am-12pm ET); modest language; follow with a technical deep-dive.
- **dev.to / Hashnode:** tutorials ("declarative migrations for Supabase", "supaschema + Claude Code governance", "safe destructive Postgres changes"); canonical-link back to docs.
- **YouTube:** terminal walkthroughs with full captions + chapters (LLMs read captions, not video).
- **Newsletters/communities by buyer:** Postgres Weekly + pganalyze (platform eng/DBA); Pragmatic Engineer (CTO/license); Supabase Discord + GitHub Discussions + r/Supabase (AppSec/RLS); Cursor/Claude Code Discords + `awesome-agent-skills` repo listing (AI-agent); G2/Capterra + Liquibase webinar audience (GRC/compliance). PGConf.dev (May 2026) / PGConf.EU (Oct 2026) CFPs for a "declarative schema + AI-agent governance" talk.

## 8. Build Order (waves)

### Wave A — Foundation (week 1-2, highest leverage, lowest effort)

1. Verify + hand-craft `llms.txt`/`llms-full.txt` (the canonical paragraph).
2. Add SoftwareApplication + Organization + BreadcrumbList JSON-LD.
3. Set GitHub `About` + 20 Topics; align npm `description`/`keywords` to the canonical paragraph (entity consistency).
4. Confirm `robots.txt` allows AI crawlers; submit sitemap to Search Console.

### Wave B — On-page AEO/GEO retrofit (week 2-5)

5. Add direct-answer blocks + question-first headings to the top ~10 pages.
6. Apply the 5 GEO interventions (citations, quotes, statistics, fluency, authoritative voice) to those pages.
7. Add visible "Last updated" + `dateModified` + start the 60-day refresh loop.

### Wave C — New content (week 4-10)

8. Publish the per-offer ownable-gap pages (Section 5), one cluster at a time.
9. Publish the comparison/alternative-to pages (Section 6).
10. Show HN launch + first dev.to tutorial + first YouTube walkthrough.

### Wave D — Off-site distribution + measurement (ongoing)

11. Roundup-inclusion outreach; authentic Reddit/Discord presence; newsletter and conference outreach.
12. Stand up the measurement dashboard (Section 9).

## 9. Measurement / KPIs

| Layer | Metric | Tool |
| --- | --- | --- |
| SEO | impressions/clicks/avg position per cluster; CWV pass rate | Google Search Console |
| AEO | featured-snippet / AI-Overview presence on target queries | manual SERP audits, rank tracker |
| GEO | citation/mention share in ChatGPT, Perplexity, Claude, Copilot for "postgres migration / RLS audit / AI agent DB" prompts | periodic prompt audits; AI-visibility tooling |
| Distribution | GitHub stars/topic rank, npm weekly downloads, referral traffic from HN/Reddit/roundups | GitHub/npm stats, GSC referrals |
| Funnel | docs -> inquiry-page -> paid-lane inquiry (ties to parent roadmap activation metrics) | analytics + inquiry-form source tags |

Tie the funnel metrics to the activation metrics already defined in the parent roadmap so marketing feeds the same conversion model.

## 10. Marketing-Program Gaps And Implementation Steps (item 5 for marketing)

- No analytics/Search Console baseline yet — establish before claiming any lift.
- No AI-visibility measurement process — define the prompt-audit set in Wave A.
- Docs component standard (plans 008-011) must not be violated by new marketing pages — reuse `CardGroup` and the enforced patterns; run `tests/docs-standard.test.ts`.
- Comparison pages make competitive claims — keep them factual and dated; a wrong claim is a credibility and legal risk.
- No content owner/cadence assigned — Wave A must name who owns the 60-day loop.

## Scope

In scope: SEO/AEO/GEO tactics, llms.txt + structured data, per-offer keyword and content targeting, comparison pages, distribution channels, build order, measurement, and the marketing gap list.

Out of scope: publishing prices/terms/SLAs; product code; paid-ad budgets; rewriting the value props/pain points owned by the proposal folders; any hosted/billing/telemetry path.

## Validation Gates

Automated (CI-runnable, offline):

- `npm run docs:lint` exits 0 for any published docs page (offline; runs `scripts/check-docs-standard.mjs`, which enforces the `title`/`description`/ `keywords` frontmatter this plan's SEO tactics rely on).
- `npm test -- tests/docs-standard.test.ts` exits 0 when docs components change.
- `npm test -- tests/package-contents.test.ts` exits 0 if `package.json` `description`/`keywords` change the package metadata.

Automated but NETWORK-DEPENDENT (will fail offline/sandboxed for environmental reasons, not content reasons — do not read a network failure as a content defect):

- `npm run docs:check` exits 0 — downloads the `mint` CLI via `npx` and crawls links, so it needs network egress. `docs:lint` is the offline-safe gate.

Manual / external (human or external tool — not a command; do not block a wave waiting for these):

- Structured data validates in the Google Rich Results Test (paste the page).
- GSC/CrUX Core Web Vitals review; AI-visibility prompt audits (Section 9).
- Every published market/product/competitor claim traces to a HIGH/MED-confidence source in `07-market-and-value-verification/` (no LOW-confidence number ships). Methodology stats about SEO/AEO/GEO itself trace to their inline upstream URLs, not to folder `07`.

## Stop Conditions

Stop if:

- A page would publish a fixed price, SLA, warranty, or license grant without approval.
- A comparison claim about a competitor cannot be sourced and dated.
- A market statistic flagged LOW/"unverified" in folder `07` is about to ship.
- New marketing pages would fork a second docs component system instead of reusing the plans 008-011 owner model.
- A GEO "statistic" (e.g. a benchmark number) is unverified — never publish an invented performance number to win a citation.

## Maintenance Notes

This is the marketing owner. When a value prop changes, edit the proposal folder or parent matrix and let this file link to it — do not duplicate. Refresh the GEO/AEO tactics when Google/answer-engine guidance changes (the field moved fast in 2024-2026); re-verify the "deprecated structured data" table annually.
