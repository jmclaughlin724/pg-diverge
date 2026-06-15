# Workflow Patterns

> For Claude Code's built-in `/workflows` dynamic-orchestration feature (JS scripts, `ultracode`), see [dynamic-workflows.md](dynamic-workflows.md). This file covers wave-based agent orchestration patterns.

Use these patterns when documenting multi-step agent workflows in commands or skills.

## Wave-based parallelism

- Split parallel work into waves when tasks edit disjoint files.
- Keep shared config files in their own wave.
- End with a verification wave.

## Current delegation model

- Use `spawn_agent` for explicit delegated work.
- Use `wait_agent` only when the next step is blocked on that result.
- Keep urgent blocking work local unless the user explicitly asked for delegation.

## Anti-patterns

- Referring to the old Task tool or `subagent_type`
- Delegating work that edits the same files in parallel
- Waiting immediately after every spawn instead of doing local non-overlapping work
- Forcing delegation for ordinary work when the user did not ask for subagents
