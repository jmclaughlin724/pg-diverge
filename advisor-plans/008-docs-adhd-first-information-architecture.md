# Plan 008: Reorganize Mintlify navigation around reader tasks

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0f7fd3e..HEAD -- docs/docs.json docs/*.mdx docs/*/*.mdx .claude/rules/02-mintlify-writing-standards.md .claude/rules/03-mintlify-component-reference.md scripts/check-docs-standard.mjs tests/docs-standard.test.ts` and `git diff --stat -- docs/docs.json docs/*.mdx docs/*/*.mdx .claude/rules/02-mintlify-writing-standards.md .claude/rules/03-mintlify-component-reference.md scripts/check-docs-standard.mjs tests/docs-standard.test.ts`. This plan was written against a dirty worktree, so compare the "Current state" excerpts against the live files before editing and preserve unrelated hunks.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / tech-debt
- **Planned at**: commit `0f7fd3e`, 2026-06-16

## Why this matters

The docs validate, but the sidebar currently makes short-attention readers choose between abstract buckets like "Understand", "Generate", and "What's Included". That mixes first-run tasks, concepts, operational proof, and reference pages in the same groups. The elegant end state is a task-first information architecture: one obvious place to start, one workflow path, one configuration area, one use-case area, one agents/CI area, one evidence area, and one reference area.

## Elegant end state

- **Canonical owner**: `docs/docs.json` owns public navigation, footer shortcuts, and redirects.
- **Page owners**:
  - `docs/introduction.mdx`: short product orientation and first choice.
  - `docs/quickstart.mdx`: first successful migration path only.
  - `docs/commands/**`: command reference only.
  - `docs/configuration/**`: config semantics only.
  - `docs/concepts/**`: mental models only.
  - `docs/guides/**`: scenario/task recipes only.
  - `docs/reference/**`: exhaustive reference and maintainer-facing product contracts.
  - Hidden maintainer pages stay hidden: `docs/mintlify.mdx`, `docs/release.mdx`.
- **Legacy surfaces to delete**: none in this plan. This plan changes grouping only. Deletions/splits are handled by later plans.
- **Overlapping surfaces to merge/move/rename**: move pages between navigation groups in `docs/docs.json`; do not rename files in this plan.
- **Compatibility constraints**: keep existing page URLs working because the local docs rule requires redirects when pages move or rename. This plan does not move files, so no new redirects should be needed.

## Current state

The current navigation groups mix user task stages and proof/reference content:

```json
// docs/docs.json:128-158
{
  "group": "Start",
  "pages": ["introduction", "installation", "setup", "quickstart", "faq"]
},
{
  "group": "Understand",
  "pages": [
    "concepts/declarative-schema",
    "concepts/migration-pipeline",
    "concepts/sources",
    "comparisons/supaschema-vs-supabase-cli"
  ]
},
{
  "group": "Generate",
  "pages": [
    "guides/declarative-postgres-schema-management",
    "guides/supabase-db-diff-without-docker",
    "guides/idempotent-postgres-migrations",
    "guides/rls-policy-migration-safety",
    "guides/generate-supabase-types-without-database",
    "guides/supabase-integration"
  ]
}
```

`docs/docs.json:185-195` puts package overview, agent bundle details, CI pages, corpus oracle, benchmarks, and a case study under "What's Included". Those are different reader intents.

The repo has explicit docs validation:

```json
// package.json
"docs:lint": "node scripts/check-docs-standard.mjs",
"docs:check": "npm run docs:lint && cd docs && npx --yes mint@4.2.616 validate && npx --yes mint@4.2.616 broken-links --check-anchors && npx --yes mint@4.2.616 a11y"
```

`npm run docs:lint` currently reports `docs-standard: 41 pages OK`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Docs lint | `npm run docs:lint` | exit 0; `docs-standard: 41 pages OK` or the new page count |
| Full docs validation | `npm run docs:check` | exit 0; Mintlify validate, broken links, and a11y pass |
| Worktree review | `git diff -- docs/docs.json` | only intentional navigation/footer changes |

## Scope

**In scope**:

- `docs/docs.json`
- `advisor-plans/README.md` status row only when complete

**Out of scope**:

- Page body rewrites.
- File renames or page deletions.
- `scripts/check-docs-standard.mjs` and tests. Component enforcement is plan 010.
- Splitting `docs/commands/other.mdx`. That is plan 011.

## Git workflow

- Do not commit unless the operator explicitly asks.
- Preserve unrelated dirty hunks. The worktree was dirty when this plan was written.
- Use a branch like `advisor/008-docs-adhd-ia` if you are asked to branch.

## Steps

### Step 1: Replace abstract groups with task-first groups

Edit `docs/docs.json` navigation groups to this target order:

```json
[
  {
    "group": "Start",
    "icon": "rocket",
    "pages": [
      "introduction",
      "whats-included",
      "installation",
      "quickstart",
      "setup",
      "faq"
    ]
  },
  {
    "group": "Core workflow",
    "icon": "route",
    "pages": [
      "commands",
      "commands/diff",
      "commands/check",
      "commands/verify",
      "commands/types",
      "commands/migrations",
      "commands/sync"
    ]
  },
  {
    "group": "Configure",
    "icon": "settings",
    "pages": [
      "configuration/config-file",
      "configuration/environments",
      "configuration/hints",
      "concepts/sources",
      "reference/support-matrix"
    ]
  },
  {
    "group": "Tasks",
    "icon": "wand-sparkles",
    "pages": [
      "guides/declarative-postgres-schema-management",
      "guides/supabase-db-diff-without-docker",
      "guides/idempotent-postgres-migrations",
      "guides/rls-policy-migration-safety",
      "guides/generate-supabase-types-without-database",
      "guides/supabase-integration"
    ]
  },
  {
    "group": "Agents and CI",
    "icon": "bot",
    "pages": [
      "coding-agents",
      "coding-agents/agent-bundle",
      "guides/ci-github-actions",
      "guides/ci-gate"
    ]
  },
  {
    "group": "Evidence",
    "icon": "gauge",
    "pages": [
      "comparisons/supaschema-vs-supabase-cli",
      "benchmarks",
      "case-study-anilize",
      "guides/corpus-oracle"
    ]
  },
  {
    "group": "Reference",
    "icon": "library",
    "pages": [
      "reference/diagnostics",
      "reference/library-api",
      "reference/package-boundary",
      "reference/branding",
      "commands/other"
    ]
  }
]
```

Keep page paths extensionless and relative to the docs root.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 2: Align footer shortcuts with the new mental model

In `docs/docs.json`, keep footer links short and task-oriented. Suggested Product links:

- `Quickstart` -> `/quickstart`
- `Core workflow` -> `/commands`
- `Configuration` -> `/configuration/config-file`
- `Agents and CI` -> `/coding-agents`
- `Evidence` -> `/benchmarks`
- `FAQ` -> `/faq`

Keep Project links for GitHub, npm, comparison, and issues.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 3: Check generated route behavior

Run the full docs gate if the environment can use `npx`:

```bash
npm run docs:check
```

Expected: exit 0. If Mintlify reports a broken link, fix the navigation or footer link in `docs/docs.json` rather than hiding pages.

## Test plan

- Existing docs lint is the focused test.
- Full Mintlify validation is the integration test.
- No new unit tests are required because no lint rule changes are in this plan.

## Done criteria

- [ ] `docs/docs.json` uses the seven target groups: Start, Core workflow, Configure, Tasks, Agents and CI, Evidence, Reference.
- [ ] No public page is removed from navigation unless it has `hidden: true`.
- [ ] `npm run docs:lint` exits 0.
- [ ] `npm run docs:check` exits 0, or the operator records why `npx mint@4.2.616` could not run in the environment.
- [ ] Only `docs/docs.json` and `advisor-plans/README.md` are modified for this plan.

## STOP conditions

Stop and report back if:

- A live `docs/docs.json` excerpt no longer resembles the current state shown above.
- The desired grouping conflicts with a newer user-supplied docs taxonomy.
- The change appears to require renaming, deleting, or rewriting page bodies.
- `npm run docs:lint` fails twice after fixing obvious JSON/navigation mistakes.

## Maintenance notes

When future docs are added, place them by reader task first, directory second. A page path under `guides/` does not automatically belong under the "Tasks" group if the reader intent is evidence, reference, CI, or agent setup.
