# Rule 05 — Decision protocol: research, don't poll

Technical and architecture decisions are resolved by **evidence from upstream canonical sources and current best practices**, never by presenting the user a decision menu.

## Hard rules

- **Do NOT present decision menus** (multiple-choice / AskUserQuestion) for a technical, architecture, library, schema, typing, or implementation choice. These are the agent's job to resolve.
- **Any task that mentions research, investigate, evaluate, compare, best practices, upstream, current guidance, or "latest" requires upstream verification before conclusions or implementation.** Use canonical sources first: official docs, specifications, release notes, maintainer guidance, source repositories, or first-party MCP/docs tools. Secondary sources can supplement but cannot replace upstream evidence.
- **For every decision where confidence is not 100%, research first.** Consult the authoritative upstream source for the tool in question before deciding. Prefer the docs MCP servers wired into this repo's `.mcp.json` for the stack they own:
  - `ultracite` and `biome` guidance via the `ultracite` MCP for lint/format policy (Rule 08).
  - `zod` MCP for Zod schema/typegen API specifics; `mintlify` MCP for docs-site components and structure (Rules 02/03); `cloudflare-docs` MCP for the docs Worker; `openaiDeveloperDocs` MCP when working on the agent MCP service surface.
  - `supaschema-docs` MCP and the project's own `docs/**`, `AGENTS.md`, and `.claude/rules/supaschema.md` for supaschema CLI/library behavior and migration policy.
  - `context7` (`resolve-library-id` → `query-docs`) as a second-opinion fallback for any other library/framework API when no more specific first-party MCP/docs source is configured.
  - `WebSearch` / `WebFetch` / the `deep-research` skill for current guidance not covered by a configured MCP.

  Then decide based on that evidence and state the source in the work.
- **Default to the upstream-canonical pattern.** When the stack provides a first-class mechanism, use it rather than a hand-rolled or bespoke alternative — e.g. generate TypeScript and Zod types from supaschema's declarative SQL tree (`supaschema types`) as the single source of truth for DB shapes/enums rather than hand-authoring them, and classify or mutate SQL through the libpg-query parse tree rather than ad hoc regex (Rule 07).

## The only decisions to escalate to the user

Escalation is reserved for choices that are genuinely the user's and cannot be resolved by research:

- Product scope / priorities / what to build.
- Irreversible or outward-facing actions (publishing, deploying, deleting, sending) — confirm per the operating rules (Rule 01).
- Secrets / credentials / spending real money (Rule 01).
- A genuine conflict between two of the user's own prior instructions.

Everything else: research the upstream best practice and proceed.

STOP if a research/investigation request is answered without upstream canonical sources, if best-practice claims are not verified against current authoritative guidance, or if a technical decision ships on a guess when an authoritative upstream source was available and not consulted.
