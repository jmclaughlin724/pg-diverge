---
description: Generated agent-surface sync ownership for Claude, Codex, package hook templates, and drift repair.
paths:
  - ".claude/agents/**"
  - ".claude/hooks/**"
  - ".claude/rules/**"
  - ".claude/settings.json"
  - ".claude/skills/**"
  - ".agents/skills/**"
  - ".codex/agents/**"
  - ".codex/hooks/**"
  - ".codex/hooks.json"
  - ".codex/rules/**"
  - "agent-bundle/codex/hooks.*.json"
  - "scripts/guards/agent-surface/check-agent-hooks.mjs"
  - "scripts/guards/agent-surface/check-agent-surface-parity.mjs"
  - "scripts/skills/sync-llm.mjs"
---

# Rule 22 - Generated agent-surface sync ownership

## Contract

This rule owns the generated agent-surface sync invariant. `scripts/skills/sync-llm.mjs` is the single writer for generated Claude-to-Codex and Claude-to-Agents outputs, including source-repo `.codex/hooks.json`.

This rule owns source-repo agent runtime as public branch infrastructure. Required hook entrypoints, shared hook runtime modules, Claude settings, Claude rules, and generated Codex rule mirrors are tracked GitHub branch code. They are not npm package or consumer install surfaces unless Rule 13 explicitly promotes them.

## Hard rules

- `.claude/settings.json` owns maintainer Claude hook registration.
- `scripts/skills/sync-llm.mjs` MUST validate present Claude hook registration before rendering `.codex/hooks.json`.
- `CLAUDE.md` MUST import `@AGENTS.md` when `.claude/settings.json` enables maintainer hooks. `scripts/skills/sync-llm.mjs` MUST fail before rendering `.codex/hooks.json` if the import is missing.
- Hook behavior is verified through executable tests, not policy phrase scanning.
- Source Claude and Codex hook registration MUST include `Stop` and `SubagentStop` response-shape enforcement through the shared runtime. The generated Codex configuration must emit valid JSON for both events and preserve one-shot continuation loop protection.
- `scripts/skills/sync-llm.mjs` MUST write `.codex/hooks.json`, `.codex/hooks/**` mirrors, `.codex/agents/**`, `.codex/rules/**`, `.agents/skills/**`, public `skills/supaschema`, and `agent-bundle/codex/hooks.*.json`.
- `.codex/hooks.json` MUST NOT be hand-authored as an input. Edit `.claude/settings.json`, `.claude/hooks/**`, or `scripts/skills/sync-llm.mjs`, then run `npm run sync:llm`.
- Source-repo `.claude/settings.json` MUST register exactly one Bash `PreToolUse` hook command path for source Claude: `.claude/hooks/context-pre-tool-use.mjs`. It MUST NOT also register `.claude/hooks/guards/bash-policy-checks.mjs` as a direct source Claude `PreToolUse` hook.
- Source-repo `.codex/hooks.json` MUST register exactly one `PreToolUse` context hook for the canonical `Bash` tool. It MUST NOT register `.codex/hooks/general-guard.mjs` in the source repo.
- `scripts/agent-hooks/runner.mjs` MUST own source-repo Claude and Codex `PreToolUse` dispatch order for shell command tools: skill/context gate, response-evidence gate, then Bash safety through `.claude/hooks/guards/bash-policy-checks.mjs`. Rule 12 owns the Stop-time evidence gate that blocks green claims while failed `github-checks` evidence remains unresolved.
- Consumer Codex hook templates under `agent-bundle/codex/hooks.*.json` MUST be rendered from the same source Codex hook config, MUST strip repo-local context hooks, `scripts/agent-hooks/**`, and source-repo supaschema hook launcher commands, and MUST keep `.codex/hooks/general-guard.mjs` as the distinct consumer Bash safety boundary.
- Generated targets MUST NOT carry unique policy. Durable requirements belong in this rule, the owning Claude rule, the owning skill, or the sync script.
- `checkAgentSurfaces({ root })` MUST compare generated targets with their rendered output, including `.codex/hooks.json`.
- `npm run sync:llm:check` MUST fail when `.codex/hooks.json` or generated templates drift.
- The surface-change hook `.claude/hooks/sync-llm-on-claude-surface-change.mjs` MUST trigger sync after edits to `.claude/agents/**`, `.claude/hooks/**`, `.claude/rules/**`, `.claude/skills/**`, `.codex/hooks.json`, `agent-bundle/codex/hooks.*.json`, or `scripts/skills/sync-llm.mjs`.
- `.gitignore` MUST NOT ignore required source-repo runtime or rule surfaces: `.claude/settings.json`, `.claude/hooks/context-*.mjs`, `.claude/hooks/supaschema-source-hook.mjs`, `.codex/hooks/context-*.mjs`, `.codex/hooks/supaschema-source-hook.mjs`, `scripts/agent-hooks/*.mjs`, `.claude/rules/*.md`, and `.codex/rules/*.rules`.
- `.gitignore` MUST keep personal agent overlays, optimizer skills, maintainer agents, `.codex/config.toml`, MCP/server/deployment configs, Code Atlas internals, private services, scratch planning, and generated state local-only.
- Do not use `.gitignore`, `git update-index --assume-unchanged`, or `git update-index --skip-worktree` as the boundary for files required by tracked hook registration or tracked guards. If a tracked branch file references it, the referenced runtime file must be tracked or the reference must be removed.
- If a source-repo runtime surface must become packaged or scaffolded for consumers, update Rule 13, public-surface guards, package tests, scaffold behavior, and docs in the same change.

