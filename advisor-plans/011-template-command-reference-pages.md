# Plan 011: Template command reference pages and split utility commands

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0f7fd3e..HEAD -- docs/commands.mdx docs/commands docs/docs.json scripts/check-docs-standard.mjs tests/docs-standard.test.ts` and `git diff --stat -- docs/commands.mdx docs/commands docs/docs.json scripts/check-docs-standard.mjs tests/docs-standard.test.ts`. This plan was written against a dirty worktree, so preserve unrelated hunks.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `advisor-plans/008-docs-adhd-first-information-architecture.md`, `advisor-plans/010-standardize-mintlify-components-and-enforcement.md`
- **Category**: docs
- **Planned at**: commit `0f7fd3e`, 2026-06-16

## Why this matters

Command reference pages are where users go under pressure. Several are long enough to become mini-guides, and `commands/other.mdx` hides eleven public commands inside one accordion page. The elegant end state is one canonical owner per command, with a consistent template so readers can scan every command page the same way.

## Current state

Line counts from the audit:

- `docs/commands/other.mdx`: 297 lines, 11 commands in accordions.
- `docs/commands/types.mdx`: 235 lines, including a long generated output example from `docs/commands/types.mdx:98-188`.
- `docs/commands/verify.mdx`: 216 lines, including workflow diagram, flags, environment variables, diagnostics, exit codes, CI, and failure inspection.
- `docs/commands/check.mdx`: 211 lines, including rules, reporters, and a pre-commit hook.
- `docs/commands/diff.mdx`: 207 lines, including defaults, examples, flags, source specifiers, exit codes, and CI.

`docs/commands/other.mdx:13-25` lists utility commands, then each command gets an accordion:

```mdx
// docs/commands/other.mdx:27-50

<Accordion title="plan - Print the diff plan as JSON">
  `plan` runs the same comparison as `diff`, but prints JSON instead of writing
  SQL. ...
</Accordion>
```

The current command pages use different section names:

- `diff`: Default behavior, Examples, Flags, Source Specifiers, Exit Codes, CI Integration.
- `check`: Input, Examples, Flags, Rules, Exit Codes, Reporters in Detail, Pre-commit Hook.
- `verify`: How It Works, Examples, Flags, Environment Variables, Diagnostic Codes, Exit Codes, CI Integration, Inspecting Failures.
- `types`: How it works, Auto-run with `diff`, Configuration, Flags, Usage, Example output, Use in TypeScript apps, Integrating with the Supabase client, Keeping types in sync in CI.

## Command page template

Every command page should use this order unless a section truly does not apply:

1. one-sentence use case;
2. `## Run it` with the most common command first;
3. `## What it does` for current behavior;
4. `## Flags` using `<ParamField>`;
5. `## Output` for expected output or generated files;
6. `## Diagnostics and exit codes` for codes, safety warnings, and failure behavior;
7. `## Related` with a small card grid.

Keep long examples in accordions under the section that needs them. Do not make the first screen a wall of flags.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- | --- |
| Docs lint | `npm run docs:lint` | exit 0 |
| Docs-standard tests | `npm test -- tests/docs-standard.test.ts` | exit 0 if lint rules changed |
| Full docs validation | `npm run docs:check` | exit 0 |
| Search old utility page refs | `rg -n "commands/other | /commands/other" docs README.md` | no public links except redirects or intentional changelog notes |

## Scope

**In scope**:

- `docs/commands.mdx`
- `docs/commands/diff.mdx`
- `docs/commands/check.mdx`
- `docs/commands/verify.mdx`
- `docs/commands/types.mdx`
- `docs/commands/migrations.mdx`
- `docs/commands/sync.mdx`
- `docs/commands/other.mdx` deletion or replacement
- new utility command pages under `docs/commands/`
- `docs/docs.json`
- `scripts/check-docs-standard.mjs` and `tests/docs-standard.test.ts` only if the command-page rule needs updates
- `advisor-plans/README.md` status row only when complete

**Out of scope**:

- CLI behavior changes.
- Source-code command implementation.
- Non-command concept/config/reference rewrites.
- Benchmark or generated image changes.

## Git workflow

- Preserve unrelated dirty hunks.
- Do not commit unless asked.
- Use a branch like `advisor/011-command-reference-template` if asked to branch.

