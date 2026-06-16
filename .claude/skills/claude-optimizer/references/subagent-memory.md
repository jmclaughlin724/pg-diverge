# Subagent Memory (Off-Policy In This Repo)

Claude Code subagents support a `memory: user|project|local` frontmatter field that persists learnings between sessions under `~/.claude/agent-memory/{agent-name}/` (or `.claude/agent-memory/{agent-name}/` for project scope, or `.claude/agent-memory-local/{agent-name}/` for local). This repo does NOT use any of those scopes.

## Canonical owners instead

When work in a subagent surfaces a durable lesson, promote it into the surface that the team reviews and versions:

| Lesson type | Owner |
| --- | --- |
| Repo-wide policy or invariant | `.claude/rules/**/*.md` |
| Reusable procedure or audit step | the relevant skill body or skill reference |
| Path/glob-scoped guidance | `.claude/rules/*.md` with `paths` frontmatter |
| Workspace-specific deltas (route maps, conventions) | the workspace `AGENTS.md` |
| Behavior the harness must enforce | a hook + `.claude/settings.json` wiring |

The `memory:` frontmatter MUST stay absent from agent definitions in `.claude/agents/**`. Repo enforcement: any agent file that adds `memory: project|user|local` is treated as a contract violation in the next `/update` audit.

## Why off-policy

Memory files (`MEMORY.md`, topic files under agent-memory directories, and Claude auto-memory notes) are not versioned with the repo, not reviewed by the team, not searchable by the operators who actually maintain the codebase, and not safe against generated mirror sync. Rules, hooks, skills, and AGENTS briefs cover every legitimate use case while remaining auditable and shared.

## Related references

- [progressive-disclosure.md](progressive-disclosure.md) §Memory Mechanisms Are Off-Policy In This Repo
- [`agents-patterns.md`](agents-patterns.md) — agent frontmatter inventory (`memory:` row carries an off-policy note)
- [`subagent-configuration.md`](subagent-configuration.md) — `memory:` field documentation (carries off-policy note)
- Root `AGENTS.md` — "Do not use memory for local repo work. If a lesson needs to persist, update the relevant `.claude/rules/**`, hook, skill, or owner brief on demand."
