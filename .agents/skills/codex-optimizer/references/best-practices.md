# Best Practices Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/learn/best-practices

Supplement with `prompt-cache-and-surface-audit.md` for 2026-05-27 OpenAI prompt-cache, prompt-optimization, and surface-audit findings.

## Intent

Use Codex as an engineering teammate with a clear task, the right context, bounded tools, and an explicit closeout. The practical goal is delivered work, not exhaustive narration.

## Default Operating Loop

1. Restate the controlling objective internally.
2. Read live repo files before assuming local facts.
3. Identify the owner surface before editing.
4. Make the change that reaches the smallest correct end state.
5. Run the closeout command that proves the touched surface.
6. Report changed owner, proof run, and blockers only inside scope.

## Durable Guidance

- Put repeated lessons in `AGENTS.md`, `.claude/rules/**`, `.claude/skills/**`, or automations.
- Keep durable guidance short and task-useful.
- Update durable guidance after repeated mistakes or explicit user correction.
- Remove duplicate guidance instead of adding another layer.
- When optimizing prompt surfaces, first decide whether the issue belongs in a brief, rule, skill, hook, agent, or runtime config. Do not solve every issue by adding more root-level prose.

## Tooling Discipline

- Use MCP for live external systems or fast-changing docs.
- Start with the smallest useful tool surface.
- Use skills for repeatable procedures.
- Use automations only when the task is stable enough to run on a schedule.

## Session Discipline

- Use Plan mode for complex or ambiguous work.
- Ask for missing constraints only when a wrong choice would be risky.
- Use subagents to keep noisy, bounded, read-heavy exploration out of the main thread; do not fan out every task.
- Avoid parallel write-heavy work unless the file ownership and merge path are explicit.
- Use `/resume`, `/fork`, `/compact`, `/agent`, and `/status` to manage session state.
- Keep repo worker implementation on the current branch in the current worktree unless the user explicitly approves worktree isolation.

## supaschema Delivery Pattern

- Final reports are task-only.
- For `.claude/skills/**`, close with `npm run sync:llm` unless the user explicitly requests more.
