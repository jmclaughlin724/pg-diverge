# scripts/docs-lint/ — docs standard modules

Canonical CLI and internal modules for the docs authoring standard linter. `check-standard.mjs` owns the executable route and the sole programmatic entry, `lintDocsStandard`.

## Contents

- `check-standard.mjs` — `npm run docs:lint` CLI and lint orchestration
- `page.mjs` — Markdown/MDX parsing and page-level inspection
- `frontmatter.mjs` — YAML frontmatter validation
- `components.mjs` — Mintlify component, card, callout, and image inspection
- `links.mjs` — internal-link classification and image-source validation
- `paths.mjs` — docs path and route helpers (`routeForDocFile`, `hasMarkdownExtension`, `isDigit`)
- `docs-json.mjs` — `docs.json` shape, contextual options, and navigation inspection
- `local-runner.mjs` — npm-as-local-runner convention checks across install/setup surfaces

## Owners

- Mintlify writing and component standards: `.claude/rules/02-*.md`, `.claude/rules/03-*.md`
- Verify: `npm run docs:check`, `tests/docs/standard.test.ts`
