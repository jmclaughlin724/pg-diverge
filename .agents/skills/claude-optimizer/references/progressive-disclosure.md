# Progressive Disclosure

Progressive disclosure is the memory strategy behind good Claude Code configuration. Put information in the smallest surface that still makes it available when needed.

> **Note:** "Progressive disclosure" is a community-coined term for Claude Code's layered context-loading behavior. The official docs describe the same mechanics without this label.

> Source: https://code.claude.com/docs/en/memory

## Surface Selection

| Surface | Loaded when | Use for | Avoid using for |
| --- | --- | --- | --- |
| `AGENTS.md` | session start | always-needed project guidance | long examples, edge cases, repeated domain docs |
| `.claude/rules/*.md` without `paths` | session start | truly global project rules | narrow file-specific guidance |
| `.claude/rules/*.md` with `paths` | when matching files are read | scoped persistent guidance | generic workflow repeated everywhere |
| skill metadata | session start | discovery | verbose descriptions |
| `SKILL.md` | when the skill is invoked | core workflow and routing | reference dumps |
| skill references | on demand — only when the model `Read`s them | detail, examples, variants | core workflow |
| subagent | fresh isolated context (inherits no skills) | verbose or parallel work | always-on project conventions |

References load lazily: a markdown link or path is inert until the model `Read`s it, and `@references/x.md` is **not** expanded inside `SKILL.md` (unlike CLAUDE.md `@import`). Mechanics owned by [dynamic-context-and-runtime.md §1a](dynamic-context-and-runtime.md).

## Core Memory Rules

- `AGENTS.md` is context, not enforcement. Shorter, more specific instructions follow better.
- Keep `AGENTS.md` under roughly 200 lines when possible.
- Keep direct prompt surfaces as instruction contracts: non-stub `AGENTS.md`, `.claude/rules/*.md`, and `.claude/skills/*/SKILL.md` start with `## Contract` and route long detail to references.
- Use rules to split persistent guidance by topic or path.
- Keep one canonical owner per concept to avoid contradictory instructions.
- Use skills for task-specific or optional guidance that should not live in startup context.
- In this repo, `CLAUDE.md` files are Claude runtime entry points; keep unique guidance in the adjacent `AGENTS.md` or scoped `.claude/rules/**`. Claude Code reads `CLAUDE.md` (not `AGENTS.md`), so the entry point must `@AGENTS.md`-import or symlink the brief — `ln -s AGENTS.md CLAUDE.md` works on POSIX; on Windows the symlink needs Administrator/Developer Mode, so the import form is safer.

## Stub Mechanics That Affect AGENTS.md Routing

In this repo, `CLAUDE.md` exists only as the Claude runtime entry point that imports the adjacent `AGENTS.md`. The handful of mechanics below matter for that import path; everything else about CLAUDE.md is off-policy here. Source: `https://code.claude.com/docs/en/memory`.

- The entry point imports the brief with `@AGENTS.md`. Relative paths resolve from the file containing the import; recursion is capped at five hops. On Windows the alternative — `ln -s AGENTS.md CLAUDE.md` — requires Administrator or Developer Mode, so the import form is the portable default.
- The entry point survives `/compact` and is re-read from disk on each session start; subdirectory entry points only reload when Claude reads files in that subtree, which matches the per-app AGENTS.md routing this repo uses.
- `claudeMdExcludes` (in project, local, or managed settings) can skip an ancestor entry point if a parent repo's CLAUDE.md is interfering with the local AGENTS-first brief. Arrays merge across scopes; managed-policy CLAUDE.md cannot be excluded.
- The `InstructionsLoaded` hook logs which stub + rules files actually loaded. Use it when an `@AGENTS.md` import or a path-scoped rule appears to be missing in the live session.

The official `claudeMdExcludes`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, and `/memory` features are part of the platform but are not the canonical authoring surface for this codebase — `.claude/rules/**` is.

## Optimization Playbook

1. Start with scope. Ask whether the instruction is universal, path-specific, task-specific, or isolated-work specific.
2. Choose the smallest valid surface.
3. Keep the top-level file lean. Put the rule or workflow up front, then link out.
4. Move detail down a level. Examples, variants, and edge cases belong in references or topic files.
5. Remove duplication immediately. If the same concept appears in multiple files, keep one owner and replace the rest with routing.

## Patterns That Save Context

### 1. Global rule, local detail

```text
CLAUDE.md
  -> short project-wide principle
.claude/rules/database.md
  -> DB-specific persistent guidance
references/sql-rpc-patterns.md
  -> long examples
```

### 2. Scoped rule instead of global prose

Use a path-scoped rule when the guidance only matters in one subtree.

```yaml
---
paths:
  - "apps/api/**/*"
---
```

This keeps the rest of the repo from paying for that context.

### 3. Skill body plus references

Keep `SKILL.md` focused on:

- quick start
- core workflow
- reference routing

Move to references:

- long code samples
- framework variants
- deep edge cases

### 4. Subagents for noisy work

Use subagents when the task would otherwise flood the main conversation:

- long logs
- test output
- large doc lookups
- repeated exploration

### 5. User-level rules

Personal preferences that should apply across every project live in `~/.claude/rules/*.md`. User-level rules load **before** project rules, so a conflicting project rule wins by precedence.

```text
~/.claude/rules/
├── preferences.md    # Personal coding preferences
└── workflows.md      # Personal preferred workflows
```

`.claude/rules/` supports symlinks too — keep a single shared rule set on disk and link it into multiple projects. Circular symlinks are detected and handled gracefully.

```bash
ln -s ~/shared-claude-rules .claude/rules/shared
ln -s ~/company-standards/13-security.md .claude/rules/13-security.md
```

### 6. Splitting oversized skills

When a SKILL.md body or long reference exceeds its budget, split by **audience or runtime**, not by feature area. Each sibling file should have a clear "when do I load this?" purpose.

- **Runtime split** for SDKs with distinct execution environments: `error-monitoring-client.md` / `error-monitoring-server.md` / `error-monitoring-enrichment.md`. Enrichment goes last because it applies across all runtimes.
- **Audience split** for migration-heavy content: separate current-API reference from migration checklists (e.g. `v5-to-v6-migration.md` alongside the main guide) so the model only pays for legacy details when it detects legacy usage.
- **Role split** for workflows with distinct phases: setup / detail / troubleshooting as siblings instead of one giant file.

Avoid splitting by feature area (boundaries / capture / scoping) when features cross-cut runtimes — that forces duplication across siblings. When in doubt, ask: "what triggers loading this file?" If two candidate files would load together every time, they shouldn't be split.

## Memory Mechanisms Are Off-Policy In This Repo

Claude Code ships an auto-memory feature and an `autoMemoryEnabled` / `autoMemoryDirectory` settings layer. This repo does NOT use them. Durable repo-level lessons go in `.claude/rules/**`, hooks, skills, or owner briefs — the surfaces that get reviewed, versioned, and shared with the team.

If an auto-memory note appears in a session, treat it as ephemeral. Move anything worth keeping into the canonical owner before the lesson is lost.

## Anti-Patterns

- putting long “just in case” documentation in `AGENTS.md`
- keeping path-specific rules unconditional
- repeating the same boundary rule in core files, app rules, and package rules
- storing temporary debugging notes in persistent memory
- preloading large skills into subagents that only maybe need them

## Decision Shortcut

If the content should be seen every session, use a rule or root `AGENTS.md` entry. If it should apply only for certain files, use a path-scoped rule. If it is a reusable workflow or domain guide, use a skill. If it needs separate execution or should keep noise out of the parent thread, use a subagent.
