---
name: update
description: "Audit and update all impacted repo documentation, context, script, guard, consumer, dependency, and generated-mirror surfaces after code, architecture, workflow, lesson, or research changes. Consolidate duplicate guidance into one upstream-sourced owner."
disable-model-invocation: false
metadata:
  disable-model-invocation: false
  keywords:
    - "audit claude config"
    - "audit AGENTS"
    - "update AGENTS"
    - "audit skills"
    - "audit rules"
    - "audit scripts"
    - "audit codex hooks"
    - "audit hooks"
    - "audit agents"
    - "claude maintenance"
    - "repo documentation"
    - "context surfaces"
    - "upstream best practices"
    - "session lessons"
---

# Update

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

## Use When

- Audit and update existing repo documentation and context surfaces after code, architecture, or workflow changes: AGENTS, rules, skills, agents, hooks, scripts, commands, and generated-mirror sync.
- Identify and correct every impacted file, folder, consumer surface, dependency reference, package boundary, script, guard, command, docs page, and generated mirror affected by a change, lesson learned, or research result.
- Consolidate duplicate or redundant guidance into one upstream-sourced canonical owner, with rules as the default prevention owner.
- Use this skill only for its named job; load a narrower owner skill when one exists.

## Direct Workflow

1. Confirm the task matches the skill description and identify the canonical owner plus every impacted file, folder, consumer, dependency, docs, script, guard, package, and generated-surface owner that may need follow-through.
2. Read [skill-playbook.md](references/skill-playbook.md) only for the sections needed by the current task.
3. Execute the requested change or analysis in the canonical owner and every confirmed impacted supporting owner; do not patch generated mirrors by hand.
4. Run the validation named by the playbook or each touched owner surface.
5. Report only the owners changed, sync or validation run, and concrete blockers inside scope.

## Detail Index

- `Contract`
- `Scope`
- `Workflow`
- `Phase 1: Audit`
- `Phase 2: Plan`
- `Phase 3: Execute`
- `Phase 4: Validate`
- `Completion Gate`
- `Subagent Review`
- `Concurrency`

## Boundaries

- Keep transient findings, incident notes, and task-local state out of `SKILL.md`.
- Put bulky examples, provider variants, API specifics, and edge cases in `references/**`.
- Add scripts only for deterministic repeat work that is safer to run than to retype.
- Do not stop at the originally named file when the change invalidates related docs, scripts, guards, package consumers, generated mirrors, or dependency references.
