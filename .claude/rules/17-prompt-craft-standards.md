---
enforcement:
  type: judgment-only
description: Authoring standards for AGENTS, CLAUDE, rules, skills, agents, hooks, commands, generated mirrors, and session-agent prompts.
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - "scripts/agent-hooks/**"
  - "scripts/skills/**"
---

# Rule 17 - Prompt craft standards

## Contract

This rule owns how agent instructions are written and delivered. Stable prevention policy may live in the root brief or rules; repeatable workflows belong in skills, deterministic enforcement belongs in hooks or guards, and generated mirrors remain targets rather than owners. Rule 18 owns the root `AGENTS.md` exemption from route-map, concision, section-order, and content-placement prescriptions.

Upstream Responses API guidance for prompt economy, skills, multi-agent delegation, reasoning controls, and tool orchestration lives in the optimizer skill reference `codex/prompting/responses-prompt-and-tool-contract.md`. Load it when a change turns on that guidance rather than restating it here.

## Surface selection

- Root `AGENTS.md`: canonical Codex project instruction brief. Preserve its user-defined content and structure (Rule 18).
- Nested `<subfolder>/AGENTS.md`: directory-scoped context that may serve as a concise route map or owner brief for that subtree.
- `.claude/rules/**`: durable policy, boundaries, STOP gates, and verification paths.
- `.claude/skills/**`: repeatable procedures, examples, references, scripts, and assets.
- `.claude/hooks/**` and `scripts/agent-hooks/**`: deterministic lifecycle enforcement.
- `.codex/**` and `.agents/**`: runtime config or generated/synced mirrors as defined by Rule 18.
- `README.md`: npm package landing page, not agent policy.
- `docs/**`: Blume public docs, not agent policy.

## Rule and skill shape

Every non-stub rule or skill must include:

- frontmatter with a short `description`;
- `## Contract` near the top;
- direct rules before examples, history, or reference detail;
- verification and failure behavior when the surface is executable;
- no unresolved placeholders, no machine-local absolute paths, no stale plan text.

Skill-loading metadata must use the existing Rule 12 hook-enforcement path. For repo-managed skills, use `metadata.keywords` for literal prompt signals and `metadata.file-triggers` for structured file and tool path signals. Do not add `intent-patterns`, regex intent fields, or parallel matcher metadata. If matching behavior changes, update `scripts/agent-hooks/skills.mjs`, `scripts/guards/agent-surface/check-agent-hooks.mjs`, and Rule 12 together.

## Collaboration and response contract

- Keep personality and collaboration guidance short and distinct. Personality controls tone; collaboration controls initiative, questions, assumptions, uncertainty, tradeoffs, and verification.
- Before multi-step tool work, give a one- or two-sentence first-step preamble. Update at major phase changes or when evidence changes the plan; do not narrate routine calls.
- Lead final responses with the outcome unless the turn contains a material tool or runtime incident, rejected action, timeout, truncation, partial mutation, or lost-evidence event that the root contract requires surfaced first. In that case, lead with an explicit incident label, name what happened without euphemism, state impact and recovery evidence, and then give the outcome. A recovered incident remains prominent; do not demote it to a trailing caveat. For a recorded shell command-not-found incident, begin exactly with `Tool incident:` and explicitly say `command not found`.
- For edits, rewrites, summaries, and drafts, preserve the requested artifact, factual claims, length, structure, and genre before improving clarity. Do not add claims, sections, or promotional tone unless requested.

## Generated prompt contract

Prompts generated for another session agent must include:

1. Mission.
2. Context.
3. Authority and rule priority.
4. Scope in/out.
5. Non-negotiable rules.
6. Required workflow.
7. Verification.
8. Stop conditions.
9. Failure behavior.
10. Output format.
11. Acceptance criteria.

Generated prompts must not contain unresolved placeholders, invented paths, invented commands, secrets, local-only absolute paths, or unverified repo facts. If repo access is unavailable, label file paths and commands as assumptions and tell the session agent to inspect them first.

## AGENTS.md scope

Rule 18 owns the root-brief boundary: do not prescribe the root `AGENTS.md` length, section order, level of detail, route-map role, or content placement, and preserve its user-authored content unless the user explicitly requests a root-brief edit. Content-shaping guidance in this rule applies only to nested `<subfolder>/AGENTS.md` files, which may stay concise, describe local ownership and commands, and route deeper procedures to rules or skills.

## Style

- Use `MUST`/`MUST NOT` only for structural correctness, safety, security, package boundary, migration, or generated-surface requirements.
- Use direct bullets and concrete commands.
- Avoid vague phrases such as "best practices" unless immediately defined.
- Put long background and examples in skill-local `references/**`.
- Use tables only when the matrix is the rule.
- For review and audit prompts, require evidence, severity, uncertainty, and non-speculative findings.

## Verification

After changing rules, skills, hooks, agents, commands, generated mirrors, or root briefs, run the relevant sync/check command:

```bash
npm run sync:llm
npm run guard
```

Use narrower commands (`npm run guard:agent`, focused hook tests, rule/skill checks) when the task is scoped.

## Failure behavior

Fix the canonical owner first, then regenerate mirrors. Do not patch a generated mirror, duplicate policy across surfaces, or add a new rule or skill without an enforcement or verification story.

## Done means

- The instruction lives in the correct surface.
- The rule or skill has a contract, scope, verification, and failure behavior.
- Generated targets are synced from owners.
- No unresolved placeholders, secrets, stale dates, or local-only absolute paths remain.
