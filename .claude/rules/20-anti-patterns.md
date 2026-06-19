---
description: Consolidated anti-pattern index for prohibited agent, shell, git, security, migration, package, CI, and prompt-surface behavior.
---

# Rule 20 — Anti-patterns

## Contract

This rule owns the consolidated anti-pattern index. Domain rules own the positive workflow, detailed recovery path, and surface-specific verification. When a rule, hook, guard, skill, or CI check adds a prohibited pattern, update this rule in the same change.

Anti-patterns are STOP conditions. Do not narrow, bypass, weaken, or treat them as preferences. If a user explicitly asks for a prohibited action that can be approved, get that approval before running it and record the reason in the final report.

## Anti-pattern index

| Area | Anti-pattern | Owner and enforcement |
| --- | --- | --- |
| Gate integrity | Skipping, deleting, weakening, commenting out, bypassing, or baselining a failing guard, test, hook, assertion, or STOP condition. | Rule 01; `npm run guard`; response and hook gates. |
| Verification | Claiming completion without running the relevant check or documenting a concrete blocker. | Rule 01; final-response contract; `npm run guard`. |
| Verification | Claiming GitHub, CI, PR, branch, or checks are green without successful `github-checks` evidence, or while failed `statusCheckRollup` / CI inbox evidence remains unresolved. | Rules 12 and 21; CI inbox context through `scripts/agent-hooks/runner.mjs` and `scripts/github/ci-inbox-core.mjs`; Stop response-shape detector; `tests/agent-hook-core.test.ts`; `tests/github-ci-inbox.test.ts`; `npm run guard:agent`. |
| Agent response shape | Mechanism-only correctness answers: explaining runtime or upstream-valid behavior without the `$elegant` architecture/end-state disposition and verification disposition. | Rules 01 and 12; Stop response-shape detector; `scripts/guards/check-agent-hooks.mjs`; `tests/agent-hook-core.test.ts`; `npm run guard:agent`. |
| Change discipline | Minimal-patch bias: Preserving backwards compatibility behavior or paths, duplicate owners, wrappers, aliases, shims, export-only compatibility files, DTOs, facades, copied enum tuples, casts that patch missing contracts, local view-models, local compatibility layers, broader helper surfaces, allowlist exceptions, redundant docs, convenience entry points, placeholders, TODOs, or multiple entry points because they already exist or because consolidation is larger than patching around them. | `AGENTS.md` Repo-Wide Change Discipline; Rule 01; `scripts/guards/check-canonical-surfaces.mjs`; `npm run guard`. |
| Change discipline | Backwards compatibility behavior or paths, re-export shims, alias modules, wrappers, DTOs, facades, copied enum tuples, cast-based contract patches, local view-models, broader helper surfaces, transitional branches, convenience entry points, placeholders, TODOs, or compatibility layers that keep old paths instead of rewriting or deleting consumers. | `AGENTS.md` Repo-Wide Change Discipline; Rule 01; `$elegant`; `scripts/guards/check-canonical-surfaces.mjs`; `scripts/guards/check-agent-policy-standardization.mjs`; `npm run guard`. |
| Change discipline | Typed UI prop containers that rename, project, mirror, or locally re-own DB-backed generated contracts instead of using the generated contract directly. | `AGENTS.md` Repo-Wide Change Discipline; Rule 01; `$elegant`; `scripts/guards/check-agent-policy-standardization.mjs`; generated type checks. |
| Code/scripts | Comments in code or scripts. | Rule 01; `scripts/guards/check-canonical-surfaces.mjs`; `npm run guard`. |
| Code/scripts | Regex instead of AST/parser APIs. | Rule 07; `scripts/guards/check-canonical-surfaces.mjs`; parser tests; `npm run guard`. |
| Agent surfaces | Compatibility-only rule pointers, rule-citation shims, and generated mirrors for deleted owners. | Rules 01 and 18; `npm run sync:llm`; `npm run guard`. |
| Agent surfaces | Hiding source-repo runtime, rules, generated rule mirrors, or hook entrypoints behind `.gitignore` while tracked hook registration, tracked guards, or `AGENTS.md` depend on them. | Rules 13, 18, and 22; `scripts/guards/check-public-repo-surface.mjs`; `scripts/guards/check-agent-surface-parity.mjs`; `npm run guard:public-surface`; `npm run guard:agent`. |
| Agent surfaces | Hand-authoring `.codex/hooks.json`, package Codex hook templates, `.codex/**` generated mirrors, or `.agents/**` mirrors instead of editing the Claude owner or `scripts/skills/sync-llm.mjs` and running `npm run sync:llm`. | Rules 12, 18, and 22; `npm run sync:llm:check`; `scripts/guards/check-agent-hooks.mjs`; `scripts/guards/check-agent-surface-parity.mjs`; `npm run guard:agent`. |
| Agent surfaces | Closing hook, context, rule, sync, generated-surface, package-template, or runtime behavior with a docs-only or skill-only update while the runtime path, guard, focused test, validation script, generated mirror, consumer/package disposition, or Claude/Codex disposition is missing. | `AGENTS.md` enforcement closure ledger; Rules 01, 12, 18, and 22; `$update`; `$claude-optimizer`; `$codex-optimizer`; `scripts/guards/check-agent-hooks.mjs`; focused agent hook/sync tests. |
| Worktree | Reverting, stashing, resetting, cleaning, or overwriting unrelated tracked or untracked work. | Rule 14; `git status --short`; diff review. |
| Editing | Broad substring replacement over identifiers, shell write tricks for source edits, or generated-surface hand edits. | Rules 07, 14, and 18; Code Atlas, cclsp, sync guards. |
| Git | `git checkout`, `git switch`, `git branch`, `git worktree`, `git reset`, `git restore --source`, `git stash`, local `git merge --squash`, destructive branch operations, and force-push without explicit approval. | Rule 14; Bash blocker; worktree closeout checks. |
| Git | `git commit --no-verify`, `git push` as a diagnostic probe, and force-push to `main`. | Rules 14 and 19; Bash blocker; release/version guards. |
| Shell delete | `rm -rf` and equivalent recursive-plus-force deletion. Plain recursive `rm -r` is not blocked by the generic Bash blocker, but deleting user-owned data still requires approval. | Rule 14; Bash blocker. |
| Secrets | Hardcoded API keys, JWTs, database URLs with passwords, access tokens, private keys, session cookies, provider credentials, or complete fake credentials in tests. | Rule 15; secret scanners; package/docs checks. |
| Secrets | Reading `.env*`, key, certificate, or secret directories just to inspect configuration. | Rule 15; Bash blocker; FastMCP deny-list. |
| Secrets | Secrets in argv, literal secret flags, inline secret env assignments, unredacted diagnostics, or package/docs examples containing real credentials. | Rule 15; Bash blocker; redaction tests; package/docs checks. |
| Shell safety | Interpolating user-controlled input into shell commands, or combining child-process args with `shell: true`. | Rules 13 and 15; tooling-stack guard. |
| Monetization | Adding Stripe checkout, Stripe secrets/catalog/session handling, GitHub Marketplace purchase/webhook handling, or license issuance outside `services/license-worker/**`, `scripts/stripe/create-catalog.mjs`, or `src/license.ts`. | Rule 01; `scripts/guards/check-canonical-surfaces.mjs`; `npm run guard:canonical-surfaces`. |
| Database | Raw SQL DDL through Bash or database CLIs for structural changes that belong in the declarative schema tree. | `supaschema.md`; Bash blocker; `supaschema diff` and `supaschema check`. |
| Database | Hand-editing generated migrations, overwriting generated migration files, bypassing lineage, using `--no-check-chain` without approval, or applying through `sync` without configured automatic sync approval or an explicit user-approved override target. | `supaschema.md`; migration hooks; supaschema guards. |
| Database | Wildcard destructive hints, unreviewed destructive operations, inferred renames, or committed hard-coded database URLs. | `supaschema.md`; config and migration checks. |
| Package | Adding root `.npmignore`, shipping maintainer-only tooling, publishing context hooks/agents/internal rules, lifecycle stdout noise, or build caches in the tarball. | Rule 13; `npm run check:package`; `npm pack --dry-run --json`. |
| Toolchain | Introducing pnpm, Yarn, Turborepo, competing formatters, SQL formatters, blanket key sorting, or formatter aliases outside the one-owner map. | Rules 01, 06, and 08; `npm run guard`; lint/type checks. |
| Analysis | Regex or string heuristics for code or SQL structure when AST/parser/model data exists. | Rule 07; `scripts/guards/check-canonical-surfaces.mjs`; parser tests; `npm run guard`. |
| Code Atlas | Making broad owner, route, consumer, DB, API, worker, generated-surface, or rollout claims without Code Atlas plus cclsp/source evidence. | Rule 10; Code Atlas guard and queries. |
| MCP | Exposing write authority, arbitrary shell execution, raw SQL, credential reads, external LLM proxying, or reads outside the repo in the FastMCP surface. | Rule 11; FastMCP guard and Python tests. |
| Agent surfaces | Duplicating durable policy across AGENTS, rules, skills, hooks, commands, generated mirrors, or docs; hand-editing generated `.codex/**` / `.agents/**` mirrors. | Rules 12, 17, and 18; `npm run sync:llm`; `npm run guard:agent`. |
| Agent surfaces | Adding regex intent metadata, unresolved placeholders, invented commands or paths, hidden assumptions, or stale plan text to agent prompts/rules/skills. | Rule 17; docs and agent-surface guards. |
| Docs | Publishing comparison pages with undated or unsourced external claims. | Rule 02; `scripts/check-docs-standard.mjs`; `npm run docs:lint`. |
| CI/release | Unpinning actions, adding stored npm publish tokens, weakening OIDC/provenance, path-skipping required gates, moving DB proofs into release, bypassing hooks, or publishing release notes from generated notes instead of the changelog. | Rules 09 and 19; CI and release guards. |

## Verification

When changing this rule or any anti-pattern enforcement surface, run:

```bash
npm run sync:llm
npm run guard
npm run typecheck
```

Add owner-specific checks when the touched anti-pattern belongs to a narrower surface:

```bash
npm run guard:agent
npm run check:package
npm run docs:check
supaschema check
```

Use the narrow command that proves the specific row changed, then the umbrella gate when rules, hooks, guards, package boundaries, generated surfaces, CI, or migration behavior changed.

## Failure behavior

If an anti-pattern is present, fix the canonical owner and rerun the failed guard. Do not silence the anti-pattern by weakening a rule, hook, guard, test, package allowlist, generated mirror, CI check, or scanner. If the action is user-approved and inherently risky, document the explicit approval, the exact command or file change, and the resulting verification.

## Done means

- The prohibited behavior is listed here.
- The owner rule contains the positive workflow and recovery path.
- The hook, guard, test, or CI lane that enforces the anti-pattern still passes.
- Generated Claude/Codex and `.agents` mirrors are current.
