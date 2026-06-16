# Plan 010: Standardize Mintlify components and enforce the docs pattern

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0f7fd3e..HEAD -- .claude/rules/02-mintlify-writing-standards.md .claude/rules/03-mintlify-component-reference.md .codex/rules/02-mintlify-writing-standards.rules .codex/rules/03-mintlify-component-reference.rules scripts/check-docs-standard.mjs tests/docs-standard.test.ts docs docs/docs.json` and `git diff --stat -- .claude/rules/02-mintlify-writing-standards.md .claude/rules/03-mintlify-component-reference.md .codex/rules/02-mintlify-writing-standards.rules .codex/rules/03-mintlify-component-reference.rules scripts/check-docs-standard.mjs tests/docs-standard.test.ts docs docs/docs.json`. This plan was written against a dirty worktree, so preserve unrelated hunks.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `advisor-plans/008-docs-adhd-first-information-architecture.md`
- **Category**: docs / dx
- **Planned at**: commit `0f7fd3e`, 2026-06-16

## Why this matters

The repo has a good docs lint gate, but it does not enforce the component patterns that most affect scanability: card grid consistency, heading case, card body length, and callout noise. Without enforcement, the docs can pass Mintlify validation while drifting back into visually inconsistent pages. This plan updates the docs standard, the lint script, and tests so the ADHD-first content style is executable rather than just prose.

## Current state

The local docs rule already says to use Mintlify components semantically:

```md
// .claude/rules/02-mintlify-writing-standards.md
- Use Mintlify components for the structures they own: `<Steps>` for complex procedures, `<ParamField>` for parameters/flags, `<ResponseField>` and `<Expandable>` for response shapes, `<Frame>` for images, and semantic callouts for notes, tips, warnings, and critical cautions.
```

The component reference allows `<Card>` / `<CardGroup>` for navigation:

```md
// .claude/rules/03-mintlify-component-reference.md
| Navigation or related resources | `<Card>` / `<CardGroup>` |
```

The current lint script enforces frontmatter, links, code fences, `ParamField` on command pages, image paths/frames, docs config shape, contextual options, and navigation membership. It does not inspect card grid shape, heading sentence case, adjacent callouts, or card body length.

Existing card usage is inconsistent:

- `docs/quickstart.mdx:218-234` has a four-card next grid, but indentation is uneven and two cards are not indented under `<CardGroup>`.
- `docs/setup.mdx:96-108` uses `cols={3}` for three cards, while most other grids use `cols={2}`.
- `docs/coding-agents.mdx:59-69` uses cards without `href` for optional discovery surfaces, while other card grids are navigation grids.
- Several pages use title-case headings despite the writing standard, for example `docs/introduction.mdx:12` ("The Problem"), `docs/concepts/migration-pipeline.mdx:27` ("What Happens Inside"), and `docs/commands/verify.mdx:25` ("How It Works").

## Canonical component end state

- `CardGroup` is the only grid component used by this repo for cards. Do not introduce `<Columns>` for card grids.
- `Card` is for navigation, related resources, or discrete choice summaries. Use tables or definition lists for dense reference data.
- Every `Card` has a `title` and `icon`.
- Cards that navigate have extensionless, root-relative `href` values for internal pages.
- Card body text is one short sentence, target 25 words or fewer.
- `CardGroup cols={2}` is the default. Use `cols={3}` only for exactly three parallel choices.
- Non-hub pages should have at most one related/next card grid. Hub pages may have multiple grids.
- Callouts are semantic and sparse: no adjacent callouts without explanatory content between them.
- Body headings use sentence case unless the heading is a command, acronym, code symbol, product name, or diagnostic code.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused docs-standard tests | `npm test -- tests/docs-standard.test.ts` | exit 0 |
| Docs lint | `npm run docs:lint` | exit 0 |
| Sync rule mirrors | `npm run sync:llm` | exit 0; reports `SYNC_LLM_OK ... rules=...` |
| Check synced mirrors | `npm run sync:llm:check` | exit 0 |
| Full docs validation | `npm run docs:check` | exit 0 |

## Scope

**In scope**:

- `.claude/rules/02-mintlify-writing-standards.md`
- `.claude/rules/03-mintlify-component-reference.md`
- generated mirrors under `.codex/rules/**` only through `npm run sync:llm`
- `scripts/check-docs-standard.mjs`
- `tests/docs-standard.test.ts`
- docs pages that need mechanical fixes to pass the new rules
- `advisor-plans/README.md` status row only when complete

**Out of scope**:

- Rewriting content for length. See plan 009.
- Reorganizing navigation groups. See plan 008.
- Splitting command pages. See plan 011.
- Editing generated build output.

## Git workflow

- Preserve unrelated dirty hunks.
- Edit `.claude/rules/**` as the rule owner, then run `npm run sync:llm` to update `.codex/rules/**`. Do not hand-edit generated mirrors unless the sync command itself is broken and you are explicitly fixing that generator.
- Do not commit unless asked.

## Steps

### Step 1: Update the docs rules with the canonical component contract

Add a concise "ADHD-first scanability" subsection to `.claude/rules/02-mintlify-writing-standards.md`:

- one page job per page;
- lead with the task/outcome;
- short paragraphs;
- progressive disclosure;
- one primary next-action grid per non-hub page;
- sentence-case body headings.

Add the card/callout rules from "Canonical component end state" to `.claude/rules/03-mintlify-component-reference.md`.

**Verify**: `npm run sync:llm` -> exit 0 and reports rules synced.

### Step 2: Extend `scripts/check-docs-standard.mjs`

Implement AST-based checks, matching the style already in the file:

- Track `CardGroup` nodes and their child `Card` nodes.
- Reject `<Columns>` in docs when used as a card grid. Message: `use <CardGroup> for docs card grids so the repo has one card layout owner`.
- For every `Card`, require `title` and `icon` string attributes.
- For internal card `href`, keep using the existing `addLinkViolation` helper.
- Count approximate card body words with `mdast-util-to-string` when possible; reject over 35 words as a hard ceiling.
- For `CardGroup`, allow only `cols={2}` or `cols={3}`. If `cols={3}`, require exactly three direct `Card` children. If `cols={2}`, reject more than four direct `Card` children.
- Reject adjacent callout nodes (`Note`, `Info`, `Tip`, `Warning`, `Danger`, `Check`) with no paragraph, list, table, code block, or heading between them.
- Add a conservative heading check for obvious title case. It should catch current patterns such as "How It Works", "Exit Codes", "Diagnostic Codes", "Next Steps", and "Core Workflow", but allow headings that are commands, acronyms, code literals, product names, or `SUPA_*` codes.

Use structural parsing. Do not add ad hoc regex over raw MDX text when the AST has the data.

**Verify**: `npm test -- tests/docs-standard.test.ts` -> expected failures until tests are updated in Step 3.

### Step 3: Add tests for the new lint rules

Extend `tests/docs-standard.test.ts` with focused cases:

- rejects `<Columns>` around cards;
- rejects `Card` without `title` or `icon`;
- rejects internal card hrefs that are not root-relative (existing helper may already cover this);
- rejects a `CardGroup cols={3}` with two or four cards;
- rejects a `CardGroup cols={2}` with five cards;
- rejects adjacent callouts;
- rejects obvious title-case headings;
- allows command headings such as `## diff`, acronym/product headings such as `## CI`, and code headings such as ``## `dir:` files``.

**Verify**: `npm test -- tests/docs-standard.test.ts` -> exit 0.

### Step 4: Fix current docs to satisfy the new standard

Apply only mechanical fixes needed by the new rules:

- Convert obvious title-case body headings to sentence case.
- Normalize card indentation inside `CardGroup`.
- Shorten card bodies that exceed the rule.
- Split overlarge card groups.
- Keep `CardGroup` as the repo-standard card grid component.

Do not do the broader content condensation from plan 009 in this step.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 5: Run sync and docs gates

Run:

```bash
npm run sync:llm:check
npm run docs:check
```

Expected: both exit 0.

## Test plan

- New unit coverage in `tests/docs-standard.test.ts` for each rule.
- `npm run docs:lint` over all pages.
- `npm run docs:check` for Mintlify validation, links, and a11y.
- `npm run sync:llm:check` for rule mirror drift.

## Done criteria

- [ ] `.claude/rules/02` and `.claude/rules/03` describe the component and scanability standards.
- [ ] `.codex/rules/02...` and `.codex/rules/03...` are synced through `npm run sync:llm`.
- [ ] `scripts/check-docs-standard.mjs` enforces the new component rules structurally.
- [ ] `tests/docs-standard.test.ts` covers each new rule.
- [ ] Current docs pass `npm run docs:lint`.
- [ ] `npm run docs:check` exits 0, or the operator records why Mintlify could not run.

## STOP conditions

Stop and report back if:

- The live lint script has been substantially rewritten and the current-state description no longer applies.
- The new heading rule creates widespread false positives that cannot be resolved with a conservative allowlist.
- `npm run sync:llm` wants to rewrite unrelated agent surfaces beyond rule mirrors.
- Passing the new linter would require content restructuring rather than mechanical component fixes.

## Maintenance notes

This plan intentionally makes scanability standards executable. If a future docs standard cannot be linted or tested, phrase it as guidance rather than a hard rule, or add a guard in the same change.