## Public/private boundary

- Public branch surfaces include tracked product code, tracked guards, tracked tests, `AGENTS.md`, `.claude/settings.json`, source-repo context hook entrypoints, `scripts/agent-hooks/*.mjs`, Claude rules, generated Codex rule mirrors, public supaschema consumer rule/skill surfaces, and consumer-safe `agent-bundle/**` templates.
- Local-only surfaces include optimizer skills, maintainer-only Claude/Codex agents, personal `.agents` or `.claude` overlays, `.codex/config.toml`, Code Atlas data/support, MCP development tooling, deployment configs, private services, scratch planning, and generated state.
- Package surfaces include only what `package.json#files` allows and Rule 13 permits. Consumer setup must remain explicit and must not copy maintainer-only local DX surfaces.
- Source-repo runtime can be public branch code without becoming package code. `package.json#files`, package tests, and `npm pack --dry-run --json` own that second boundary.

## Enforcement chain

- Rule: this file states the owner and generated-target contract.
- Hook: `.claude/hooks/sync-llm-on-claude-surface-change.mjs` runs `npm run sync:llm` when source or generated hook-registration surfaces change.
- Guard: `scripts/guards/agent-surface/check-agent-hooks.mjs` verifies source Claude/Codex single-command-hook topology, package stripping, consumer Bash guard preservation, `Stop` and `SubagentStop` registration, and sync-script ownership. `scripts/guards/agent-surface/check-agent-surface-parity.mjs` runs `checkAgentSurfaces`.
- Test: `tests/agent-hooks/sync-llm.test.ts`, `tests/agent-hooks/agent-hook-core.test.ts`, `tests/agent-hooks/agent-hooks.test.ts`, and `tests/agent-hooks/agent-surfaces.test.ts` cover Claude import validation, source-repo Codex hook topology, source runner Bash blocking, generated-surface drift repair, advisory Codex skill routing, and `Stop`/`SubagentStop` continuation behavior.
- CI: `npm run guard` runs the agent-surface guards.
- Skill (advisory, local-only): `.claude/skills/optimizer/SKILL.md` tells agents to edit the sync owner or Claude registration, keep required source-repo runtime tracked, keep consumer package output narrow, run sync, and run the guards. It is local-only DX, not a deterministic enforcement layer; the Hook, Guard, Test, and CI rows above are the real enforcement.

## Verification

When this rule, hook registration, sync ownership, generated agent surfaces, or package hook templates change, run:

```bash
npm run sync:llm
npm run sync:llm:check
npm run guard:agent
npm run guard
```

Run focused tests for the changed owner:

```bash
npm test -- tests/agent-hooks/sync-llm.test.ts tests/agent-hooks/agent-hook-core.test.ts tests/agent-hooks/agent-surfaces.test.ts tests/agent-hooks/agent-hooks.test.ts
```

## Failure behavior

If sync or guard validation fails:

1. Treat the failure as blocking.
2. Identify whether the defect is in `.claude/settings.json`, `.claude/hooks/**`, `scripts/skills/sync-llm.mjs`, generated output, or package template stripping.
3. Fix the canonical owner or sync script first.
4. Re-run `npm run sync:llm`.
5. Re-run the failed guard or test.
6. Do not patch generated targets directly to silence drift.

## Done means

- `.codex/hooks.json` is generated by `npm run sync:llm`.
- `npm run sync:llm:check` passes.
- `npm run guard:agent` passes.
- Source Claude and Codex configs register `Stop` and `SubagentStop`, their shared response/evidence runtime is tracked, and generated mirrors preserve the continuation contract.
- Source-repo Claude and Codex shell command tools match exactly one context `PreToolUse` hook command, and the shared runner supplies Bash safety.
- Consumer hook templates contain only consumer-safe commands and keep the standalone consumer Bash guard.
- Required source-repo hook runtime and rules are public branch surfaces, while package output still excludes source-only context hooks and `scripts/agent-hooks/**`.
- Tests cover drift detection and repair for generated Codex hook registration.
