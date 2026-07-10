# scripts/docs-lint/ — docs standard modules

Internal modules for the docs authoring standard linter. The public entry is `scripts/check-docs-standard.mjs` (`npm run docs:lint`); these modules hold the inspectors.

## Contents

- `paths.mjs` — docs path and route helpers (`routeForDocFile`, `hasMarkdownExtension`, `isDigit`)
- `docs-json.mjs` — `docs.json` shape, contextual options, and navigation inspection
- `local-runner.mjs` — npm-as-local-runner convention checks across install/setup surfaces

## Owners

- Mintlify writing and component standards: `.claude/rules/02-*.md`, `.claude/rules/03-*.md`
- Verify: `npm run docs:check`, `tests/docs/standard.test.ts`
