---
description: Repo documentation authoring policy: short, findable, owner-based docs for future agents.
paths:
  - "README.md"
  - "docs/**"
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".claude/rules/**"
  - ".claude/skills/**"
  - ".claude/agents/**"
  - ".claude/commands/**"
  - ".agents/skills/**"
---

# Rule 24 - Repo documentation

## Contract

This rule owns repo documentation changes: create, add, edit, move, or delete docs only when the owner is clear and the result is easy for a future agent to find and reread.

## Rules

- Pick one owner before writing. Public docs live in `docs/**`; the package landing page is `README.md`; operator policy lives in `.claude/rules/**`; workflows live in `.claude/skills/**`; route maps live in `AGENTS.md`.
- Prefer updating an existing owner. Add a new doc only when no existing owner fits.
- Write for the next agent rereading the repo. Use short sections, direct headings, concrete paths, and exact commands.
- Keep docs small. Delete stale or duplicate text while adding new guidance.
- Link to the canonical owner instead of restating it.
- Do not add history, rationale, plans, TODOs, or broad examples unless they are needed to act.
- For `docs/**`, follow Rule 02. For agent instruction surfaces, follow Rule 17. For package docs, follow Rule 13.

## Verification

- Rules, skills, or agent surfaces: `npm run sync:llm`, then `npm run guard:agent`.
- Public docs: `npm run docs:check`.
- Root briefs or mixed documentation changes: `npm run guard`.

## Failure behavior

Fix the canonical owner. Do not patch generated mirrors or create a second doc to work around stale text.

## Done means

The doc has one job, points to the right owner, removes stale duplication, and refreshes generated mirrors when needed.
