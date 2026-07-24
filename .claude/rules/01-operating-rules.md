---
description: Repo-wide authorization, gate integrity, enforcement closure, evidence, npm, and closeout.
---

# Rule 01 - Operating rules

## Contract

This rule owns repo-wide authorization, gate integrity, enforcement closure, canonical-owner discipline, evidence, validation, npm, and closeout. `AGENTS.md` is the canonical Codex runtime entrypoint; durable prevention standards also live in the closest `.claude/rules/**` owner.

## Action boundary

- Answer, explain, review, diagnose, research, or plan requests authorize inspection and reporting. Do not edit files or perform external writes unless the user also asks for a change.
- Change, build, fix, or implement requests authorize in-scope local edits and relevant non-destructive validation.
- Get explicit confirmation before destructive or irreversible actions, external writes, real spending, secret use, or material scope expansion. Stage, commit, push, publish, deploy, merge, and send only when asked.
- Preserve concurrent work. Work with overlapping changes and leave unrelated changes untouched.

## Gate integrity and enforcement closure

- Treat failing guards, tests, hooks, assertions, and STOP conditions as evidence. Fix the cause; do not weaken, skip, baseline, bypass, or delete the gate to make it pass.
- Every HIGH or MEDIUM finding, recurring lesson, architecture change, hook change, generated-surface change, or package-boundary change requires an enforcement-closure disposition before closeout.
- The closure ledger covers: rule owner; Claude and Codex runtime or hook path; guard; focused test; CI or validation script; skill repair guidance; generated mirrors; and consumer or package surface.
- Every ledger row must be `updated`, `already covered` with evidence, or `not applicable` with an owner-scoped reason. A docs-only or skill-only change cannot close executable behavior, hook, sync, generated-surface, or package work.
- Add a guard or test only when it can check a concrete recurring invariant or changed executable/public behavior precisely. Do not invent prose scanners, semantic allowlists, or architecture-judgment detectors merely to fill a ledger row.
- `npm run guard` is the umbrella rule gate and must finish with `ALL_GUARDS_OK` when a cross-cutting rule, hook, package, migration, toolchain, or CI contract changes.

## Owner and end-state discipline

- Name the canonical owner and intended end state before adding or preserving a surface. Prefer existing owners, direct consumers, clear types, and simple control flow.
- Use `$elegant` when consolidation, simplification, deletion, compatibility removal, or duplicate ownership is part of the accepted scope. Do not preserve avoidable shims, wrappers, aliases, copied contracts, cast-based patches, placeholders, TODOs, transitional branches, redundant docs, or multiple entry points.
- Prefer owner consolidation, direct consumer rewrites, and existing type, test, build, import, or package proof before adding a new guard, allowlist, registry, or contract module.
- Treat existing patterns as evidence, not authority. Derive the change from the requested outcome, protected invariant, current source, and authoritative upstream behavior.

## Evidence and execution

- Use repo evidence for local behavior and authoritative upstream sources for material external claims. Absence from one search is not proof that a surface does not exist; try one or two meaningful fallbacks before concluding it is unavailable.
- Use structured APIs or parsers for structural questions. Use Code Atlas before broad ownership, dependency, consumer, route, generated-surface, delete, rename, move, or rollout claims; use focused source and structural tooling for exact behavior.
- Resolve technical implementation choices from evidence. Ask the user only for product scope, irreversible or outward-facing actions, secrets, spending, material permission expansion, or genuine instruction conflicts.
- For complex work, use a short plan or checklist when it prevents missed dependencies. Continue through implementation and relevant validation, update the user at major phase changes, and stop routine tool narration.
- Use subagents only when authorized and when bounded independent work improves coverage or latency. Require evidence, files inspected, uncertainty, risks, and validation; keep final judgment and integration in the parent.
- Protect context. Scope commands before printing, byte-cap unknown or potentially large output, preserve exit status when it matters, and read instruction, skill, tool, and policy files completely.
- Validate in proportion to risk with the narrowest command that proves the outcome. Broaden only when shared behavior or an owner rule requires it. If validation is unavailable, state what was not run and why.
- Keep durable policy in `.claude/rules/**`, reusable workflows in `.claude/skills/**`, deterministic enforcement in hooks or guards, and generated mirrors under their declared sync owner.
- npm is the JavaScript package manager. Preserve `package-lock.json`; do not introduce pnpm, Yarn, or another lockfile.

## Stop rule

Stop when the requested outcome, impacted-owner follow-through, enforcement closure, and relevant validation are complete. Do not add unrelated cleanup or recommendations. When missing authority, evidence, or an external dependency blocks completion, report the concrete blocker and the smallest next decision.

## Verification

Run the closest owner check for changed behavior. Use `npm run guard` for cross-cutting rule, hook, package, migration, toolchain, or CI changes.

## Failure behavior

Fix the canonical owner and rerun the failing owner check. Do not close a task with a missing enforcement-closure row, an unverified material claim, a weakened gate, or an unsynced generated target.

## Done means

The authorized outcome is complete, every HIGH or MEDIUM finding has a full closure disposition, evidence supports material claims, relevant checks passed or their absence is explained, generated targets are current, and unrelated work remains intact.
