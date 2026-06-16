---
name: adversarial-verification
description: "Use when verifying implementation work and the failure mode is superficial approval, code-reading in place of execution, or over-trusting a passing test suite without trying to break the change"
metadata:
  keywords:
    - "verification"
    - "adversarial"
    - "test breaking"
    - "prove it works"
    - "verify implementation"
    - "try to break"
    - "break it"
    - "stress test"
    - "edge cases"
---

# Adversarial Verification

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

## Use When

- Use when verifying implementation work and the failure mode is superficial approval, code-reading in place of execution, or over-trusting a passing test suite without trying to break the change
- Use this skill only for its named job; load a narrower owner skill when one exists.

## Direct Workflow

1. Confirm the task matches the skill description and identify the owner files or external docs needed.
2. Read [skill-playbook.md](references/skill-playbook.md) only for the sections needed by the current task.
3. Execute the requested change or analysis in the canonical owner; do not patch generated mirrors by hand.
4. Run the validation named by the playbook or the touched owner surface.
5. Report only the owner changed, sync or validation run, and concrete blockers inside scope.

## Detail Index

- `Overview`
- `Opening Stance`
- `Mandatory Baseline`
- `Required Adversarial Probe`
- `Rules`
- `Evidence Format`
- `Common Probes`
- `CLI / library (src/**, supaschema diff/check/verify/types)`
- `Python FastMCP side-service (services/agent-mcp)`
- `Guard classifier (scripts/guards/check-*.mjs)`
- `Migration replay-safety / verify apply-twice`
- `Generated type / Zod drift from the declarative tree`
- `SUPA_* diagnostic surface and redaction`
- `Refactor regression`
- `Multi-source identity probes`
- `Failure Discipline`
- `Anti-Patterns`
- `Done Condition`

## Boundaries

- Keep transient findings, incident notes, and task-local state out of `SKILL.md`.
- Put bulky examples, provider variants, API specifics, and edge cases in `references/**`.
- Add scripts only for deterministic repeat work that is safer to run than to retype.
