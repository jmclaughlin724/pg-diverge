---
name: debugger
description: "Diagnose and fix build, test, lint, typecheck, CI, schema/migration, Python/FastMCP, Cloudflare Worker, stuck-process, and no-output failures in this repo."
argument-hint: "<error-message-or-issue>"
metadata:
  keywords:
    - "ci failure"
    - "build error"
    - "test failure"
    - "typecheck error"
    - "lint error"
    - "guard failure"
    - "stuck"
    - "hung"
    - "frozen"
    - "timeout"
    - "no output"
    - "seems dead"
    - "stalled"
    - "supa diagnostic"
chainTo:
  - pattern: '"source":\\s*"biome"|biomejs\\.dev|lint/(correctness|a11y|style|performance|nursery|suspicious|complexity)'
    targetSkill: ultracite
    message: "Biome diagnostics detected — loading Ultracite guidance for the repo lint and format workflow."
  - pattern: "SUPA_[A-Z_]+|supaschema (diff|check|verify)|-- supaschema: lineage"
    targetSkill: supaschema
    message: "supaschema migration diagnostic detected — loading the supaschema skill for diff/check/verify and SUPA_* recovery."
retrieval:
  aliases:
    - "troubleshooter"
    - "diagnostic"
    - "triage"
    - "problem solver"
  intents:
    - "debug stuck process"
    - "investigate build or test error"
    - "triage a failing CI run"
    - "decode a SUPA_* diagnostic"
    - "find the error"
  entities:
    - "command stderr/stdout"
    - "CI run logs"
    - "test output"
    - "SUPA_* diagnostics"
    - "FastMCP server logs"
---

# Fix: $ARGUMENTS

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

## Use When

- Diagnose and fix build, test, lint, typecheck, guard, CI, schema/migration (`SUPA_*`), Python/FastMCP, Cloudflare Worker, stuck-process, and no-output failures.
- Use this skill only for its named job; load a narrower owner skill when one exists (`supaschema` for migration policy, `ultracite` for lint/format, `code-atlas` for the repo graph).

## Direct Workflow

1. Confirm the task matches the skill description and identify the owner files, command, or diagnostic needed.
2. Read [skill-playbook.md](references/skill-playbook.md) only for the sections needed by the current task.
3. Execute the smallest root-cause fix in the canonical owner; do not patch generated mirrors (`.codex`/`.agents`) by hand — change the `.claude` source and run `npm run sync:llm`.
4. Run the narrowest validation that proves the fix (`npm run typecheck`/`test`/`guard`, `npm run py:test`, `supaschema check`, etc.).
5. Report only the owner changed, the validation run, and concrete blockers inside scope.

## Detail Index

- `Reporting Contract`
- `Assumption Gate Before Plans`
- `Parallel Investigation`
- `Operational Triage (No Error Message)`
- `Code Failure Workflow`
- `Rules`
- `Verification`
- `References`

## Boundaries

- Keep transient findings, incident notes, and task-local state out of `SKILL.md`.
- Put bulky examples, diagnostic catalogs, and edge cases in `references/**`.
- Add scripts only for deterministic repeat work that is safer to run than to retype.
