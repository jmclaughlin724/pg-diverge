# Skill Matcher Signal Budget

Current owner: `scripts/agent-hooks/skills.mjs`.

The current deterministic matcher does not use weighted confidence math. A skill is selected when at least one high-confidence signal matches, then the result list is deduped and capped. The practical budget is therefore about noise control, not score dilution.

## Prompt Budget

Keep `metadata.keywords` small and specific.

| Signal | Guidance |
| --- | --- |
| Explicit skill token | Prefer `$skill-name` or `/skill-name` when the user intentionally requests a skill. |
| Skill directory name | Works only when the name is not a low-signal term. |
| `metadata.keywords` | Use narrow domain phrases that a user would actually type. |
| Low-signal words | Avoid `task`, `plan`, `verify`, `update`, `fix`, `test`, `work`, `this`, and similar generic terms. |

Target 3-8 prompt keywords per skill. More is only useful when each term names a distinct, high-confidence domain concept.

## Tool Budget

Use `metadata.file-triggers` for tool-scoped matching.

| Signal | Guidance |
| --- | --- |
| Owner paths | Prefer concrete paths such as `.claude/hooks/**`, `.codex/hooks.json`, `scripts/agent-hooks/**`, or `docs/**`. |
| Patch headers | The matcher reads patch file headers, not patch body prose. |
| Nested payload paths | MCP and structured payload path fields are supported. |
| Command text | Not scored. Put durable tool routing in file triggers instead. |

Target 2-6 file triggers per skill. Add a trigger only when touching that path genuinely requires the skill before governed work.

## Load Budget

Do not broaden matching just to compensate for missed loads. A pending skill clears only after an observable load:

- `Skill` tool call naming the skill.
- `Read` of a `SKILL.md` path.
- MCP payload containing a `SKILL.md` path.
- Shell reader command that reads a `SKILL.md` path.

If a skill is frequently pending but not loaded, fix the prompt text or the explicit skill request. Do not add broad keywords.

## Common Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Many unrelated skills become pending | Generic keywords or descriptions were treated as routing signals | Keep deterministic routing in `metadata.keywords`; descriptions are native-model context only. |
| Hook optimizers re-announce on every patch | Command or patch body prose was used as a tool signal | Use file triggers only for tool matching. |
| A user named a skill but it stayed pending | Slash or `$skill` token is only a request signal | Load the skill through the `Skill` tool or read its `SKILL.md`. |
| A file edit needs a skill but no context appears | Missing `metadata.file-triggers` entry | Add the narrow owner path to the relevant skill. |

## Related

- `scripts/agent-hooks/skills.mjs` - matcher and observable-load owner.
- `.claude/skills/claude-optimizer/references/skill-matcher-patterns.md` - runtime behavior reference.
- `.claude/skills/claude-optimizer/references/frontmatter-reference.md` - frontmatter field reference.
