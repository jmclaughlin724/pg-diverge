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
| Claude compatibility | `CLAUDE.md` | Claude Code | keep as `@AGENTS.md` unless Claude-specific guidance is intentional |
| Rules | `.claude/rules/**` | Codex rule pointers/mirrors when packaged | `npm run sync:llm`; rule guard if available |
| Skills | `.claude/skills/**` | `.agents/skills/**`, `.codex/skills/**` for mirrored skills; `skills/supaschema` for the public `npx skills` source | `npm run sync:llm` |
| Hooks | `.claude/hooks/**` | `.codex/hooks/**` mirrors or native adapters where supported | edit Claude/shared owner, then sync or update native adapter |
| Native Codex hook registration | `.codex/hooks.json` | packaged consumer registration | validate with hook/package guards |
| MCP registry | `.mcp.json`, `fastmcp.json` | local MCP clients and package docs | `npm run guard:fastmcp`, `npm run guard:agent` |
| Consumer agent bundle | `package.json#files`, `bin/scaffold.mjs`, `.claude/skills/supaschema`, `.claude/rules/supaschema.md`, consumer hooks | npm tarball and installed project scaffold | `npm run check:package`, `npm pack --dry-run --json`, lifecycle tests |

## Rules

- `.claude/**` is the canonical authoring surface for maintainer Claude rules, skills, hooks, and agents.
- `AGENTS.md` is a navigational index for agent entry. It must point to rule owners instead of duplicating durable policy.
- `.codex/**` and `.agents/**` are generated or native runtime targets only where this rule names them as owners.
- `scripts/skills/sync-llm.mjs` is the writer for generated LLM mirrors. Do not hand-edit synced copies.
- `skills/supaschema` is a generated public mirror of `.claude/skills/supaschema`. It is the only supported `npx skills` source in this repository.
- Consumer-bundled surfaces are deliberately narrow. Do not publish maintainer-only context hooks, optimizer skills, Code Atlas internals, FastMCP development tooling, or agent-development infrastructure without changing Rule 13 and package tests in the same change.
- `README.md` and `docs/**` are public product surfaces. They may reference agent setup, but they do not own operator policy.
- Generated mirrors are not live reloads. Restart the CLI/session or reload the extension before expecting new runtime behavior.

## Sync selection

| Change | Minimum sync/check |
| --- | --- |
| Supaschema consumer skill/rule/hook | `npm run sync:llm`, package checks when bundled |
| Maintainer skill only | `npm run sync:llm` for mirrored skills |
| Hook source | `npm run hooks:check`, focused hook tests, `npm run sync:llm` if mirrored |
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

If sync validation fails:

1. Identify whether the failure is in the canonical owner, sync script, generated target, native runtime config, or package allowlist.
2. Fix the canonical owner or sync script first.
3. Re-run the narrow sync/check.
4. Do not patch generated mirrors directly.
5. If another session owns overlapping generated output, preserve unrelated hunks per Rule 14.

## Done means

- Canonical owner and generated targets agree.
- Package-bundled context surfaces match Rule 13.
- Runtime registrations match the hook/MCP surfaces they expose.
- No generated mirror carries unique policy.
