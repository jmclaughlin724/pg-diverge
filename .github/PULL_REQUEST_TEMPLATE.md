<!--
Thanks for contributing to supaschema! Please read CONTRIBUTING.md first.
Keep this PR focused; unrelated changes make review and revert harder.
-->

## Summary

What this PR changes and why. Link any related issue (`Closes #123`).

## Type of change

- [ ] Bug fix (no behavior change for valid input)
- [ ] New DDL coverage / planner or renderer change (rendered SQL changes)
- [ ] CLI / library API change
- [ ] Docs only
- [ ] Build / CI / tooling / agent-surface change

## Checklist

- [ ] `npm run check` passes (lint + test + build; build type-checks via `noEmitOnError`).
- [ ] PR review comments and failing checks were verified against upstream/canonical sources and resolved only when each correction was committed.
- [ ] `npm run typecheck` passes (or is covered by the pre-push hook).
- [ ] Source changes live in `src/**`; `dist/**` is not hand-edited.
- [ ] No generated migration (`.sql` containing `-- supaschema: lineage`) was hand-edited.
- [ ] SQL semantics go through the AST / model (`libpg-query`), not ad hoc regex.
- [ ] ESM preserved; maintainer toolchain stays npm-only (`package-lock.json` intact; no repo-root pnpm/Yarn/Bun lockfile outside package-smoke temp projects).
- [ ] Tests added or updated; snapshot changes are intentional and explained below.
- [ ] Docs updated for any user-facing flag/config/diagnostic change (`npm run docs:check` if `docs/**` touched).
- [ ] Config changes keep `supaschema-config.schema.json`, docs, and examples aligned.
- [ ] A `.changeset/` entry is included for any user-facing change (run `npm run changeset`).
- [ ] If this is a release PR, the release checklist in `docs/release.mdx` is complete.
- [ ] For PR merges, `npm run github:audit-settings` passes and GitHub squash merge is used.

## Rendered SQL / snapshot changes

If this changes generated migration output, paste a before/after of the rendered SQL (or the affected snapshot diff) and explain why it's correct.
