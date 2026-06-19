---
enforcement:
  type: judgment-only
description: Canonical owner and sync matrix for Claude, Codex, Agents, skills, rules, hooks, MCP config, and package-bundled consumer surfaces.
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - ".gemini/**"
  - ".mcp.json"
  - "fastmcp.json"
  - "scripts/skills/**"
  - "scripts/agent-hooks/**"
  - "bin/scaffold.mjs"
  - "package.json"
---

# Rule 18 — Context surface sync

## Contract

This rule owns the canonical-owner and generated-mirror sync matrix for agent-facing context surfaces. Edit the owner first, then run the narrow sync that target requires. Do not patch generated mirrors while leaving their owner stale.

## Owner matrix

| Surface | Canonical owner | Targets | Sync / validation |
| --- | --- | --- | --- |
| Root route map | `AGENTS.md` | discovered by coding agents | no sync; validate with `npm run guard` |
| Claude runtime entrypoint | `CLAUDE.md` | Claude Code | keep as a runtime entrypoint for Claude Code only; unique durable policy belongs in `AGENTS.md` or scoped rules |
| Rules | `.claude/rules/**` | Codex rule pointers/mirrors when packaged | `npm run sync:llm`; rule guard if available |
| Skills | `.claude/skills/**` | `.agents/skills/**` for mirrored skills; `skills/supaschema` for the public `npx skills` source | `npm run sync:llm` |
| Hooks | `.claude/hooks/**` | `.codex/hooks/**` mirrors or native adapters where supported | edit Claude/shared owner, then sync or update native adapter |
| Native Codex hook registration | `scripts/skills/sync-llm.mjs` plus `.claude/settings.json`; see Rule 22 | `.codex/hooks.json` and packaged consumer registration | `npm run sync:llm`, `npm run sync:llm:check`, hook/package guards |
| Response-shape enforcement | `.claude/rules/12-skill-loading-enforcement.md`, `scripts/agent-hooks/detectors.mjs`, `scripts/agent-hooks/runner.mjs`, `.claude/settings.json`; see Rule 22 | Claude and generated Codex `Stop`/`SubagentStop` enforcement | `npm run sync:llm`, `npm run sync:llm:check`, `npm run guard:agent`, focused hook/sync tests |
| MCP registry | `.mcp.json`, `fastmcp.json` | local MCP clients and package docs | `npm run guard:fastmcp`, `npm run guard:agent` |
| Consumer agent bundle | `.claude/skills/supaschema`, `.claude/rules/supaschema.md`, consumer hook sources, `agent-bundle/INSTALL.md`, `package.json#files`, `bin/scaffold.mjs`, `scripts/skills/sync-llm.mjs` | raw npm tarball bundle and opt-in installed project scaffold | `npm run sync:llm`, `npm run check:package`, `npm pack --dry-run --json`, lifecycle tests |

## Rules

- `.claude/**` is the canonical authoring surface for maintainer Claude rules, skills, hooks, and agents.
- `AGENTS.md` is a navigational index for agent entry. It must point to rule owners instead of duplicating durable policy.
- `CLAUDE.md` MUST import `@AGENTS.md` when maintainer hooks are enabled, so Claude sessions receive the same root operating contract that Codex receives.
- `.codex/**` and `.agents/**` are generated or native runtime targets only where this rule names them as owners.
- `scripts/skills/sync-llm.mjs` is the writer for generated LLM mirrors and generated source-repo `.codex/hooks.json`. It MUST validate Claude hook registration, `CLAUDE.md` root-contract import, and response-shape enforcement before rendering Codex hook registration. Do not hand-edit synced copies.
- Source-repo Codex shell command tools MUST resolve through one generated `PreToolUse` hook command, `.codex/hooks/context-pre-tool-use.mjs`. Do not register overlapping source-repo `PreToolUse` Bash safety or CI inbox hook commands; dispatch them inside `scripts/agent-hooks/runner.mjs`.
- Packaged consumer Codex hook templates MUST keep the standalone `.codex/hooks/general-guard.mjs` Bash safety hook because consumer packages do not include the maintainer context runner path.
- `skills/supaschema` is a generated public mirror of `.claude/skills/supaschema`. It is the only supported `npx skills` source in this repository.
- Consumer-bundled surfaces are deliberately narrow and inactive by default. Do not publish maintainer-only context hooks, optimizer skills, Code Atlas internals, FastMCP development tooling, or agent-development infrastructure without changing Rule 13 and package tests in the same change.
- Source-repo hook runtime, Claude rules, generated Codex rule mirrors, and `.claude/settings.json` are public branch surfaces when tracked `.codex/hooks.json`, guards, or `AGENTS.md` route to them. Keep personal overlays, optimizer skills, maintainer-only agents, `.codex/config.toml`, Code Atlas internals, MCP/deployment configs, private services, and generated state gitignored.
- Do not use `.gitignore` or Git index flags to hide a file required by tracked hook registration, tracked guards, or tracked rule routing. Track the required runtime file or remove the tracked reference.
- `README.md` and `docs/**` are public product surfaces. They may reference agent setup, but they do not own operator policy.
- Generated mirrors are not live reloads. Restart the CLI/session or reload the extension before expecting new runtime behavior.

## Sync selection

| Change | Minimum sync/check |
| --- | --- |
| Supaschema consumer skill/rule/hook | `npm run sync:llm`, package checks when bundled |
| Maintainer skill only | `npm run sync:llm` for mirrored skills |
| Hook source | `npm run hooks:check`, focused hook tests, `npm run sync:llm` if mirrored |
| Response-shape detector or runtime adapter | `npm run sync:llm`, `npm run sync:llm:check`, `npm run guard:agent`, focused hook/sync tests |
| Generated Codex hook registration or package hook templates | `npm run sync:llm`, `npm run sync:llm:check`, `npm run guard:agent`, focused sync/hook tests |
| Public/private agent-surface boundary | `npm run guard:public-surface`, `npm run check:package`, focused editor/package tests |
| MCP surface | `npm run guard:fastmcp`, `npm run guard:agent` |
| Package bundle | `npm run check:package`, `npm pack --dry-run --json`, lifecycle tests |

## Verification

Run the narrowest sync/check that matches the edited surface. For full context-surface changes, run:

```bash
npm run sync:llm
npm run guard
```

For package-bundled consumer surfaces, also run `npm run check:package` and `npm pack --dry-run --json`.

## Failure behavior

If sync or public/private boundary validation fails:

1. Identify whether the failure is in the canonical owner, sync script, generated target, native runtime config, or package allowlist.
2. Fix the canonical owner or sync script first.
3. Re-run the narrow sync/check.
4. Do not patch generated mirrors directly.
5. Do not hide required source-repo runtime behind `.gitignore`; add or repair tracked guard/test enforcement and keep package output narrow instead.
6. If another session owns overlapping generated output, preserve unrelated hunks per Rule 14.

## Done means

- Canonical owner and generated targets agree.
- Package-bundled context surfaces match Rule 13.
- Required source-repo runtime and rules are tracked branch surfaces; personal DX and generated state remain gitignored.
- Runtime registrations match the hook/MCP surfaces they expose.
- Source-repo Codex shell tools match one `PreToolUse` hook command, and consumer hook templates retain only their distinct standalone Bash guard.
- No generated mirror carries unique policy.
