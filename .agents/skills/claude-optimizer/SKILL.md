---
name: claude-optimizer
description: "Optimize Claude Code config: AGENTS/CLAUDE stubs, .claude rules, skills, agents, commands, hooks, ownership, progressive disclosure, and validation."
metadata:
  skipMetaAnalysisDiscount: true
  keywords:
    - "hook"
    - "hooks"
    - "claude hook"
    - "claude hooks"
    - "hook enforcer"
    - "skill matcher"
    - "PreToolUse"
    - "PostToolUse"
    - "Stop hook"
    - "UserPromptSubmit"
  file-triggers:
    - ".claude/hooks/**"
    - ".claude/settings.json"
    - ".claude/settings.local.json"
---

# Claude Optimizer

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

Use this skill for Claude Code configuration work. Read official platform docs before changing platform-specific surfaces.

## Core Rules

- Complete all research and verification in the planning stage before editing or delegating: read the official platform docs, the canonical owner files, and run code-map/AST/LSP for any blast-radius claim. Do not defer research to a downstream agent or wave — a config edit or subagent prompt ships only after its evidence is resolved. Plan production follows the `task-creator` Planning Research Gate.
- Put guidance in the lowest-noise owner: root `AGENTS.md` for universal repo context, `CLAUDE.md` as the Claude runtime entry point that imports `AGENTS.md`, rules for scoped policy, skills for reusable workflows, commands for explicit invocations, and hooks for harness-enforced behavior.
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so the `@AGENTS.md` import or symlink is required for the AGENTS-first repo pattern.
- Durable lessons land in `.claude/rules/**`, hooks, skills, or owner briefs. Persistent recall mechanisms are off-policy here.
- Keep core files short. Move examples, variants, and long rationale into references.
- Do not duplicate the same instruction across rules, skills, commands, and AGENTS files.
- If a repo-specific config pattern changed, update the canonical owner and every discovery surface that routes users there.
- Claude config work is repo-local unless Rule 13 explicitly promotes a surface into the downloadable consumer package or scaffold. Do not add `.claude/hooks/context-*`, optimizer skills, internal rules, agents, or shared context-enforcement runtime to `package.json` `files` or `bin/scaffold.mjs` just because they are valid repo-local Claude surfaces.
- Permission rule precedence is `deny → ask → allow`; settings precedence is `managed → CLI args → project local → project shared → user`. A managed deny cannot be overridden anywhere downstream. Six permission modes exist: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` — see [`references/permissions-and-settings.md`](references/permissions-and-settings.md).

## Runtime & Session Surfaces

- [`references/effort-and-thinking.md`](references/effort-and-thinking.md) — effort levels (low/medium/high/xhigh/max), `effortLevel` / `CLAUDE_CODE_EFFORT_LEVEL`, `/effort`, `ultracode`, thinking-token controls, adaptive reasoning.
- [`references/dynamic-workflows.md`](references/dynamic-workflows.md) — `/workflows`, `ultracode` JS orchestration, approval gates, `disableWorkflows`, bundled `/deep-research`.
- [`references/prompt-caching-runtime.md`](references/prompt-caching-runtime.md) — runtime prompt cache layers, effort/model as cache keys, TTL, cache-preserving actions, `DISABLE_PROMPT_CACHING`.
- [`references/output-and-session-surfaces.md`](references/output-and-session-surfaces.md) — output styles, status line + JSON schema, `/rewind` checkpointing, `cleanupPeriodDays`.

## Subagent + Skill Runtime Contract

Agent definitions in `.claude/agents/*.md` interact with the path-trigger agent hook gate in two non-obvious ways:

1. **`skills:`** preloads full `SKILL.md` content at subagent startup (deterministic, front-loads context cost).
2. **`tools:`** controls runtime invocation of non-preloaded skills. If `tools:` is an explicit allowlist that omits `Skill` and usable skill reads, the subagent cannot actively load a path-trigger skill at runtime. The gate no longer deadlocks such a subagent: inside a subagent (payload `agent_id`) it downgrades the hard deny to advisory `additionalContext` (Rule 12), so the worker is informed and continues. Keeping `Skill` in `tools:` (or omitting `tools:`) stays best practice so the worker can act on that advisory instead of only reporting it.

When designing or auditing an agent that may receive fan-out work, verify either `Skill` is in the `tools:` list or `tools:` is omitted entirely (inherits all). See [`references/subagent-skill-runtime.md`](references/subagent-skill-runtime.md) for the full contract, the advisory-in-subagent gate behavior, the runtime invocation precondition, and the "report findings, orchestrator applies" fallback.

**Loading model:** a skill invoke injects only the `SKILL.md` body; references are lazy (`Read`-pulled) and `@`-mentions are **inert** in `SKILL.md`; a fresh subagent inherits none of the parent's loaded skills. See [`references/dynamic-context-and-runtime.md`](references/dynamic-context-and-runtime.md) §1a and [`references/subagent-skill-runtime.md`](references/subagent-skill-runtime.md).

## Audit Workflow

- When auditing skill, hook, or rule files that reference symbols from source, run AST/LSP source inspection on the symbol first to anchor blast-radius claims.

When auditing config health, review these surfaces together:

1. `.claude/rules/**` — including any `paths` frontmatter for path-scoped rules, plus user-level `~/.claude/rules/` overrides
2. `.claude/skills/**` and their `references/**`
3. `.claude/commands/**`
4. `.claude/agents/**`
5. `.claude/hooks/**` and `.claude/settings*.json` — including `permissions.allow|ask|deny`, `defaultMode`, `additionalDirectories`, `sandbox.*`, and `claudeMdExcludes`
6. relevant `AGENTS.md` and any `@AGENTS.md` import inside the adjacent `CLAUDE.md` runtime entry point

If a requested skill exists only under `.agents/skills/<name>`, resolve the generated-mirror drift through Rule 12 (skill-loading enforcement) and the Rule 01 `sync:llm` ownership contract before optimizing it.

Prioritize: contradictions, stale ownership, broken discovery metadata, then noise reduction. Settings drift (a managed deny silently overridden in code reviews, an `auto`-mode lockout missing from a sensitive workspace) is often invisible until a permission prompt blocks a real workflow — surface it during audit.

## Validation

Run the checks that match the surfaces you touched:

- `npm run guard` — the aggregate config/agent-surface guard (`scripts/guards/check-all.mjs`)
- `npm run guard:agent` for `.claude/**` agent-surface drift
- For `.claude/skills/**`, run `npm run sync:llm` to regenerate the `.agents` mirror

After editing canonical `.claude/**` sources, run `npm run sync:llm` to propagate to the generated LLM surfaces, then `npm run guard` (or `npm run guard:agent`) to prove the surfaces are consistent. For skills, `npm run sync:llm` is the closeout command.

## Completion Gate

- The config lives in the correct owner.
- Metadata is valid and discovery-friendly.
- No deleted or renamed owner is still referenced from another config surface.
- Relevant `AGENTS.md` files match the new ownership rules.
- Durable repo-level lessons uncovered during the pass land in their canonical owner: rule, hook, skill, or AGENTS brief. Retired persistent-recall surfaces are not repo guidance owners and are not committed.
