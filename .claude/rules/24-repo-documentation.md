---
description: Short, direct, future-agent-readable repo documentation.
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

Repo docs are future agent context. Write them so a later Codex or Claude session can find the owner, read the minimum text, and act.

## Rules

- Use the fewest words that preserve the instruction.
- Make the owner, path, and next action obvious.
- Prefer updating an existing doc. Add a new doc only when no owner fits.
- Keep headings direct and sections short.
- Use concrete paths, commands, and names.
- Delete stale, duplicated, vague, or explanatory filler while editing.
- Do not add history, rationale, plans, TODOs, or broad examples unless needed to act.
- If a doc is hard to find, move it, rename it, or route to it from the owner map.
- Split long docs by when they must be read, not by topic sprawl.
- For `docs/**`, follow Rule 02. For agent instruction surfaces, follow Rule 17. For package docs, follow Rule 13.

## Verification

- Rules, skills, or agent surfaces: `npm run sync:llm` and `npm run guard:agent`.
- Public docs: `npm run docs:check`.
- Root maps or mixed documentation changes: `npm run guard`.

## Failure behavior

Fix the owner. Do not create a second doc to avoid simplifying the first one.

## Done means

The doc is short, findable, current, and easy for a future agent to consume.
