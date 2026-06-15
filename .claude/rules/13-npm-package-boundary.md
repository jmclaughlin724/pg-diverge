# Rule 13 — npm package boundary

Sources:

- npm package `files`: <https://docs.npmjs.com/cli/v8/configuring-npm/package-json/#files>
- npm publish contents: <https://docs.npmjs.com/cli/v8/commands/npm-publish/#files-included-in-package>
- npm developer guide: <https://docs.npmjs.com/cli/v9/using-npm/developers/#keeping-files-out-of-your-package>

The published package is an explicit consumer surface. The repository also contains
maintainer-only tooling for developing supaschema itself. Keep those surfaces separate.

## Hard rules

- `package.json` `files` is the canonical npm package allowlist.
- Do not add a root `.npmignore` while `package.json` `files` owns the package boundary.
- Treat `npm pack --dry-run --json` as the authoritative preview of the published tarball.
- `postinstall` owns consumer setup after npm downloads the package. Do not confuse tarball contents with files written into the consuming project.
- Lifecycle scripts that run during `npm pack`/`npm ci`/`npm publish` (`prepare`, `preinstall`, `postinstall`) must not write to stdout. Gates parse that stdout — the `npm pack --silent` tarball name and `npm pack --json` (consumed by `tests/package-contents.test.ts` and `tests/database-url.test.ts`) — so any stray line breaks tarball-name capture and JSON parsing. Route install side-effects through a silent, CI-skipping helper (for example `scripts/install-hooks.mjs`, which `prepare` calls instead of running `lefthook install` directly); never let a hook installer or build step print to stdout from a lifecycle script.
- Consumer setup is the one-step install surface documented in `docs/introduction.mdx` and implemented by `postinstall`; do not maintain a second install-contents list in release or packaging references.
- Maintainer workspace surfaces stay repo-only unless the consumer contract explicitly changes. Examples include `.vscode`, `.mcp.json`, `.claude/cclsp.json`, Postgres Language Server config, Python/FastMCP support, Code Atlas, tests, guards, source files, CI support, and lint config.
- Generated and incremental build artifacts stay out of every allowlisted directory. A broad `files` entry like `dist` sweeps in everything beneath it, so write caches such as a `tsBuildInfoFile` to `.tmp/` (gitignored, not in `files`), never inside `dist/`. A `.tsbuildinfo` must never reach the published tarball.
- When adding, moving, or deleting a package or consumer install surface, update `docs/reference/package-boundary.mdx`, package tests, and tooling guards in the same change.

## Enforced by

- `npm run guard`.
- `npm run check:package`.
- `npm pack --dry-run --json`.
- `npx vitest run tests/editor-surfaces.test.ts tests/database-url.test.ts tests/package-contents.test.ts`.

STOP if root `.npmignore` is introduced, a maintainer-only support surface enters `package.json` `files`, a consumer agent surface is removed from the tarball, a `.tsbuildinfo` or other build cache appears in the dry-run tarball, a lifecycle script (`prepare`/`preinstall`/`postinstall`) writes to stdout and breaks `npm pack` tarball-name or `--json` parsing, or `postinstall` writes repo-only tooling into a consuming project without a documented contract change.
