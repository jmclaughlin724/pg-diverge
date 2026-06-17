---
description: npm package `files` boundary, consumer agent bundle, postinstall/scaffold surface, and package-content tests.
---

# Rule 13 — npm package boundary

## Contract

This rule owns the published npm package boundary: `package.json#files`, tarball contents, consumer agent bundle, scaffold/postinstall behavior, lifecycle-script silence, and package-content tests.

Sources:

- npm package `files`: <https://docs.npmjs.com/cli/v8/configuring-npm/package-json/#files>
- npm publish contents: <https://docs.npmjs.com/cli/v8/commands/npm-publish/#files-included-in-package>
- npm developer guide: <https://docs.npmjs.com/cli/v9/using-npm/developers/#keeping-files-out-of-your-package>
- Agent Skills specification: <https://agentskills.io/specification>
- Vercel Skills CLI: <https://github.com/vercel-labs/skills>

The published package is an explicit consumer surface. The repository also contains maintainer-only tooling for developing supaschema itself. Keep those surfaces separate.

## Hard rules

- `package.json` `files` is the canonical npm package allowlist.
- Do not add a root `.npmignore` while `package.json` `files` owns the package boundary.
- Treat `npm pack --dry-run --json` as the authoritative preview of the published tarball.
- `postinstall` owns consumer setup after npm downloads the package. Do not confuse tarball contents with files written into the consuming project.
- The downloadable consumer agent bundle is deliberately narrow: `.agents/skills/supaschema`, `.claude/skills/supaschema`, `.claude/rules/supaschema.md`, `.claude/hooks/auto-diff-on-schema-change.mjs`, `.claude/hooks/block-generated-migration-edits.mjs`, `.claude/hooks/sync-llm-on-claude-surface-change.mjs`, `.codex/hooks.json`, and the matching Codex rule and hook script mirrors.
- `skills/supaschema` is the only public `npx skills` source in this repository. It is a generated mirror of `.claude/skills/supaschema` and installs portable Agent Skill context only. It must not include hooks, rules, subagents, config scaffolding, or maintainer skills.
- Do not advertise the repository root as an `npx skills` source. The Skills CLI scans standard agent directories such as `.agents/skills` and `.claude/skills`; this repository uses those locations for maintainer mirrors while developing supaschema itself.
- Consumer package install must not run the Skills CLI or depend on the user's Skills destination choice. `postinstall` and `supaschema init` copy the packaged supaschema skill directories directly into `.agents/skills/supaschema` and `.claude/skills/supaschema`.
- Rules and hooks ship through the npm package scaffold, not through `npx skills`. `postinstall` and `supaschema init` copy the consumer rule/skill/hook files and merge `.claude/settings.json` / `.codex/hooks.json` because those surfaces require runtime-specific project registration.
- `docs/coding-agents/agent-bundle.mdx` is the reader-facing owner for consumer agent bundle contents, installed hook names, hook events, and schema-edit workflow trigger behavior such as `auto-diff-on-schema-change.mjs`. `docs/reference/package-boundary.mdx` owns package mechanics only and should link to the agent-bundle page instead of duplicating the hook contract.
- Consumer setup writes `.claude/settings.json` through `bin/scaffold.mjs` and merges `.codex/hooks.json` from the packaged consumer registration file. The packaged `.codex/hooks.json` must only wire the supaschema generated-migration block, schema auto-diff, and LLM surface sync hooks.
- Maintainer Claude/Codex optimization infrastructure is repo-local by default. Do not publish or scaffold `.claude/hooks/context-*`, `.codex/hooks/context-*`, `scripts/agent-hooks/**`, optimizer skills, internal rules, `.claude/agents/**`, `.codex/agents/**`, `.codex/config.toml`, or other agent-development tooling unless the consumer contract explicitly changes and `tests/package-contents.test.ts`, `tests/database-url.test.ts`, `bin/scaffold.mjs`, and this rule change together.
- Lifecycle scripts that run during `npm pack`/`npm ci`/`npm publish` (`prepare`, `preinstall`, `postinstall`) must not write to stdout. Gates parse that stdout — the `npm pack --silent` tarball name and `npm pack --json` (consumed by `tests/package-contents.test.ts` and `tests/database-url.test.ts`) — so any stray line breaks tarball-name capture and JSON parsing. Route install side-effects through a silent, CI-skipping helper (for example `scripts/install-hooks.mjs`, which `prepare` calls instead of running `lefthook install` directly); never let a hook installer or build step print to stdout from a lifecycle script. Lifecycle helpers and action runners must pass argv arrays with `shell: false`; do not combine child-process args with `shell: true`, which triggers Node DEP0190 and can turn package gates noisy or unsafe.
- Consumer setup is the one-step install surface documented in `docs/installation.mdx` and implemented by `postinstall`; do not maintain a second install-contents list in release or packaging references.
- Maintainer workspace surfaces stay repo-only unless the consumer contract explicitly changes. Examples include `.vscode`, `.mcp.json`, `.claude/cclsp.json`, Postgres Language Server config, Python/FastMCP support, Code Atlas, tests, guards, source files, CI support, and lint config.
- Generated and incremental build artifacts stay out of every allowlisted directory. A broad `files` entry like `dist` sweeps in everything beneath it, so write caches such as a `tsBuildInfoFile` to `.tmp/` (gitignored, not in `files`), never inside `dist/`. A `.tsbuildinfo` must never reach the published tarball.
- When adding, moving, or deleting a package or consumer install surface, update `docs/reference/package-boundary.mdx`, package tests, and tooling guards in the same change.
- When changing the public `npx skills` surface, update `skills/README.md`, `docs/coding-agents.mdx`, `docs/coding-agents/agent-bundle.mdx`, `scripts/skills/sync-llm.mjs`, and `scripts/guards/check-agent-surface-parity.mjs` in the same change.
- Keep consumer lifecycle proof split by phase: tarball contents, install scaffold, installed CLI use, and cross-manager package smoke. `docs/reference/package-boundary.mdx` owns the reader-facing matrix. `npm run release:verify` is the release-facing entry point.

