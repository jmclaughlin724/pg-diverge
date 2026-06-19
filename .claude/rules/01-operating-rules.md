---
description: Repo operating discipline: STOP gates, enforcement, technical decisions, npm-only package manager, and closeout behavior.
---

# Rule 01 — Operating rules

## Contract

This rule owns the repo-wide operating discipline that applies every other rule: gates are real, technical decisions are evidence-based, npm is the only package manager, and no standard ships without an executable enforcement path.

The non-negotiable working agreement for any agent or contributor in this repo. Standing rules live in the per-concern files under `.claude/rules/`; `AGENTS.md` is the root route map that points agents to those owners.

## Hard rules

- **Follow the gates; do not skip a STOP condition.** Every concern has a STOP gate with an executable enforcement path. A red gate is a real failure — fix the cause, never weaken, disable, skip, or comment out a guard, test, hook, or assertion to make it pass. The umbrella gate is `npm run guard` (`scripts/guards/check-all.mjs`), which must print `ALL_GUARDS_OK`.
- **No standard without enforcement.** A rule, contract, or STOP gate that no guard or test reaches is incomplete — wire it into `npm run guard` or a test, do not leave it as prose. A docs-only or skill-only change cannot close hook, context, rule, sync, generated-surface, package-template, or runtime behavior unless the enforcement closure ledger in `AGENTS.md` records the runtime/hook path, guard, focused test, validation script, generated mirrors, consumer/package disposition, and explicit Claude/Codex disposition. STOP IF any ledger row is missing a verified update, already-covered finding, or owner-scoped not-applicable reason.
- **Anti-patterns stay indexed.** Rule 20 is the single repo-wide anti-pattern inventory. When a rule, hook, guard, skill, or CI lane adds a prohibited pattern, update Rule 20 in the same change and keep the domain rule focused on the positive workflow and recovery path.
- **Use `$elegant` only.** DEFAULT TO `$elegant` for every task and action. MUST NOT create or keep backwards compatibility behavior or paths, export-only compatibility files, shims, aliases, wrappers, DTOs, facades, copied enum tuples, casts that patch missing contracts, local view-models, local compatibility layers, broader helper surfaces, allowlist exceptions, transitional branches, comments in code or scripts, redundant or convenience entry points, placeholders, TODOs, regex, or duplicate owners. Typed UI prop containers are allowed only when DB-backed payloads use direct generated contracts without renaming, projection, mirroring, or local ownership. Use AST only for structural analysis. Treat external-contract conflicts as STOP conditions; solve them in the canonical owner. STOP IF the approach preserves an old path or patches around a missing contract instead of rewriting or deleting its consumers in the same change. VERIFY with Code Atlas impact/consumer queries plus AST/LSP import-export-symbol inspection before deleting or privatizing a public surface, and with `scripts/guards/check-canonical-surfaces.mjs` for code-surface shape. FIX BY moving behavior into the canonical owner, updating consumers, and deleting the legacy surface.
- **Enforce the AGENTS-owned change discipline.** MUST follow the `AGENTS.md` Repo-Wide Change Discipline before adding or preserving any surface. `AGENTS.md` owns the sequence; this rule owns the STOP gate and guard wiring. STOP IF the accepted scope keeps backwards compatibility behavior or paths, backwards-compatibility shims, export-only compatibility files, avoidable duplicate owners, wrappers, aliases, DTOs, facades, copied enum tuples, cast-based contract patches, local view-models, local compatibility layers, broader helper surfaces, allowlist exceptions, redundant docs, placeholders, TODOs, or multiple entry points without a named distinct runtime, storage, compliance, lifecycle, or external-contract boundary. VERIFY by naming the canonical owner, the single entry point, and the direct source or Code Atlas evidence. FIX BY merging, moving, deleting, or documenting the distinct boundary that justifies a separate surface.
- **Separate mechanism, end state, and verification for correctness work.** Diagnostic, review, verification, source, why, correctness, best-practice, redundancy, and architecture-shaped tasks MUST name the runtime mechanism, the `$elegant` architecture/end-state disposition, and the verification disposition before claiming correctness. STOP IF the answer treats upstream-valid runtime behavior as proof of local correctness, omits the canonical owner or end-state disposition, or omits commands, sources, failures, skipped checks, or blockers. VERIFY with Rule 12 response-shape enforcement, `scripts/agent-hooks/detectors.mjs`, `tests/agent-hook-core.test.ts`, and `npm run guard:agent`. FIX BY revising the answer or running the missing verification before making the correctness claim.
- **Reason from source, not pattern.** Derive changes from the requested end state and protected invariant; treat existing patterns as evidence, not authority. When mechanisms overlap, verify the canonical upstream source before keeping, consolidating, or replacing enforcement. Add only surfaces that directly protect the verified invariant. VERIFY by naming the source and invariant before editing; guards must check behavior, not incidental shape.
- **Resolve technical choices by research, not by polling the user** (Rule 05): default to the upstream-canonical pattern and cite the source. Escalate only product scope, irreversible/outward-facing actions, secrets/spend, or a genuine conflict between the user's own prior instructions.
- **Generated types come from the declarative tree, never hand-rolled.** supaschema generates `database.types.ts` and `database.zod.ts` from the declarative SQL tree and source model (`supaschema types`), not from live database introspection (`.claude/rules/supaschema.md`).
- **Stay inside the governed toolchain** (Rules 04/06/08): navigate and refactor via cclsp; format and lint with the one owner per concern — `ruff` for Python, Biome via Ultracite for JS/TS/JSON/CSS/HTML/GraphQL; analyze code structure with an AST, never regex (Rule 07).
- **Use Code Atlas for repo-wide graph claims** (Rule 10): build and query the atlas before broad owner, route, consumer, dependency, DB, API, worker, generated-surface, or rollout assertions, then prove exact behavior with cclsp and direct source reads.
- **Keep agent surfaces synchronized.** After changing one of the six mirrored skills (`code-atlas`, `fastmcp`, `fastmcp-client-cli`, `supaschema`, `ultracite`, `upstream`), run `npm run sync:llm` so the `.agents/skills` mirror stays byte-identical to its `.claude/skills` owner (Rule 12). Codex hooks stay native; Codex rule files should hold executable command policy or short pointers to canonical rule owners, not duplicated long-form policy.
- **Durable operator policy lives in `.claude/rules/`, not `AGENTS.md`.** `AGENTS.md` is a concise repo map and rule index; `README.md` is the npm package landing page and `docs/` is the Mintlify site. The published npm package boundary is the `package.json` `files` allowlist (Rule 13).
- **The package manager is npm.** Never introduce pnpm, yarn, or an alternate lockfile; preserve `package-lock.json`. There is no Turborepo, no workspaces, and no `apps/` in this single-package repo.
- **Commit only when asked; keep work on the current branch and current worktree;** let lefthook run (never `--no-verify`).