## Steps

### Step 1: Update the command overview page

Make `docs/commands.mdx` the hub for command families:

- Core workflow: `diff`, `check`, `verify`, `types`.
- Operations: `migrations`, `sync`.
- Utilities: link to the new utility pages.

Use at most three `CardGroup` grids. Keep each card body to one short sentence.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 2: Create one page per utility command

Split `docs/commands/other.mdx` into these pages:

- `docs/commands/plan.mdx`
- `docs/commands/inspect.mdx`
- `docs/commands/fingerprint.mdx`
- `docs/commands/audit.mdx`
- `docs/commands/corpus.mdx`
- `docs/commands/doctor.mdx`
- `docs/commands/config-validate.mdx`
- `docs/commands/init.mdx`
- `docs/commands/completion.mdx`
- `docs/commands/explain.mdx`
- `docs/commands/selfcheck.mdx`

Each page must have `title`, `description`, and `keywords`. Use the command page template. Keep examples minimal: one common command and one advanced command if needed.

After moving content, delete `docs/commands/other.mdx` unless the operator explicitly wants a utility hub page. Add a redirect in `docs/docs.json`:

```json
{
  "source": "/commands/other",
  "destination": "/commands/plan"
}
```

If you keep a utility hub instead of deleting `commands/other.mdx`, mark it as a real hub with links only. Do not duplicate command reference bodies there.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 3: Add a nested Utilities group under command navigation

In `docs/docs.json`, replace the single `commands/other` nav item with a nested collapsed group:

```json
{
  "group": "Utilities",
  "expanded": false,
  "pages": [
    "commands/plan",
    "commands/inspect",
    "commands/fingerprint",
    "commands/audit",
    "commands/corpus",
    "commands/doctor",
    "commands/config-validate",
    "commands/init",
    "commands/completion",
    "commands/explain",
    "commands/selfcheck"
  ]
}
```

Keep this nested group under the command/reference area chosen in plan 008.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 4: Apply the template to core command pages

Rewrite `diff`, `check`, `verify`, `types`, `migrations`, and `sync` to the shared section order where possible:

- `## Run it`
- `## What it does`
- `## Flags`
- `## Output`
- `## Diagnostics and exit codes`
- `## Related`

Keep `ParamField` for all flags. Move long tables under accordions only when the section is not needed for the most common path.

Specific reductions:

- `types`: shorten generated output examples. Link deeper type usage to `/guides/generate-supabase-types-without-database`.
- `check`: keep the safety rules, but collapse reporter details and pre-commit hook into an accordion or related link.
- `verify`: keep the two-database model, but make the diagram optional under details; keep remote-database warning visible.
- `diff`: move source specifier details to `/concepts/sources` and keep only the common examples inline.

**Verify**: `npm run docs:lint` -> exit 0.

### Step 5: Update links and redirects

Search and update links:

```bash
rg -n "commands/other|/commands/other" docs README.md
```

Expected: no stale public links, except the redirect entry in `docs/docs.json`.

Run:

```bash
npm run docs:check
```

Expected: exit 0.

## Test plan

- `npm run docs:lint` after creating utility pages and after applying command templates.
- `npm run docs:check` after all link updates.
- If you update command-page lint rules, also run `npm test -- tests/docs-standard.test.ts`.

## Done criteria

- [ ] Utility command content is no longer hidden inside one long accordion page.
- [ ] Each public command has a canonical page.
- [ ] Command pages share a predictable section order.
- [ ] All flags remain documented with `<ParamField>`.
- [ ] `docs/docs.json` contains a nested Utilities group or another equally scannable command IA.
- [ ] `rg -n "commands/other|/commands/other" docs README.md` finds no stale public links except intentional redirects.
- [ ] `npm run docs:lint` exits 0.
- [ ] `npm run docs:check` exits 0, or the operator records why Mintlify could not run.

## STOP conditions

Stop and report back if:

- The CLI has added or removed commands since this plan was written and the utility list is stale.
- Splitting utility pages creates a navigation structure that Mintlify validation rejects.
- A command page requires behavior details that are not documented in source or tests.
- The rewrite would require changing CLI output, command flags, or package behavior.

## Maintenance notes

When a new CLI command ships, add a command page in the same change. The command overview should route readers; it should not become the reference body for a command.
