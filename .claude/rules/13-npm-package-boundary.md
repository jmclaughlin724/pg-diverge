---
description: npm package `files` boundary, raw consumer agent bundle, explicit init scaffold surface, and package-content tests.
---

# Rule 13 — npm package boundary

## Contract

This rule owns the published npm package boundary: `package.json#files`, tarball contents, raw consumer agent bundle, explicit `supaschema init` scaffold behavior, lifecycle-script silence, and package-content tests.

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
- Package install downloads files only. Consumer setup is explicit through `supaschema init`; do not confuse tarball contents with files written into the consuming project.
- The downloadable consumer agent bundle is deliberately narrow and inactive by default: `agent-bundle/INSTALL.md`, shared prompt and skill files, Claude rule/skill/hook/settings variants, and Codex rule/hook/settings variants. Generated-migration blocking and schema-write automation remain direct `supaschema hook` CLI commands in the reviewed settings templates; do not ship wrapper scripts for them.
- `skills/supaschema` is the only public `npx skills` source in this repository. It is a generated mirror of `.claude/skills/supaschema` and installs portable Agent Skill context only. It must not include hooks, rules, subagents, config scaffolding, or maintainer skills.
- Do not advertise the repository root as an `npx skills` source. The Skills CLI scans standard agent directories such as `.agents/skills` and `.claude/skills`; this repository uses those locations for maintainer mirrors while developing supaschema itself.
- Consumer package install and default `supaschema init` must not run the Skills CLI or depend on the user's Skills destination choice. They must not copy active `.agents`, `.claude`, `.codex`, `AGENTS.md`, or `CLAUDE.md` surfaces.
- Rules and hooks ship as raw package files under `agent-bundle/**`, not through `npx skills`. `supaschema init` must not copy the consumer rule/skill/hook files or merge `.claude/settings.json` / `.codex/hooks.json`; reviewed manual installation from `agent-bundle/INSTALL.md` owns runtime-specific project registration.
- `docs/coding-agents/agent-bundle.mdx` is the reader-facing owner for consumer agent bundle contents, installed hook commands, hook events, and schema-edit workflow trigger behavior such as `supaschema hook schema-write`. `docs/reference/package-boundary.mdx` owns package mechanics only and should link to the agent-bundle page instead of duplicating the hook contract.
- Agent-bundle setup instructions expose packaged settings templates for reviewed manual merge only. The packaged Codex hook templates must only wire the supaschema generated-migration block, schema auto-diff, LLM surface sync hook, and the Rule 20 general Bash safety blocker that prevents secret argv/env-file reads, raw SQL DDL through Bash, destructive git shortcuts, and `rm -rf` equivalents.
- Rule 22 owns source-repo Codex hook registration and generated hook topology. This rule owns the package boundary: `scripts/skills/sync-llm.mjs` MUST strip source-only context hooks, `scripts/agent-hooks/**`, and source-repo hook launcher commands from `agent-bundle/codex/hooks.*.json`, replacing supaschema hook invocations with consumer package-manager commands. Consumer Codex hook templates MUST keep `.codex/hooks/general-guard.mjs` as the standalone consumer Bash safety boundary. Source-repo runtime may be tracked in the GitHub branch, but it must never enter the published consumer bundle or active consumer install output unless the consumer contract explicitly changes.
- Maintainer Claude/Codex optimization infrastructure is repo-local by default. Do not publish or scaffold `.claude/hooks/context-*`, `.codex/hooks/context-*`, `scripts/agent-hooks/**`, optimizer skills, internal rules, generated Codex rule mirrors, `.claude/agents/**`, `.codex/agents/**`, `.codex/config.toml`, or other agent-development tooling unless the consumer contract explicitly changes and `tests/package-contents.test.ts`, `tests/database-url.test.ts`, `bin/scaffold.mjs`, docs, and this rule change together. GitHub branch tracking is not package publication; `package.json#files`, package tests, and `npm pack --dry-run --json` own the package boundary.
- Required source-repo hook runtime and rule surfaces MUST be tracked when tracked hook registration, guards, or `AGENTS.md` route to them. Personal/local DX remains gitignored.
- Lifecycle scripts that run during `npm pack`/`npm ci`/`npm publish` (`prepare`, `preinstall`, `postinstall`) must not write to stdout. Gates parse that stdout — the `npm pack --silent` tarball name and `npm pack --json` (consumed by `tests/package-contents.test.ts` and `tests/database-url.test.ts`) — so any stray line breaks tarball-name capture and JSON parsing. Route install side-effects through a silent, CI-skipping helper (for example `scripts/install-hooks.mjs`, which `prepare` calls instead of running `lefthook install` directly); never let a hook installer or build step print to stdout from a lifecycle script. Lifecycle helpers and action runners must pass argv arrays with `shell: false`; do not combine child-process args with `shell: true`, which triggers Node DEP0190 and can turn package gates noisy or unsafe.
- Consumer setup is documented in `docs/installation.mdx` and implemented by explicit `supaschema init`; do not maintain a second install-contents list in release or packaging references.
- `main` is a release branch, not a silent integration branch. Release preflight must publish a package version that is not yet on npm, repair a missing GitHub Release for an already published version, or fail a `push` to `main` when both npm and GitHub already have the current version. Do not let a main push complete release automation without either creating a downloadable npm package or proving it is only repairing release metadata.
- Tarball smoke and registry smoke are separate package proofs. `npm run package:smoke` proves the local tarball installs and initializes through supported package managers before publish. The release workflow must also run registry smoke against `supaschema@<version>` after publish and on npm-published GitHub Release repair reruns before Release creation, so npm, pnpm, and Bun can download and execute the package from the npm registry.
- Keep package-manager smoke on current supported client behavior. pnpm coverage must include pnpm 11 behavior and must use an explicit `minimumReleaseAge` override for immediate-release smoke paths instead of accidentally accepting pnpm's default one-day fresh-version cooldown as package unavailability. Consumer installation docs and shipped prompts must keep `pnpm add supaschema` as the default so ordinary installs retain pnpm's release-age protection; document `--config.minimumReleaseAge=0` only for immediate-release troubleshooting.
- Maintainer workspace surfaces stay repo-only unless the consumer contract explicitly changes. Examples include `.vscode`, `.mcp.json`, `.claude/cclsp.json`, Postgres Language Server config, Python/FastMCP support, Code Atlas, tests, guards, source files, CI support, and lint config.
- Generated and incremental build artifacts stay out of every allowlisted directory. A broad `files` entry like `dist` sweeps in everything beneath it, so write caches such as a `tsBuildInfoFile` to `.tmp/` (gitignored, not in `files`), never inside `dist/`. A `.tsbuildinfo` must never reach the published tarball.
- When adding, moving, or deleting a package or consumer install surface, update `docs/reference/package-boundary.mdx`, package tests, and tooling guards in the same change.
- When changing the public `npx skills` surface, update `skills/README.md`, `docs/coding-agents.mdx`, `docs/coding-agents/agent-bundle.mdx`, `scripts/skills/sync-llm.mjs`, and `scripts/guards/agent-surface/check-agent-surface-parity.mjs` in the same change.
- Keep consumer lifecycle proof split by phase: tarball contents, install scaffold, installed CLI use, and cross-manager package smoke. `docs/reference/package-boundary.mdx` owns the reader-facing matrix. `npm run release:verify` is the release-facing entry point and must run `npm run test:consumer-lifecycle` before `npm run package:smoke` so installed CLI use fails locally before CI.