## Enforced by

- `npm run guard`.
- `npm run guard` includes `scripts/guards/check-tooling-stack.mjs`, which AST-checks lifecycle/action runner child-process calls for the `shell: true` plus args shape.
- `npm run check:package`.
- `npm run release:verify`.
- `npm pack --dry-run --json`.
- `npx vitest run tests/editor-surfaces.test.ts tests/database-url.test.ts tests/package-contents.test.ts tests/consumer-lifecycle.test.ts`.

STOP if root `.npmignore` is introduced, `skills/` enters `package.json` `files`, `skills/` exposes anything except `skills/supaschema`, a maintainer-only support surface enters `package.json` `files`, a consumer agent surface is removed from the tarball, `.claude/hooks/context-*`, `.codex/hooks/context-*`, `scripts/agent-hooks/**`, or repo-local context infrastructure enters the tarball or consumer scaffold without an explicit consumer-contract change, `.codex/hooks.json` wires anything beyond the consumer supaschema hooks, a `.tsbuildinfo` or other build cache appears in the dry-run tarball, a lifecycle script (`prepare`/`preinstall`/`postinstall`) writes to stdout and breaks `npm pack` tarball-name or `--json` parsing, a lifecycle helper or action runner passes child-process args with `shell: true`, or `postinstall` writes repo-only tooling into a consuming project without a documented contract change.

## Verification

After package files, scaffold, postinstall, docs, published agent bundle, or release surface changes, run:

```bash
npm run check:package
npm run release:verify
npm run pack:dry
npm pack --dry-run --json
npx vitest run tests/editor-surfaces.test.ts tests/database-url.test.ts tests/package-contents.test.ts tests/consumer-lifecycle.test.ts
```

## Failure behavior

Fix the allowlist, scaffold, docs, or tests. Do not add `.npmignore`, ship maintainer-only tooling, let lifecycle scripts print stdout, or edit generated package artifacts to satisfy tests.

## Done means

The dry-run tarball contains only the intended consumer surface, postinstall/init scaffold parity holds, consumer lifecycle tests pass, and docs match the published package boundary.
