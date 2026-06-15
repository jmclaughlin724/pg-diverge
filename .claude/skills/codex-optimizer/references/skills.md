# Skills Playbook

Sources verified 2026-06-03:

- https://developers.openai.com/codex/skills

## Intent

Use a skill for repeatable work that benefits from reusable instructions, scripts, references, assets, or agent metadata. A skill should help Codex deliver a surface, not merely summarize docs.

## Skill Shape

- `SKILL.md`: the decision workflow and core instructions.
- `## Contract`: the near-top execution contract that states when to use the skill, how little context to load, and what closeout means.
- `references/**`: deeper playbooks, examples, source-specific procedures, and edge cases.
- `scripts/**`: deterministic tooling that the skill can run instead of retyping logic.
- `assets/**`: templates or static artifacts.
- `agents/openai.yaml`: OpenAI-specific metadata such as interface, implicit invocation policy, and tool dependencies.

## Authoring Rules

1. Write the description so Codex can decide when to use the skill.
2. Put the normal workflow in `SKILL.md`.
3. Put `## Contract` immediately after the H1, then move bulky variant guidance into focused reference files.
4. Make references actionable: when to use the surface, what to edit, what to avoid, how to verify, and how repo ownership maps.
5. Prefer imperative steps over background explanation.
6. Add scripts only when they reduce error-prone manual work.

## Optimization Rules

- Scope each skill to one repeatable job. Start with 2-3 representative use cases, concrete inputs, expected outputs, and the closeout command.
- Keep `SKILL.md` as the stable prefix: role, trigger, owner map, normal workflow, and validation. Put volatile examples, incident notes, provider-specific variants, and long references under `references/**`.
- Keep the direct body in this order when compacting large skills: `# Title`, `## Contract`, `## Use When`, `## Direct Workflow`, `## Detail Index`, `## Boundaries`.
- For manual-length skills, move the original body to `references/skill-playbook.md` and keep frontmatter unchanged so invocation metadata remains stable.
- Rewrite relative links after moving the body. Links that pointed from `SKILL.md` to `references/foo.md` must usually point from `references/skill-playbook.md` to `foo.md`.
- Write trigger metadata in user language. Include keywords and file triggers only when they point to the actual job the skill performs.
- Do not make a skill a catch-all rule file. If the instruction is durable policy, move it to `.claude/rules/**`; if it is event-time enforcement, move it to a hook.
- Add `scripts/**` only for deterministic repeat work that is safer to run than to retype.
- For API prompt skills, keep stable instructions/tools/schemas before dynamic request, tenant, timestamp, retrieval, or session context.

## Invocation Behavior

- Codex initially sees the skill name, description, and path, not the full body. On invoke, Codex loads only the full `SKILL.md` body; `references/`, `scripts/`, and `assets/` are loaded on demand (read when needed), not injected up front.
- The initial skill list is capped at roughly 2% of the model context window (≈8,000 characters when the window is unknown); Codex shortens descriptions first and may omit skills with a warning. Front-load the key use case and trigger words in `description`.
- Codex documents no eager `@`-mention import inside `SKILL.md` (unlike CLAUDE.md's `@path` import). Reference files stay lazy, so keep must-have context in the body or a script rather than behind a reference Codex has not read.
- Explicit invocation via `/skills` or `$skill-name` should always work.
- Implicit invocation depends on the description and metadata being specific.
- `[[skills.config]]` can enable, disable, or point at a specific `SKILL.md`.

## Anilize Delivery Pattern

- `.claude/skills/**` is canonical source.
- `.agents/skills/**` is the Codex-compatible generated mirror.
- Do not patch `.agents/skills/**` by hand to fix drift.
- For `.claude/skills/**` edits, run `pnpm sync:llm` only unless the user explicitly requests `pnpm run skills:check`.
