# Update

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

Maintenance pass across existing repo documentation and context surfaces: rules, skills, commands, agents, hooks, scripts, `AGENTS.md`, runtime config, and generated mirrors.

## Scope

`.claude/skills/**`, `.claude/commands/**`, `.claude/agents/**`, `.claude/rules/**`, `.claude/hooks/**`, `.claude/settings*.json`, `.codex/skills/**`, `.codex/hooks/**`, `.codex/rules/**`, `.codex/config.toml`, `.agents/skills/**`, root `AGENTS.md`, the `services/agent-mcp` FastMCP side-service surface, `scripts/**` docs/guards/hooks/operators, root path-keyed configs (`package.json#scripts`, `biome.jsonc`/`ultracite` `overrides[]`), and `docs/**` when repo docs are the canonical owner.

Rules are the default prevention owner. Every `/update` pass must inspect `.claude/rules/**` first for the underlying lesson, then either update/create the applicable rule or record why the finding is not rule-level before any skill, AGENTS, docs, or hook-only update can count as complete.

Memory surfaces are off-policy in this repo. If the audit finds `.claude/memory/**` content, a `memory:` frontmatter on a `.claude/agents/**` file, or a guidance file that recommends memory writes as a canonical owner, treat it as a HIGH finding: promote anything worth keeping into `.claude/rules/**` first, then add hooks/skills/AGENTS only as supporting owners, and remove the off-policy surface.

External-technology instructions must be sourced from upstream MCP/docs first, official web fallback second, then installed/live proof. Repo owner and sync rules come from root `AGENTS.md`, `01-operating-rules.md`, `05-decision-protocol.md`, and `12-skill-loading-enforcement.md`; cross-reference those owners instead of restating them.

## Workflow

### Phase 1: Audit

1. **Inventory session lessons.** List corrections the user made, errors resolved (root cause, not symptom), non-obvious behaviors discovered, and patterns confirmed or rejected. Name the underlying `.claude/rules/**` owner for each lesson. If no rule owner fits, write the no-rule reason before considering another surface; a lesson with no stateable rule or no-rule reason is not ready to codify.
2. **Map related docs.** Read the rule owner first, then every related skill, agent, hook, script, command, `AGENTS.md`, generated-target owner, and docs surface in Scope. Use fixed-string search for prose evidence and AST/structured inspection for source, hook, script, import, SQL, or mutation classification.
3. **Delegate documentation review.** This `$update` workflow authorizes bounded read-only documentation review when the runtime exposes subagent tooling; it does not authorize implementation writes. If subagents are unavailable, audit directly and report that tooling blocker. Send self-contained prompts:
   - `docs-auditor`: duplicate owners, redundant instructions, stale references, and consolidation candidates across repo docs.
   - `upstream` lane: external-tech instructions checked against upstream sources via the `$upstream` skill.
   - `explorer`: owner, sync, and validation path when the surface is ambiguous.
4. **Validate findings.** Parent thread reconciles subagent results, reads each target file in full, and manually verifies HIGH/MEDIUM findings before edits. Flag files that contradict the lesson, teach the resolved error as correct, omit the lesson where it belongs, or restate it in stale/conflicting terms. Record path, line span, and required fix: update, correct, add, consolidate, or remove.
5. **Classify** confirmed gaps:
   - HIGH: route trees missing; guidance actively teaching the resolved error; off-policy memory writes recommended as canonical
   - MEDIUM: convention gaps, stale cross-references, lessons absent from the right owner
   - LOW: cosmetic or wording improvements
6. **Name the prevention owner** for each HIGH/MEDIUM finding: which existing `.claude/rules/**` file failed to prevent it, which rule file now codifies it, and which supporting skill, hook, command, script, or AGENTS brief also needs alignment. If no rule changes, state the no-rule reason and the non-rule owner. For hook findings, audit `.claude/hooks/**` plus `.claude/settings*.json` as canonical sources and `.codex/hooks/**` as the synced mirror.

### Phase 2: Plan

Pick the rule owner first for every finding:

- **Rule** — policy, ownership, or workflow beyond one feature surface
- **Skill** — reusable procedure or audit step loaded on demand
- **Hook** — failure detectable or blockable at a known runtime event surface without false positives; use `$claude-optimizer` for Claude hook changes and `$codex-optimizer` for Codex hook changes
- **AGENTS.md** — repo route map, conventions, or deltas an editor needs before any change
- **Skill reference** — implementation detail for one feature, not needed before every change
- **Script or guard docs** — deterministic operator behavior owned by `scripts/**` or package scripts
- **No change** — state explicitly why the finding is one-off or not automatable

Use non-rule owners only after the rule decision is explicit:

- If the lesson changes policy, ownership, workflow, or a recurring failure mode, update or create `.claude/rules/**`.
- If a skill, hook, AGENTS brief, command, or docs file needs the same lesson, update it as an adjunct to the rule, not as a substitute for the rule.
- If no rule change is appropriate, record the no-rule reason next to the selected owner.

Memory is never a valid owner in this repo. If no rule/hook/skill/script/AGENTS owner fits, the finding is either too situational to codify (mark "No change" with reason) or the existing owners need to be extended.

Cross-reference instead of restating. For architecture or shared-surface changes, review boundary owners together: root `package.json` guard/test script wiring, `scripts/guards/**`, `.claude/hooks/**`, `.claude/settings*.json`, and relevant skill references.

For package/service boundary lessons, verify both layers before selecting the owner:

- `npm run code-atlas:query -- entrypoints`, `npm run code-atlas:query -- impact <target>`, or `npm run code-atlas:query -- health <filter>` for repo-wide CLI surface, source, consumer, generated-surface, and package-boundary evidence. If the Code Atlas MCP is exposed, use the Code Atlas skill's MCP tool map for supplementary evidence.
- `npm run check:package` or `npm pack --dry-run` for npm package-boundary and published-tarball evidence when Rule 13 (`13-npm-package-boundary.md`) is the owner.
- the Python uv workspace at `services/agent-mcp` for FastMCP side-service evidence; verify with `npm run py:typecheck`, `npm run py:test`, and `npm run guard:fastmcp` when Rule 11 (`11-agent-mcp-fastmcp.md`) is the owner.
- `npm run guard:code-atlas` and `npm run guard` are the active local backstops for graph and cross-surface policy drift.

### Phase 3: Execute

Write or update `.claude/rules/**` first. If a rule needs to cross-reference a new skill reference, write that reference immediately before the rule and still update the rule in the same pass. Do not let a skill reference, AGENTS brief, docs edit, or generated mirror be the only prevention update for a rule-level lesson.

Writing style follows the operating rules in `01-operating-rules.md`: lead with the rule, strip filler, keep direct surfaces concise, and cross-reference rather than restating ownership matrices.

When moving Markdown bodies into `references/**`, update relative links for the new location before syncing. Links that originally pointed from `SKILL.md` or `AGENTS.md` into `references/` usually need to become sibling links inside the reference directory. `npm run guard:agent` must pass before closeout.

For hook work, correct every affected native hook surface in the same pass. Claude hook changes update `.claude/hooks/**` and `.claude/settings*.json` with the exact event surface and matcher. Repo-local Codex hook parity is the mirrored `.codex/hooks/**` surface enforced by `npm run sync:llm` and `npm run guard:agent`; do not hand-edit generated mirrors. Skill changes also regenerate `.agents/skills/**` from `.claude/skills/**`.

Update adjacent surfaces made inaccurate by the change: root `AGENTS.md`, skill reference READMEs, rule cross-references. Remove any `.claude/memory/**` files surfaced during the pass and replant their content into `.claude/rules/**` first, then AGENTS, skills, hooks, or settings only as supporting surfaces.

Repo-managed skill sources are editable source, not immutable artifacts. If `.claude/skills/**` or synced `.agents/skills/**` entries are missing owner read/write permissions, repair the permissions before sync instead of preserving chmod drift.

