---
name: task-creator
description: "Create validated persistent task lists, implementation plans, and sequential foreground-agent execution flows after research, ownership tracing, MCP checks, and skill validation."
user-invocable: true
argument-hint: <goal-or-scope>
metadata:
  keywords:
    - "tasks"
    - "task list"
    - "plan"
    - "execution plan"
    - "subagents"
    - "parallel agents"
    - "foreground agents"
    - "wave planning"
    - "dry"
    - "elegant"
    - "next devtools"
    - "turbopack trace"
  intent-patterns:
    - "create.*task list"
    - "build.*task list"
    - "make.*plan"
    - "execution.*plan"
    - "orchestrate.*subagents"
    - "parallel.*subagents"
    - "plan.*before.*implement"
---

# Tasks

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

## Use When

- Create validated persistent task lists, implementation plans, and sequential foreground-agent execution flows after research, ownership tracing, MCP checks, and skill validation.
- Use this skill only for its named job; load a narrower owner skill when one exists.

## Direct Workflow

1. Confirm the task matches the skill description and identify the owner files or external docs needed.
2. Read [skill-playbook.md](references/skill-playbook.md) only for the sections needed by the current task.
3. Execute the requested change or analysis in the canonical owner; do not patch generated mirrors by hand.
4. Run the validation named by the playbook or the touched owner surface.
5. Report only the owner changed, sync or validation run, and concrete blockers inside scope.

## Detail Index

- `Parallel Research Fan-Out`
- `Step 1: Resolve scope and remove assumptions first`
- `Step 2: Validate against applicable skills and MCP servers`
- `Step 3: Create or update the persistent task list`
- `Step 4: Validate the task list before execution`
- `Step 5: Execute the waves`
- `Step 6: End with a verification wave and a clear report`

## Boundaries

- Keep transient findings, incident notes, and task-local state out of `SKILL.md`.
- Put bulky examples, provider variants, API specifics, and edge cases in `references/**`.
- Add scripts only for deterministic repeat work that is safer to run than to retype.
