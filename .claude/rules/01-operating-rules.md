---
enforcement:
  type: judgment-only
description: Repo-wide authorization, gate integrity, enforcement closure, evidence, and closeout.
paths:
  - "src/**"
  - "tests/**"
  - "docs/**"
  - "scripts/**"
  - "bin/**"
  - "benchmarks/**"
  - "services/**"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - ".github/**"
  - "AGENTS.md"
  - "CLAUDE.md"
  - "package.json"
  - "biome.jsonc"
  - "lefthook.yml"
  - "wrangler.toml"
  - "tsconfig*.json"
---

# Rule 01 - Operating rules

## Contract

This rule owns repo-wide authorization, gate integrity, enforcement closure, canonical-owner discipline, evidence, validation, and closeout. `AGENTS.md` is the canonical Codex runtime entrypoint. Durable prevention standards live in the closest `.claude/rules/**` owner.

## Action boundary

- Answer, explain, review, diagnose, research, or plan requests authorize inspection and reporting. Do not edit files or perform external writes unless the user also asks for a change.
- Change, build, fix, or implement requests authorize in-scope local edits and relevant non-destructive validation.
- Get explicit confirmation before destructive or irreversible actions, external writes, real spending, secret use, or material scope expansion. Stage, commit, push, publish, deploy, merge, and send only when asked.
- Leave unrelated changes untouched.

## Gate integrity and enforcement closure

- Treat failing guards, tests, hooks, assertions, and STOP conditions as evidence. Fix the cause. Do not weaken, skip, baseline, bypass, or delete the gate to make it pass.
- Close every HIGH or MEDIUM finding with an enforcement-closure disposition before closeout. The same applies to recurring lessons, architecture changes, hook changes, generated-surface changes, and package-boundary changes.
- The closure ledger covers: rule owner; Claude and Codex runtime or hook path; guard; focused test; CI or validation script; skill repair guidance; generated mirrors; and consumer or package surface.
- Every ledger row must be `updated`, `already covered` with evidence, or `not applicable` with an owner-scoped reason. A docs-only or skill-only change cannot close executable behavior, hook, sync, generated-surface, or package work.
- Add a guard or test only when it can check a concrete recurring invariant or changed executable or public behavior precisely. Do not invent prose scanners, semantic allowlists, or architecture-judgment detectors to fill a ledger row.
- `npm run guard` is the umbrella rule gate. It must finish with `ALL_GUARDS_OK` when a cross-cutting rule, hook, package, migration, toolchain, or CI contract changes.

## Owner and end-state discipline

- Name the canonical owner and intended end state before adding or preserving a surface. Prefer existing owners, direct consumers, clear types, and simple control flow.
- Use `$elegant` when consolidation, simplification, deletion, compatibility removal, or duplicate ownership is part of the accepted scope. Do not preserve avoidable shims, wrappers, aliases, copied contracts, cast-based patches, placeholders, TODOs, transitional branches, redundant docs, or multiple entry points.
- Prefer owner consolidation, direct consumer rewrites, and existing proof from types, tests, builds, imports, or the package boundary. Add a new guard, allowlist, registry, or contract module only after those options fall short.
- Treat existing patterns as evidence, not authority. Derive the change from the requested outcome, protected invariant, current source, and authoritative upstream behavior.

## Evidence and execution

- Use repo evidence for local behavior and authoritative upstream sources for material external claims.
- Use repository instructions and manifests to establish ownership. Use structured APIs, language servers, compilers, and parsers for dependency, consumer, route, generated-surface, delete, rename, move, and rollout claims. Use direct source reads and exact fixed-string searches for final proof.
- Resolve technical implementation choices from evidence. Ask the user only for product scope, irreversible or outward-facing actions, secrets, spending, material permission expansion, or genuine instruction conflicts.
- For complex work, use a short plan or checklist when it prevents missed dependencies. Continue through implementation and relevant validation. Update the user at major phase changes and stop routine tool narration.
- Use subagents only when authorized and when bounded independent work improves coverage or latency. Require evidence, files inspected, uncertainty, risks, and validation. Keep final judgment and integration in the parent.
- Protect context. Scope commands before printing, byte-cap unknown or potentially large output, preserve exit status when it matters, and read instruction, skill, tool, and policy files completely.
- Validate in proportion to risk with the narrowest command that proves the outcome. Broaden only when shared behavior or an owner rule requires it. If validation is unavailable, state what was not run and why.
- Keep durable policy in `.claude/rules/**`, reusable workflows in `.claude/skills/**`, deterministic enforcement in hooks or guards, and generated mirrors under their declared sync owner.

Stop when the requested outcome, impacted-owner follow-through, enforcement closure, and relevant validation are complete. Do not add unrelated cleanup or recommendations. When missing authority, evidence, or an external dependency blocks completion, report the concrete blocker and the smallest next decision.

## Verification

Run the closest owner check for changed behavior. Use `npm run guard` for cross-cutting rule, hook, package, migration, toolchain, or CI changes.

## Failure behavior

Fix the canonical owner and rerun the failing owner check. Do not close a task with a missing enforcement-closure row, an unverified material claim, a weakened gate, or an unsynced generated target.

## Done means

The authorized outcome is complete and every HIGH or MEDIUM finding has a full closure disposition. Evidence supports material claims, relevant checks passed or their absence is explained, generated targets are current, and unrelated work remains intact.
