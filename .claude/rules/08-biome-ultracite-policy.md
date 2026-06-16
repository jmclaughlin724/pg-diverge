---
description: Biome/Ultracite JS/TS lint and format policy for the single-package npm repo.
---

# Rule 08 — Biome/Ultracite is the JS/TS lint policy

## Contract

This rule owns the JS/TS/JSON/CSS/HTML/GraphQL lint and format policy: root `biome.jsonc` extends Ultracite presets, Biome/Ultracite is the only JS/TS gate, and generated surfaces stay excluded.

Sources:

- Biome configuration docs: <https://biomejs.dev/guides/configure-biome/>
- Biome linter docs: <https://biomejs.dev/linter/>
- Biome suppression docs: <https://biomejs.dev/analyzer/suppressions/>
- Ultracite Biome provider: <https://docs.ultracite.ai/provider/biome>
- Ultracite MCP server: <https://docs.ultracite.ai/mcp-server>

Biome is the canonical JS/TS/JSX/TSX/JSON/JSONC/CSS/HTML/GraphQL formatter and linter. Ultracite supplies the shared preset and agent-facing docs; package scripts consume the same root policy. This rule owns the JS/TS Biome/Ultracite policy; Rule 06 owns the cross-language format/lint/type ownership map, and Rule 07 governs the AST-over-regex contract for the guard scripts that enforce this policy.

## Hard rules

- `biome.jsonc` is the canonical JS/TS/JSX/TSX/JSON/JSONC/CSS/HTML/GraphQL lint and format configuration. This is a single-package npm repo (no pnpm, no Turborepo, no workspaces), so there is exactly one root `biome.jsonc` and no per-package Biome configs.
- Root `biome.jsonc` extends Ultracite's `core`, `type-aware`, and `vitest` Biome presets (`ultracite/biome/core`, `ultracite/biome/type-aware`, `ultracite/biome/vitest`), then overrides only the repo-approved low-churn defaults.
- Do not add a duplicate `"**"` to `files.includes`; `ultracite/biome/core` already provides the catch-all, and strict Biome flags duplicate first exceptions.
- Type-aware/project-scanner Biome rules are part of the required gate for dependency declarations, private imports, JSON import attributes, import cycles, and deprecated imports. Import-extension rewriting is enabled, not disabled: `correctness.useImportExtensions` is set to `error` with the `ts -> js` / `tsx -> js` extension mappings so relative imports carry emitted-runtime `.js` specifiers, as required by this NodeNext package. `npm run typecheck` remains the semantic TypeScript type gate.
- Complexity remains enforced. Mature parser/planner/typegen/benchmark/doc-tooling files may use the documented 65-point migration cap in `biome.jsonc`; do not add new files to that cap without updating the Ultracite override-zone reference and tooling guard.
- `src/index.ts` is the only approved `noBarrelFile` exception because it is the package's public API entrypoint.
- Keep generated contract/artifact outputs, build output, dependency directories, virtualenvs, caches, and archived plans out of the Biome surface. Codemod-generated active source/docs and tracked HTML references remain governed by the normal Biome/Ultracite gates unless a specific generator documents otherwise.
- Biome does not own Markdown, MDX, YAML, or SQL. **Prettier** owns Markdown/MDX/YAML (`npm run format:md`), while SQL is governed by supaschema's parser/deparser/model checks and `postgres-language-server`, not a standalone formatter. `docs/` MDX is additionally validated by `npm run docs:lint` + `mint validate` (Rules 02/03). See Rule 06 for the full per-language owner map; do not point Biome at these surfaces.
- Local Biome suppression comments are forbidden. Investigate the related upstream rule, fix the code, or adjust the shared `biome.jsonc` policy with a repo-wide rationale.
- Do not add a second Biome config that drifts from the root policy without first creating a deliberate shared-config design and updating this rule.
- When adding a governed root file or expanding the lint surface, run `npm run format` as the only write/fix path so new JSON/MJS/config surfaces are formatted before `npm run lint` reaches them. During agent work, invoke Biome/Ultracite only through npm scripts; do not run direct `ultracite`, `biome`, or formatter subcommands, do not run `npm run lint fix`, and do not add or run formatter aliases such as `npm run lint:fix`.
- Do not reintroduce ESLint as a parallel JS/TS gate.

## Enforced by

- `npm run lint`.
- `npm run lint:doctor`.
- `npm run guard` (`scripts/guards/check-all.mjs`).
- `scripts/guards/check-tooling-stack.mjs` (pins `@biomejs/biome` and `ultracite`, asserts the extends presets, the `useImportExtensions` mappings, the `src/index.ts` barrel exception, the 65-point complexity cap file list, and that no Biome rule is disabled outside the approved override zone).

STOP if a second Biome config appears without a shared policy, if ESLint returns as a parallel lint surface, if a local suppression comment is introduced, if generated contract/build/dependency artifacts become part of the lint surface, if codemod-generated active source stops passing the normal lint/format gates, if a formatter write/fix entry point other than `npm run format` is added, or if a JS/TS formatter or linter is added that competes with Biome.

## Verification

When Biome, Ultracite, lint surface, config overrides, generated exclusions, or JS/TS formatting changes, run:

```bash
npm run format
npm run lint
npm run lint:doctor
npm run guard
```

Use `npm run lint:ci` for CI-equivalent formatting/lint proof.

## Failure behavior

Fix source or shared config; do not add inline suppressions, local duplicate Biome configs, ESLint, or competing formatters. If an override is necessary, make it narrow and document the rationale.

## Done means

Biome/Ultracite config is single-source, generated/build surfaces are excluded, source is formatted/lint-clean, and no competing JS/TS lint surface exists.