Do not close with a findings list. When the user invokes `$update` with words such as "make", "update", "fix", "correct", "codify", "apply", or "implement", confirmed HIGH/MEDIUM findings are execution scope in the same turn unless the user explicitly asked for audit-only output. Every confirmed finding becomes a prevention update or a recorded reason prevention stops at documentation.

### Phase 4: Validate

Use the owner matrix in root `AGENTS.md` and Rule 12 (`12-skill-loading-enforcement.md`). After editing canonical `.claude/rules/**`, `.claude/skills/**`, or `.claude/hooks/**` sources, run `npm run sync:llm` to regenerate managed mirrors. For other touched surfaces, run only the matching owner checks:

- `npm run guard:agent` — `.claude/{skills,hooks,rules}`, mirrored `.codex/{skills,hooks,rules}`, or mirrored `.agents/skills` changed.
- `npm run lint` (Ultracite check) or `npm run lint:ci` (Biome CI) — `biome.jsonc`, `ultracite` config, lint scripts, or root lint-surface paths changed; Rule 08 (`08-biome-ultracite-policy.md`) is the owner.
- `npm run guard:code-atlas` — Code Atlas sources, MCP wiring, or atlas-owned claims changed; Rule 10 (`10-code-atlas.md`) is the owner.
- `npm run guard:fastmcp`, `npm run py:typecheck`, `npm run py:test` — `services/agent-mcp` FastMCP side-service or Python toolchain changed; Rule 04 (`04-python-toolchain.md`) and Rule 11 (`11-agent-mcp-fastmcp.md`) are the owners.
- `npm run guard` — root `AGENTS.md`, MCP/config references, cross-surface reference integrity, or mixed owner changes.
- Targeted script/guard/test command (`npm run test`, `npm run check:package`, `npm run check:schema`, `npm run docs:check`) — `scripts/**`, package scripts, CLI defaults, schema, or guard behavior changed.

Stop validation at the owner surface. A `/update` pass is not a general runtime smoke pass: do not run product-route probes, restart long-running processes, or apply migrations to a database unless the user explicitly asks for runtime verification or the prevention edit changed runtime code that cannot be checked by the matching owner checks. If a `/update` pass includes an incidental code fix, run the smallest proof for that exact file or behavior (for SQL/CLI changes, the relevant targeted Vitest plus `npm run typecheck`), then return to the guidance completion gate.

Use `npm run sync:llm` to regenerate managed mirrors when a single canonical surface changed. Line-count growth must come from new policy, not verbosity; default to net-zero or net-negative for tightening passes.

## Completion Gate

- Every HIGH/MEDIUM finding is fixed in the right owner or explicitly mapped to one.
- `$update` was treated as an implementation skill, not an audit-only report, unless the user explicitly requested report-only output.
- Every HIGH/MEDIUM finding has a `.claude/rules/**` update or an explicit no-rule reason before any non-rule owner is accepted as complete.
- Root `AGENTS.md` entries invalidated by the pass are corrected in the same pass.
- No off-policy memory surface remains (`.claude/memory/**`, `memory:` agent frontmatter, or command/skill prose that treats memory writes as guidance).
- Repo-managed skill sources and synced mirrors are owner-writable; repair permission drift before sync.
- Hook enhancements document the event surface, matcher, payload contract, and output contract in the runtime-specific owner.
- Synced compatibility surfaces refreshed from `.claude/**` sources before handoff.
- Related documentation was reviewed for duplicate owners, redundancies, stale references, upstream-source drift, and consolidation opportunities.

## Subagent Review

Subagent work is read-only until the parent accepts and applies findings. Prompts must include scope, allowed actions, evidence required, output format, uncertainties, blockers, and the exact owner question. The parent owns final decisions, edits, validation, and contradiction resolution.

## Concurrency

Phase 1 read-only exploration should parallelize through subagents when the runtime exposes them and this `$update` workflow or the user has authorized delegation. Phase 3 writes serialize when they touch overlapping files. See `.claude/skills/task-creator/references/concurrency-policy.md`.