## Enforced by

- `npm run guard`.
- `npm run guard` includes `scripts/guards/toolchain/check-tooling-stack.mjs`, which AST-checks lifecycle/action runner child-process calls for the `shell: true` plus args shape.
- `npm run check:package`.
- `npm run test:consumer-lifecycle`.
- `npm run release:verify`.
- `npm run release:registry-smoke` in the post-publish release workflow.
- `npm pack --dry-run --json`.
- `npx vitest run tests/editor-surfaces.test.ts tests/database-url.test.ts tests/package-contents.test.ts tests/consumer-lifecycle.test.ts`.

STOP if root `.npmignore` is introduced, `skills/` enters `package.json` `files`, `skills/` exposes anything except `skills/supaschema`, a maintainer-only support surface enters `package.json` `files`, required source-repo runtime is hidden behind `.gitignore` while tracked hook registration or guards depend on it, the raw `agent-bundle` surface is removed from the tarball, default init writes active `.agents`, `.claude`, `.codex`, `AGENTS.md`, or `CLAUDE.md` surfaces, `.claude/hooks/context-*`, `.codex/hooks/context-*`, `scripts/agent-hooks/**`, optimizer skills, internal rules, generated rule mirrors, or repo-local context infrastructure enters the tarball or consumer scaffold without an explicit consumer-contract change, the Codex hook templates wire anything beyond the consumer supaschema hooks and general Bash safety blocker, a `.tsbuildinfo` or other build cache appears in the dry-run tarball, a lifecycle script (`prepare`/`preinstall`/`postinstall`) writes to stdout and breaks `npm pack` tarball-name or `--json` parsing, or a lifecycle helper or action runner passes child-process args with `shell: true`.

## Verification

After package files, scaffold, docs, published agent bundle, or release surface changes, run:

```bash
npm run check:package
npm run test:consumer-lifecycle
npm run release:verify
npm run pack:dry
npm pack --dry-run --json
npx vitest run tests/editor-surfaces.test.ts tests/database-url.test.ts tests/package-contents.test.ts tests/consumer-lifecycle.test.ts
```

## Failure behavior

Fix the allowlist, scaffold, docs, or tests. Do not add `.npmignore`, ship maintainer-only tooling in the package, let lifecycle scripts print stdout, or edit generated package artifacts to satisfy tests.

## Done means

The dry-run tarball contains only the intended consumer surface, default init stays config-only, opt-in agent-bundle scaffold parity holds, consumer lifecycle tests pass, and docs match the published package boundary.
