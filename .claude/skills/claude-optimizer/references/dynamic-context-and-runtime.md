# Dynamic Context, Runtime, and Discovery

Authoring-time features of the Claude Code skill runtime that are easy to miss because they are implicit in how Claude loads skills, not in frontmatter.

**Source:** <https://code.claude.com/docs/en/skills> (last verified 2026-04-15). If this file drifts from that doc, the doc wins — open a PR updating this file. See also [frontmatter-reference.md](frontmatter-reference.md) for field-level spec and [skill-frontmatter-schema.md](skill-frontmatter-schema.md) for the repo-custom `validate`/`chainTo`/`retrieval` contract.

---

## 1. SKILL.md is loaded once per session

When Claude invokes a skill, the harness force-reads **only** the skill's `SKILL.md` body — no other file in the skill directory is read automatically. It prepends a `Base directory for this skill: <dir>` line, applies the §2 command-injection blocks and the §3 token substitutions, then returns the result as **a single message that stays in the conversation for the rest of the session.** Claude does not re-read the file on later turns.

**Implications:**

- Write standing instructions ("always do X before Y"), not one-time steps ("now run Z once"). Later turns see the same text.
- If the skill's workflow legitimately has one-shot setup, put that before the evergreen section so it naturally drops out of the model's working memory.
- Auto-compaction keeps the most recent invocation of each skill when summaries happen — see §8 below.

**Subagent difference:** Subagents launched with `skills:` in their frontmatter receive the **full skill body at startup**, not at invocation time. That is the inverse of `context: fork` in a skill (§5). A _fresh_ subagent (spawned with a `subagent_type`) otherwise starts at zero context: it does **not** inherit the parent's loaded `SKILL.md` bodies or any references the parent read. See [subagent-skill-runtime.md](subagent-skill-runtime.md).

---

## 1a. References load lazily — `@`-mentions do NOT force-load

Only three things enter context when a skill is invoked: the `SKILL.md` body, the output of the command-injection blocks in §2, and the `${CLAUDE_*}` token substitutions in §3. Anything the body merely _links to_ is left for the model to pull in on demand.

