# Plan 009: Condense entry-path pages and guide pages for short-attention readers

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0f7fd3e..HEAD -- docs/introduction.mdx docs/installation.mdx docs/setup.mdx docs/quickstart.mdx docs/whats-included.mdx docs/guides/*.mdx docs/docs.json` and `git diff --stat -- docs/introduction.mdx docs/installation.mdx docs/setup.mdx docs/quickstart.mdx docs/whats-included.mdx docs/guides/*.mdx docs/docs.json`. This plan was written against a dirty worktree, so compare the "Current state" excerpts against live files before editing.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `advisor-plans/008-docs-adhd-first-information-architecture.md`, `advisor-plans/010-standardize-mintlify-components-and-enforcement.md`
- **Category**: docs
- **Planned at**: commit `0f7fd3e`, 2026-06-16

## Why this matters

The entry path currently repeats the same claims across introduction, installation, setup, quickstart, and scenario guides. That is expensive for readers with limited attention because they must keep re-deciding whether a page is conceptual, procedural, or reference material. This plan makes each entry-path page own one job and makes guide pages short scenario recipes that link to canonical concept/reference owners.

## Current state

`docs/quickstart.mdx` is 234 lines and includes install, schema authoring, generated migration review, check, apply, type generation, and next-step cards in one page. The generated migration example alone spans `docs/quickstart.mdx:93-125`, and the source-pinning tip at `docs/quickstart.mdx:127-137` is advanced config detail inside the first-run path.

`docs/introduction.mdx` has two workflow images, two benchmark images, a feature card grid, and a start card grid:

```mdx
// docs/introduction.mdx:22-36

## The Solution

...

<Frame caption="supaschema">
...
<Frame caption="supaschema automated schema loop">
...
With the installed coding-agent hooks, schema-tree edits trigger...
```

`docs/setup.mdx` repeats the install command at `docs/setup.mdx:7-17`, then owns path selection, agent addendum behavior, doctor checks, and configuration links.

The current guide set under `docs/guides/**` mixes several types of pages:

- scenario/task pages: `supabase-integration.mdx`, `ci-github-actions.mdx`, `ci-gate.mdx`
- SEO/use-case entry pages: `supabase-db-diff-without-docker.mdx`, `declarative-postgres-schema-management.mdx`
- concept-adjacent pages: `idempotent-postgres-migrations.mdx`, `rls-policy-migration-safety.mdx`, `generate-supabase-types-without-database.mdx`
- evidence/verification page: `corpus-oracle.mdx`

## Content ownership target

- `docs/introduction.mdx`: what problem supaschema solves, one diagram, four start cards maximum.
- `docs/whats-included.mdx`: package capability inventory. No deep explanations.
- `docs/installation.mdx`: install command, agent install prompt, verify install.
- `docs/setup.mdx`: path selection, install manifest, `doctor`, config handoff. Do not repeat the happy-path install narrative.
- `docs/quickstart.mdx`: first migration only. No advanced source pinning, no full generated SQL dump, no CI, no deep type usage.
- `docs/guides/*.mdx`: one scenario per page with a short "Use this when", "Do this", "Verify", and "Related" structure.
- `docs/concepts/*.mdx`, `docs/configuration/*.mdx`, and `docs/reference/*.mdx`: canonical owners for deep explanation.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Docs lint | `npm run docs:lint` | exit 0 |
| Full docs validation | `npm run docs:check` | exit 0 |
| Review touched docs | `git diff -- docs/introduction.mdx docs/installation.mdx docs/setup.mdx docs/quickstart.mdx docs/whats-included.mdx docs/guides` | only intended content rewrites |

## Scope

**In scope**:

- `docs/introduction.mdx`
- `docs/installation.mdx`
- `docs/setup.mdx`
- `docs/quickstart.mdx`
- `docs/whats-included.mdx`
- `docs/guides/declarative-postgres-schema-management.mdx`
- `docs/guides/supabase-db-diff-without-docker.mdx`
- `docs/guides/idempotent-postgres-migrations.mdx`
- `docs/guides/rls-policy-migration-safety.mdx`
- `docs/guides/generate-supabase-types-without-database.mdx`
- `docs/guides/supabase-integration.mdx`
- `docs/guides/ci-github-actions.mdx`
- `docs/guides/ci-gate.mdx`
- `docs/guides/corpus-oracle.mdx`
- `advisor-plans/README.md` status row only when complete

**Out of scope**:

- Command reference page rewrites. See plan 011.
- Mintlify lint rule changes. See plan 010.
- File renames/deletions.
- Benchmark image regeneration.

## Git workflow

- Preserve unrelated dirty hunks.
- Do not commit unless asked.
- Use a branch like `advisor/009-docs-content-condense` if asked to branch.

## Steps

### Step 1: Add a page job statement at the top of each public entry page

For each of `introduction`, `installation`, `setup`, `quickstart`, and `whats-included`, make the first paragraph answer one question:

- Introduction: "Use this page to decide whether supaschema fits your workflow."
- Installation: "Use this page to add supaschema to a project."
- Setup: "Use this page to confirm paths and setup output after install."
- Quickstart: "Use this page to generate and check one migration."
- What's included: "Use this page to see the package surfaces at a glance."

Keep these as plain prose, not callouts.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 2: Shorten `docs/quickstart.mdx`

Keep the `<Steps>` workflow, but make it first-run only:

1. Install.
2. Write schema.
3. Generate.
4. Check.
5. Apply with your runner.
6. Generate types, only if it is not already covered by the `diff` output policy.

Remove or move these advanced details out of the quickstart:

- The long generated migration SQL block at `docs/quickstart.mdx:93-125`. Replace it with a 5-8 line excerpt showing the header, lineage marker, and one guarded statement.
- The `sources.from` pinning tip at `docs/quickstart.mdx:127-137`. Link to `/configuration/config-file` or `/concepts/sources`.
- Any CI or source strategy explanation. Link to the owning pages.

Target size: under 170 lines unless a verifier shows the page becomes less clear.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 3: Shorten `docs/introduction.mdx`

Make the introduction a fast orientation page:

- Use sentence-case headings.
- Keep one workflow diagram: prefer `/images/concepts/supaschema-flow.svg`.
- Move detailed benchmark charts out of the first page. Keep one sentence that links to `/benchmarks`.
- Keep one card grid with four cards maximum: install, quickstart, configure, evidence.
- Do not include both a feature grid and a start grid.

Target size: under 70 lines.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 4: Separate installation from setup

In `docs/installation.mdx`, keep:

- `npm install supaschema`
- why it is a runtime dependency
- the `<Prompt>` for coding agents
- verify commands
- links to setup and quickstart

In `docs/setup.mdx`, remove the repeated happy-path install framing. Start from "After install, confirm these paths." Keep provider path selection, agent addendum behavior, and `doctor`. Link back to installation if setup did not run.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 5: Normalize guide pages to one recipe shape

For each public guide in scope, use this structure:

```mdx
Use this when <specific scenario>.

## Do this

<short commands or steps>

## Verify

<one check command or expected output>

## Related

<CardGroup cols={2}>...</CardGroup>
```

Rules:

- Keep deep concept explanation out of guides when a concept/reference owner already exists.
- Link canonical owners instead of restating them.
- Keep each guide near 50-90 lines unless it contains a necessary code example.
- Use `## Related` consistently, not mixed labels such as "Related pages", "Related guides", or "Next Steps".

**Verify**: `npm run docs:lint` -> exit 0.

### Step 6: Run full docs validation

Run:

```bash
npm run docs:check
```

Expected: exit 0. Fix broken anchors caused by removed headings by updating links to the canonical section owners.

## Test plan

- `npm run docs:lint` after each rewrite group.
- `npm run docs:check` after all rewrites.
- Manually review `git diff` to confirm content moved to owner pages instead of being duplicated.

## Done criteria

- [ ] Entry pages each have one clear job and no duplicated first-run narrative.
- [ ] `docs/quickstart.mdx` is materially shorter and keeps only the first migration loop.
- [ ] `docs/introduction.mdx` uses one primary workflow diagram and one start card grid.
- [ ] Guide pages use the same "Do this / Verify / Related" structure.
- [ ] `npm run docs:lint` exits 0.
- [ ] `npm run docs:check` exits 0, or the operator records why Mintlify could not run.

## STOP conditions

Stop and report back if:

- Current docs already contain a newer content taxonomy that conflicts with this plan.
- A rewrite would require changing command behavior, config semantics, or generated examples without source-code verification.
- `npm run docs:lint` fails twice after reasonable fixes.
- The full docs check reports failures outside files touched by this plan.

## Maintenance notes

Future docs should not repeat the full product pitch. Use links to canonical owners: concepts for why, commands for exact flags, configuration for persistent defaults, reference for exhaustive tables, and guides for scenario recipes.
