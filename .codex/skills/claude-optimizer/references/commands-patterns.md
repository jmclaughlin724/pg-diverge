# Command Patterns

> **Commands are merged into skills.** As of Feb 2026, `.claude/commands/` and `.claude/skills/` both create slash commands and work the same way. If a skill and command share the same name, the **skill takes precedence**. Skills are recommended since they support additional features like supporting files and `context: fork`.
>
> Existing `.claude/commands/` files keep working. For new workflows, prefer skills.
>
> **Source:** [Official Skills Documentation](https://code.claude.com/docs/en/skills)

## When to still use `.claude/commands/`

Commands remain useful for **thin wrappers** that delegate to a skill — a command file with just frontmatter and `Invoke the skill-name skill with: $ARGUMENTS`. This gives you a dedicated `/command-name` entry point while the skill holds the actual logic.

## YAML Frontmatter

```yaml
---
description: [What it does] ([constraint if any])
argument-hint: <argument-name>
model: opus | sonnet | haiku
allowed-tools: Read, Glob, Grep, Task, TaskOutput, TaskCreate, TaskUpdate, TaskList, Skill, mcp__*
---
```

| Model    | Best For                                            |
| -------- | --------------------------------------------------- |
| `haiku`  | Quick, deterministic tasks (commits, status checks) |
| `sonnet` | Complex reasoning (debugging, reviews)              |
| `opus`   | Deep analysis, research, architecture               |

## Body Content: Imperative Instructions, Not Reference Documents

The command/skill body should be **direct imperative instructions** — steps Claude follows, not documentation Claude reads. This is the single most important pattern.

**Official example** (from `fix-issue` skill):

```markdown
Fix GitHub issue $ARGUMENTS following our coding standards.

1. Use `gh issue view` to get the issue details
2. Understand the problem described in the issue
3. Search the codebase for relevant files
4. Implement the necessary changes to fix the issue
5. Write and run tests to verify the fix
6. Ensure code passes linting and type checking
7. Create a descriptive commit message
8. Push and create a PR
```

**Anti-pattern** (reference document style):

```markdown
## How Authentication Works

| Component | Description         |
| --------- | ------------------- |
| JWT       | Token-based auth... |

## Error Recovery

| Error | Fix              |
| ----- | ---------------- |
| 401   | Refresh token... |
```

Move reference material to supporting files in `references/`. The body should read like a checklist, not an encyclopedia.

## Workflow Tasks Pattern (project convention)

For multi-step workflows, use TaskCreate to track progress. This is a **project convention**, not an official Claude Code pattern. The skill body tells Claude to create tasks, then execute them:

```markdown
Use TaskCreate to create these tasks, then execute them in order:

1. **Analyze** — Run `git status` and review changes
2. **Commit** — Stage specific files and commit
3. **Push** — Push to remote
4. **Verify** — Check CI status
```

Each task gets a `subject` (imperative) and `activeForm` (present continuous for spinner). Set `addBlockedBy` for sequential dependencies. Mark `in_progress` before starting, `completed` after success.

## Valid Subagent Types Registry

### Built-in Types

| Type | Purpose | Notes |
| --- | --- | --- |
| `Explore` | Fast codebase exploration | Case-sensitive! Not "explore" |
| `general-purpose` | General multi-step tasks | Use instead of "Bash" for dispatch |
| `Plan` | Implementation planning |  |

### Custom Agent Types (from `.claude/agents/`)

| Category | Valid Types |
| --- | --- |
| **Supabase** | `supabase-backend`, `supabase-edge-functions`, `supabase-realtime` |
| **Code Review** | `code-quality-reviewer`, `security-code-reviewer`, `performance-reviewer`, `test-coverage-reviewer` |
| **Development** | `developer`, `frontend-developer`, `backend-architect`, `fullstack-developer` |
| **Database** | `database-admin`, `rls-policy-generator`, `postgres-sql-stylist` |
| **Research** | `explore`, `context`, `Explore` |
| **ML/AI** | `ai-engineer`, `ml-engineer`, `prompt-engineer` |
| **Writing** | `technical-writer`, `adr-writer`, `content-marketer` |

### Common Mistakes

| Invalid             | Valid                     |
| ------------------- | ------------------------- |
| `"explore"`         | `"Explore"`               |
| `"Bash"`            | `"general-purpose"`       |
| `"realtime-expert"` | `"supabase-realtime"`     |
| `"code-reviewer"`   | `"code-quality-reviewer"` |

## Output Format Templates

### Structured Report

```markdown
# [Title]

## Summary

[2-3 sentences]

## Findings

| Column | Column |
| ------ | ------ |
| Data   | Data   |

## Recommendations

1. [Action]
```

### Debug Output

```markdown
**Issue:** [Description] **Root Cause:** [file:line] - [explanation] **Fix:** [What was changed] **Verification:** [Commands run, results]
```

## Verbosity Guidelines

The official `fix-issue` example is 8 lines. The `deploy` example is 4 lines. Aim for the minimum needed.

| Complexity | Target Lines | Description                            |
| ---------- | ------------ | -------------------------------------- |
| Simple     | 5-20         | Commits, status checks, single actions |
| Standard   | 20-50        | Multi-step workflows with constraints  |
| Complex    | 50-100       | Conditional workflows, multiple paths  |

Reference material goes in supporting files, not the body.

## Quality Gates

- [ ] Frontmatter includes `description` (and `argument-hint` if accepting input)
- [ ] Body is imperative instructions, not reference documentation
- [ ] Reference material in supporting `references/` files
- [ ] For multi-step workflows: TaskCreate tracking (project convention)

## Argument and Preprocessing Tokens

| Token | Meaning |
| --- | --- |
| `$ARGUMENTS` | Full argument string |
| `$ARGUMENTS[N]` | Nth argument, shell-quoted (0-indexed) |
| `$N` | Shorthand for `$ARGUMENTS[N]` |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Skill directory path (plugin skills: subdir, not plugin root) |
| `` !`cmd` `` | Shell-preprocess at render time; output replaces the placeholder |
| ` `! ` ` | Fenced preprocessing block |
| `@path/to/file` | Inject file contents at read time |
| `ultrathink` | Enable extended thinking for the skill's execution |

Preprocessing runs before Claude sees the body and is not gated by `allowed-tools`. See [dynamic-context-and-runtime.md](dynamic-context-and-runtime.md) for full semantics, including `"disableSkillShellExecution"` settings override.

## Sources

- **[Claude Code Skills](https://code.claude.com/docs/en/skills)** — Canonical source (commands merged into skills, Feb 2026); last verified 2026-04-15
- [Agent Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
