---
name: codex-optimizer
description: "Optimize Codex config surfaces: .codex config/hooks, generated rules and agents, .agents skill mirrors, AGENTS briefs, MCP config, sync ownership, and validation."
metadata:
  skipMetaAnalysisDiscount: true
  keywords:
    - "hook"
    - "hooks"
    - "codex hook"
    - "codex hooks"
    - "native codex hook"
    - "hook enforcer"
    - "PreToolUse"
    - "PostToolUse"
  intent-patterns:
    - "hook.*(enforc|gate|policy|adapter|wiring|fire|trigger|load|block)"
    - "(pre|post)tooluse"
    - "native.*hook"
  file-triggers:
    - ".codex/hooks/**"
    - ".codex/hooks.json"
    - ".claude/hooks/**"
---

# Codex Optimizer

## Contract

This skill is a direct execution contract. Use it only when the trigger matches, load the minimum referenced context needed, and follow the workflow and closeout exactly.

Use this skill for Codex-facing configuration and generated-mirror work in this repo.

## Source Order

1. Read the live repo files first: root `AGENTS.md`, `.claude/rules/12-skill-loading-enforcement.md`, `.claude/rules/01-operating-rules.md`, and the touched sync script under `scripts/skills/` (the `sync:llm` mirror lives in `scripts/skills/sync-llm.mjs`).
2. For OpenAI or Codex product/API facts, use the official OpenAI docs. Local sync scripts prove repo topology only.
3. Treat `.claude/**` as canonical for rules, skills, and Claude hooks. Treat `.codex/config.toml`, `.codex/hooks.json`, and `.codex/hooks/**` as manual Codex runtime surfaces. Treat `.codex/rules/**`, `.codex/skills/**`, and `.agents/skills/**` as generated or compatibility targets unless a rule names the file as repo-owned.

Complete all research and verification in the planning stage, using every lane above plus the Code Atlas and AST/LSP, before editing a canonical owner or handing work to a wave or subagent. Do not defer research to a downstream agent; plan production follows the `task-creator` Planning Research Gate.

## Reference Map

Use these narrow references as implementation playbooks. They are not summaries; each one defines how to deliver the intent for that Codex surface while preserving supaschema ownership rules.

| Surface | Reference |
| --- | --- |
| Config | [`references/config.md`](references/config.md) |
| Rules | [`references/rules.md`](references/rules.md) |
| Hooks | [`references/hooks.md`](references/hooks.md) |
| AGENTS.md | [`references/agents-md.md`](references/agents-md.md) |
| MCP | [`references/mcp.md`](references/mcp.md) |
| Skills | [`references/skills.md`](references/skills.md) |
| Subagents | [`references/subagents.md`](references/subagents.md) |
| Security and auto-review | [`references/security-and-auto-review.md`](references/security-and-auto-review.md) |
| SDK and Agents SDK | [`references/sdk-and-agents-sdk.md`](references/sdk-and-agents-sdk.md) |
| GitHub Actions | [`references/github-actions.md`](references/github-actions.md) |
| Prompting and workflows | [`references/prompting-and-workflows.md`](references/prompting-and-workflows.md) |
| Prompt cache and surface audit | [`references/prompt-cache-and-surface-audit.md`](references/prompt-cache-and-surface-audit.md) |
| Best practices | [`references/best-practices.md`](references/best-practices.md) |
| AI-native teams | [`references/ai-native-teams.md`](references/ai-native-teams.md) |
| Improvement and repair loops | [`references/improvement-and-repair-loops.md`](references/improvement-and-repair-loops.md) |
| Realtime and GPT-5 prompt guidance | [`references/prompt-guidance.md`](references/prompt-guidance.md) |

## Ownership Rules

- `.codex/config.toml` is repo-owned Codex runtime configuration. Edit it directly only when the requested change is Codex runtime behavior, MCP registration, feature flags, project trust, or permission mode.
- `.codex/hooks.json` and `.codex/hooks/**` are repo-owned native Codex runtime surfaces. Edit them directly only for explicit Codex hook registration or adapter behavior. Codex hooks are authored separately from Claude hooks; when they enforce the same policy, align semantics through shared rules/guards while following `references/hooks.md` for Codex payload/output contracts and structured parser/AST classification requirements (rule `07-ast-over-regex`).
- `.codex/rules/**` and `.codex/skills/**` are generated mirrors of the `.claude/**` owner. Do not patch them by hand to fix drift; update the `.claude/**` owner and run the sync command. The `.agents/skills/**` mirror is produced the same way.
- Root `AGENTS.md` is the primary Codex project instruction brief. Keep durable, detailed policy in `.claude/rules/**`; keep reusable workflow guidance in `.claude/skills/**`.
- `.mcp.json` owns the repo MCP registry. Codex MCP config is produced by the sync path, not by duplicating registry entries by hand.
- Do not recreate retired Claude-to-Codex hook mirrors. `npm run sync:llm` mirrors skills only and must not handle hooks. Codex hooks stay in native Codex config if added.

## Audit Workflow

When reviewing or changing Codex config:

1. Identify the controlling surface: runtime config, canonical owner, generated mirror, MCP registry, or operator brief.
2. Trace owner to output: source file, sync script, generated target, and closeout command.
3. Prefer deleting or shortening duplicate guidance over adding another global instruction layer.
4. `npm run sync:llm` mirrors a fixed allowlist of skills from `.claude/skills/<name>` into `.agents/skills/<name>` and `.codex/skills/<name>`. If a mirror exists under `.agents/skills/<name>` or `.codex/skills/<name>` without a `.claude/skills/<name>` owner, classify it as generated-mirror drift. Promote the source into `.claude/skills/<name>` only if the skill should stay.
5. For broad prompting or surface-optimization reviews, use `references/prompt-cache-and-surface-audit.md` to classify findings by prompt-cache shape, skill trigger quality, hook parser quality, AGENTS/rule scope, runtime config, and sync ownership.
6. Sweep references after renames or deletions: skill frontmatter, `chainTo`, `upgradeToSkill`, preferred-skill pointers, and context-surface pointers.

## Validation

Run the checks that match the touched surface:

- `.claude/skills/**`: `npm run sync:llm` to refresh the mirrors, then `npm run guard:agent` to verify agent-surface parity.
- `.claude/rules/**` or root `AGENTS.md`: `npm run guard` (`scripts/guards/check-all.mjs`) for the full agent-surface gate.
- `.codex/config.toml`, `.codex/rules/**`, `.codex/skills/**`, or `.mcp.json`: `npm run guard:agent`, then `npm run sync:llm` if a mirrored skill changed.
- Hook sources, `.codex/hooks.json`, or `.codex/hooks/**`: do not use `npm run sync:llm`; use `npm run guard:agent` (`scripts/guards/check-agent-hooks.mjs`) and any hook-specific validation the touched scope requires.
- Package or release surfaces touched by the change: `npm run check:package`.

## Completion Gate

- The canonical owner contains the real policy or workflow.
- Generated mirrors are current and not hand-edited.
- Codex-specific facts have upstream proof when they are not repo-local facts.
- The final report names the owner updated, sync command run, and any concrete blocker inside the touched scope.
