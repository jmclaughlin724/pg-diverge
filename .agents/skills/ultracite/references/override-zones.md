# Ultracite Override Zones

Biome override zones are defined in the root `biome.jsonc`. This repo does not use package-local Biome configs.

## Root Policy

| Scope | Relaxation | Rationale |
| --- | --- | --- |
| `dist/`, `coverage/`, `node_modules/`, `.venv/`, `.tmp/`, `.codeatlas/`, `.codeatlas-sa/`, `.wrangler/`, `api-docs/`, `benchmarks/results/`, `*.tgz`, `supaschema-config.schema.json` | formatter and linter excluded | Generated output, caches, virtualenvs, packaged archives, or generated contracts. |
| `.claude/skills/**` except bundled project skills | excluded, with selected bundled skills re-included | Prevent unrelated local Claude skill content from becoming part of the package lint surface. |
| Existing parser, planner, source-normalizer, typegen, benchmark, docs-lint, and Code Atlas baseline | `noExcessiveCognitiveComplexity` remains `error` with a 65-point migration cap on an explicit file list | Avoid behavior-changing refactors in mature SQL planning and verification code while still preventing complexity from growing unbounded. |
| `src/index.ts` | `noBarrelFile` disabled for this file only | This is the published package API entrypoint; consumers import from `supaschema`, not private source modules. |
| TypeScript relative import extensions | `useImportExtensions` enforced with emitted-runtime `.js` mappings | This NodeNext package imports sibling TypeScript source with emitted-runtime `.js` specifiers so `tsc` output runs correctly. |
| Vitest skipped-test rule | inherited from Ultracite/Vitest, no root disable | DB-gated suites may use `skipIf`; focused tests remain blocked. |
| Vitest focused-test rule | `noFocusedTests` remains `error` | Focused tests must never be committed. |

Do not add a duplicate `"**"` to `files.includes` while extending `ultracite/biome/core`; the Ultracite preset already provides the catch-all and strict Biome flags duplicate first exceptions. This is enforced by `npm run guard`.

## Global Project Scanner Scope

`ultracite/biome/type-aware` is enabled repo-wide for high-signal project rules around dependency declarations, private imports, JSON import attributes, import cycles, and deprecated imports.

## Notes

Fix source structurally first. If a rule is intentionally incompatible with a file-level contract, add the narrowest root `biome.jsonc` override, update this table, and extend `scripts/guards/check-tooling-stack.mjs` so the exception cannot silently expand.