## Enforced by

- `npm run guard` (`scripts/guards/check-all.mjs`) is the umbrella gate — tooling stack, canonical surface shape (`scripts/guards/check-canonical-surfaces.mjs`), agent hooks, agent-surface parity, policy standardization (`scripts/guards/check-agent-policy-standardization.mjs`), rule-citation integrity, dependency catalog, Code Atlas, LSP coverage, and FastMCP surface. lefthook (`pre-commit` runs Biome on staged files; `pre-push` runs `npm run typecheck` + `npm run guard`) and the PreToolUse/PostToolUse hooks enforce in-loop.

STOP if any STOP condition in `.claude/rules/*` is skipped, a guard or test is weakened instead of its cause being fixed, a standard ships without an executable enforcement path, hook/context/rule/sync/package-template behavior changes without the `AGENTS.md` enforcement closure ledger, the package manager is switched away from npm, a technical decision ships on a guess when an authoritative upstream source was available, an approach preserves avoidable duplication because removing it would be a larger patch, a backwards compatibility path, export-only compatibility file, shim, placeholder, or TODO remains in the accepted scope, or avoidable duplicate or redundant surfaces or multiple entry points remain in the accepted scope.

## Verification

Run the narrowest command that proves the touched rule, then the umbrella gate when rule, hook, package, migration, toolchain, or CI behavior changed.

Required closeout checks when this rule or a cross-cutting rule changes:

```bash
npm run guard
npm run typecheck
```

`npm run guard` must finish with `ALL_GUARDS_OK`.

## Failure behavior

If any gate fails, fix the underlying cause and rerun the failed command. Do not weaken, disable, skip, comment out, baseline, or bypass a guard, test, hook, assertion, or STOP condition to make the run green.

## Done means

Every accepted instruction has a disposition: resolved with evidence, not applicable with evidence, or blocked by a concrete external constraint after investigation. Deferral and future cleanup are not closeout states.
