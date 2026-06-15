# Rule 01 — Operating rules

The non-negotiable working agreement for any agent or contributor in this repo. The standing rules live in the root `AGENTS.md` and the per-concern files under `.claude/rules/`; this file states the operating discipline that governs how all of them are applied.

## Hard rules

- **Follow the gates; do not skip a STOP condition.** Every concern has a STOP gate with an executable enforcement path. A red gate is a real failure — fix the cause, never weaken, disable, skip, or comment out a guard, test, hook, or assertion to make it pass. The umbrella gate is `npm run guard` (`scripts/guards/check-all.mjs`), which must print `ALL_GUARDS_OK`.
- **No standard without enforcement.** A rule, contract, or STOP gate that no guard or test reaches is incomplete — wire it into `npm run guard` or a test, do not leave it as prose.
- **Resolve technical choices by research, not by polling the user** (Rule 05): default to the upstream-canonical pattern and cite the source. Escalate only product scope, irreversible/outward-facing actions, secrets/spend, or a genuine conflict between the user's own prior instructions.
- **Generated types come from the declarative tree, never hand-rolled.** supaschema generates `database.types.ts` and `database.zod.ts` from the declarative SQL tree and source model (`supaschema types`), not from live database introspection (`.claude/rules/supaschema.md`).
- **Stay inside the governed toolchain** (Rules 04/06/08): navigate and refactor via cclsp; format and lint with the one owner per concern — `ruff` for Python, Biome via Ultracite for JS/TS/JSON/CSS/HTML/GraphQL; analyze code structure with an AST, never ad hoc regex (Rule 07).
- **Use Code Atlas for repo-wide graph claims** (Rule 10): build and query the atlas before broad owner, route, consumer, dependency, DB, API, worker, generated-surface, or rollout assertions, then prove exact behavior with cclsp and direct source reads.
- **Keep agent surfaces synchronized.** After changing one of the six mirrored skills (`code-atlas`, `fastmcp`, `fastmcp-client-cli`, `supaschema`, `ultracite`, `upstream`), run `npm run sync:llm` so the `.codex/skills` and `.agents/skills` mirrors stay byte-identical to their `.claude/skills` owners (Rule 12). Codex hooks stay native; Codex rule files should hold executable command policy or short pointers to canonical rule owners, not duplicated long-form policy.
- **Operator and agent guidance lives in `AGENTS.md` and `.claude/rules/`;** `README.md` is the npm package landing page and `docs/` is the Mintlify site. The published npm package boundary is the `package.json` `files` allowlist (Rule 13).
- **The package manager is npm.** Never introduce pnpm, yarn, or an alternate lockfile; preserve `package-lock.json`. There is no Turborepo, no workspaces, and no `apps/` in this single-package repo.
- **Commit only when asked; branch off the default branch first;** let lefthook run (never `--no-verify`).

## Enforced by

- `npm run guard` (`scripts/guards/check-all.mjs`) is the umbrella gate — tooling stack, agent hooks, agent-surface parity, rule-citation integrity, dependency catalog, Code Atlas, LSP coverage, FastMCP surface, and no-regex-in-scripts. lefthook (`pre-commit` runs Biome on staged files; `pre-push` runs `npm run typecheck` + `npm run guard`) and the PreToolUse/PostToolUse hooks enforce in-loop.

STOP if any STOP condition in `.claude/rules/*` is skipped, a guard or test is weakened instead of its cause being fixed, a standard ships without an executable enforcement path, the package manager is switched away from npm, or a technical decision ships on a guess when an authoritative upstream source was available.