- **Markdown link / bare path** (a normal markdown link to a reference, or a bare `references/x.md` path): lazy — inert text until the model calls `Read`. This is the progressive-disclosure default; keep large or optional detail here.
- **`@`-mention** (`@references/x.md`): **also inert inside `SKILL.md`.** Unlike CLAUDE.md, where `@path` imports are expanded and loaded at launch (<https://code.claude.com/docs/en/memory>), skill bodies do **not** expand `@`-mentions. Verified 2026-06-03: a probe skill carrying skill-relative, dot-relative, and project-root `@` syntaxes was invoked via the Skill tool; all three rendered as literal text and none force-loaded. Do not write `@references/...` expecting eager load — use a markdown link the model can `Read`, move must-have content inline, or print it from a §2 command block.
- **No auto-walk:** the harness never follows links. A bundled file the `SKILL.md` never references (directly or transitively) is invisible.
- **Reachability + traversal guard:** bundled files must live inside the skill directory (`<name>/references/`, `<name>/assets/`, `<name>/scripts/`). Paths that escape the skill dir are rejected ("bundled skill file path escapes skill dir").

---

## 2. Dynamic context injection via `!`command``

Skill and command bodies support shell-execution preprocessing **before Claude sees the text**. The runtime substitutes the output inline, then renders the body.

Two syntaxes:

````markdown
## Current state

- Git status: !`git status --short`
- Branch: !`git rev-parse --abbrev-ref HEAD`

## Recent diff

```!
git diff --stat main...HEAD
```
````

````

**Key properties:**

- Output replaces the placeholder during render; Claude sees the result, not
  the command.
- `allowed-tools` does not need `Bash(cmd *)` for this to run — preprocessing
  happens through a different code path than the Bash tool.
- Commands run in the project root with the user's shell.
- Can be disabled org-wide via managed settings `"disableSkillShellExecution":
  true`. Bundled / Anthropic-shipped skills are exempt from that disable.

**When to use:** Dynamic state that Claude should reason about but that you
don't want to waste tool-call turns gathering — `git status`, `gh pr view`,
`pnpm --filter foo --json list`, `kubectl get pods -o name`, etc.

**When NOT to use:** If the output is huge or slow; preprocessing blocks render.
If users can inject arbitrary arguments into the command (escape risk).

---

## 3. Argument and environment substitutions

Skills and commands receive user input and runtime metadata via tokens the
runtime expands before Claude reads the body.

| Token                  | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `$ARGUMENTS`           | Full argument string                                          |
| `$ARGUMENTS[N]`        | Nth argument, shell-quoted (0-indexed)                        |
| `$N`                   | Shorthand for `$ARGUMENTS[N]`                                 |
| `${CLAUDE_SESSION_ID}` | Current session ID                                            |
| `${CLAUDE_SKILL_DIR}`  | Absolute path to the skill's directory                        |

**`${CLAUDE_SKILL_DIR}` caveat:** For **plugin-provided skills**, this is the
specific skill's subdirectory inside the plugin, **not** the plugin root. Use
it when referencing bundled helper scripts:

```markdown
Run the validator:

!`python ${CLAUDE_SKILL_DIR}/scripts/validate.py`
````

If `$ARGUMENTS` is absent from the body but the user passed arguments, the runtime appends a literal `ARGUMENTS: <value>` line so Claude still sees them.

---

## 4. `ultrathink` extended thinking keyword

The literal token `ultrathink` anywhere in the skill body enables extended thinking for the skill's execution turn. Use sparingly — extended thinking is expensive and noisy for simple tasks.

**Good fit:** architecture review, adversarial verification, deep debugging skills, complex refactor planning.

**Bad fit:** trivial commit messages, status checks, file moves.

---

## 5. `context: fork` caveat — reference-only skills are broken

`context: fork` runs the skill in an isolated subagent. The skill body becomes the subagent's prompt. **If the body has no explicit task instructions, the forked subagent has nothing to do and returns noise or nothing.**

Rule of thumb: `context: fork` is for **worker** skills, not **handbook** skills. If the skill is a reference guide ("Here are the patterns for Foo…"), do not add `context: fork`. If the skill is a directive ("Audit X, produce Y report"), `context: fork` is appropriate.

---

## 6. Skill precedence and name collisions

When skills share a name across scopes, the highest-priority scope wins:

| Priority | Scope | Path |
| --- | --- | --- |
| 1 | Enterprise | managed settings (highest) |
| 2 | Personal | `~/.claude/skills/<name>/SKILL.md` |
| 3 | Project | `.claude/skills/<name>/SKILL.md` |
| — | Plugin | `<plugin>/skills/<name>/SKILL.md` (namespaced `plugin-name:skill-name`) |

**Plugin skills can never collide** with non-plugin skills because they're always namespaced.

**Skills vs. commands:** If a skill name collides with a `.claude/commands/` entry, **the skill wins**. This is intentional — commands were merged into skills in Feb 2026 and the canonical path is skills.

---

## 7. Monorepo nested discovery and `--add-dir`

**Nested discovery:** Claude auto-discovers `.claude/skills/` in subdirectories of files being worked on, not just at repo root. This is monorepo-friendly — an app-specific skill can live at `apps/<app>/.claude/skills/<skill-name>/SKILL.md` and only load when that app's files are in scope.

**`--add-dir` exception:** Normally, `--add-dir` grants file access, not configuration. Skills are the exception: `.claude/skills/` inside an added directory **IS loaded**. Subagents, commands, and output-styles inside added directories are NOT.

**CLAUDE.md from added dirs:** Opt-in via `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`. Off by default.

---

## 8. Auto-compaction budget

When a session fills up and Claude Code auto-compacts, it re-attaches the **most recent invocation** of each skill to the compacted summary. The rules:

- 5,000 token cap per skill
- **25,000 token shared budget** across all re-attached skills
- Filled most-recent-first — older skills fall off if many were invoked

**Implications for authoring:**

- Do not write 10,000-token skill bodies expecting them to survive compaction in a long session. They will be truncated to 5,000 on re-attach.
- If a skill needs to be reliably present after compaction, keep the body lean and push detail to references that Claude can re-load on demand.
- Skills invoked early in a long session may drop entirely after compaction if later skills consume the 25,000-token pool.

---

## 9. Live change detection vs. restart required

**In-session reload:** Edits to `SKILL.md` and reference files inside **already watched** skill directories take effect within the session. You do not need to restart to iterate on a skill body during development.

**Requires restart:**

- Creating a new **top-level** skills directory (e.g., adding `~/.claude/skills/` for the first time on a machine).
- Changing precedence scope (moving a skill from project to personal).
- Installing a new plugin that adds skills.

For the repo-local dev loop: edit `.claude/skills/<skill-name>/SKILL.md`, save, continue — next invocation uses the new content.

---

## 10. Permission rules for skills

Control skill availability via `settings.json` permissions:

| Rule form         | Effect                                   |
| ----------------- | ---------------------------------------- |
| `Skill(name)`     | Allow exact skill by name                |
| `Skill(name *)`   | Allow skills with a name prefix (rare)   |
| `deny: ["Skill"]` | Disable the whole Skill tool (hard kill) |

Combine with `disable-model-invocation: true` on destructive skills so Claude cannot auto-invoke them even if the Skill tool is allowed.

---

## 11. Description budget and `SLASH_COMMAND_TOOL_CHAR_BUDGET`

Skill listings share a single startup token pool:

- **Default:** 1% of the session context window, with a fallback floor of ~8,000 characters. This is the official number — **not** the older 15,000-character figure that earlier versions of this reference quoted.
- **Per listing:** `description` + `when_to_use` are concatenated and truncated at **1,536 characters**.
- **Override:** `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var raises the pool when `/context` shows listing pressure.

**Optimization priority when the pool is tight:**

1. Shorten `description` — front-load the key use case.
2. Move trigger phrases into `when_to_use` (still counted, but it's where matching looks first).
3. Disable `user-invocable` on skills that Claude should auto-invoke but users shouldn't see in `/` menus.
4. Merge sibling skills whose scopes overlap.

---

## 12. Related

- [frontmatter-reference.md](frontmatter-reference.md) — field spec
- [skill-frontmatter-schema.md](skill-frontmatter-schema.md) — repo-custom validate/chainTo/retrieval
- [skill-matcher-patterns.md](skill-matcher-patterns.md) — how the repo's keyword/intent/file-trigger scoring works
- [skill-detection-enforcement.md](skill-detection-enforcement.md) — invocation enforcement via the skill-matcher hook
- [commands-patterns.md](commands-patterns.md) — commands merged into skills
