---
description: One-command version bump, changelog, release-surface parity, git staging, commit, push, and PR discipline.
paths:
  - "package.json"
  - "package-lock.json"
  - "CHANGELOG.md"
  - "action.yml"
  - ".github/workflows/release.yml"
  - "scripts/release/changelog-notes.mjs"
  - "scripts/release/preflight.mjs"
  - "scripts/guards/check-release-version-surfaces.mjs"
  - "scripts/guards/check-all.mjs"
  - "AGENTS.md"
---

# Rule 19 — Version control and release

## Contract

This rule owns the operator workflow for version bumps, release notes, and release-control git work. When a user says to update supaschema to a version, that is one release-version transaction: update every version-coupled surface, prove parity with the guard, then stage, commit, push, or open the PR when requested. Do not ask the user to enumerate these steps.

Rules 09, 13, 14, and 18 remain the owners for CI posture, package contents, git safety, and generated-surface sync. This rule connects those owners into the version bump path.

## Release-note owner

`CHANGELOG.md` is the canonical release-note owner for npm and GitHub releases. The top entry for `package.json` `version` must be `## <version> (YYYY-MM-DD)` and must contain non-empty, user-readable notes. `scripts/release/changelog-notes.mjs` extracts that entry for GitHub Release creation; do not use GitHub auto-generated release notes as the published release body.

Changesets may collect PR-local release intent and may drive `npm run release:version`, but after versioning the generated top `CHANGELOG.md` entry is the source of truth. If `CHANGELOG.md`, GitHub Release notes, npm version, package metadata, or `action.yml` disagree, fix the canonical release transaction before publishing or repairing a release.

## Version bump transaction

When asked to create or update to version `<version>`, do all of this in the same change:

1. Inspect `git status --short --branch` and preserve unrelated dirty work.
2. Update `package.json` and `package-lock.json` together. Prefer `npm version <version> --no-git-tag-version` unless both files already carry the requested version.
3. Add or update the top `CHANGELOG.md` entry as `## <version> (YYYY-MM-DD)` with concise, source-grounded release notes.
4. Update `action.yml` so `inputs.version.default` equals `<version>` and the exact-version example in the validation message uses `<version>`.
5. Search for other version-coupled release surfaces introduced by the change and update them in the same commit.
6. Run `npm run release:notes -- --version <version>` to inspect the release body that GitHub will publish.
7. Run `npm run guard:release-version` before broader release or package checks.

A version bump that only changes `package.json` and `package-lock.json` is incomplete.

## Git and PR transaction

When the user asks to stage, commit, push, or create a PR after a version bump:

- Stage only task-owned hunks after reviewing `git diff`.
- Use a release-specific commit message such as `Prepare release <version>` or `Enforce release version surfaces`.
- Let local hooks run. Do not use `--no-verify`.
- Push the current branch without force-push unless the user explicitly approved a destructive branch operation.
- When asked for a PR, create a non-draft PR unless the user explicitly says draft. Include the version, changelog, release-surface parity, and verification commands in the PR body.
- If CI fails on a version-coupled surface, fix the source drift and add or update guard coverage so the same miss fails locally next time.

## Enforced by

- `npm run guard:release-version` (`scripts/guards/check-release-version-surfaces.mjs`) asserts that:
  - `package.json`, `package-lock.json`, and the lockfile root package version agree;
  - the first `CHANGELOG.md` version heading matches the package version, uses an ISO date, and contains release notes;
  - `action.yml` pins the same exact package version as its default;
  - the action validation message tells users to use an exact npm version and shows the current version.
- `scripts/release/preflight.mjs` repeats the package, lockfile, and changelog release-note checks before the release workflow decides whether to publish npm or repair GitHub Release state.
- `.github/workflows/release.yml` creates GitHub Releases with `--notes-file` from `scripts/release/changelog-notes.mjs`, not `--generate-notes`.
- `npm run guard` runs `guard:release-version` through `scripts/guards/check-all.mjs`.
- `tests/action.test.ts` verifies the composite action default follows `package.json` and does not drift to npm dist-tags.
- Rule 09 release workflow checks, Rule 13 package checks, Rule 14 git safety, and Rule 18 generated-surface sync remain required where their surfaces are touched.

STOP if a version bump leaves any known release surface on the previous version, uses an npm dist-tag for the GitHub Action default, omits the changelog top entry, publishes a GitHub Release body from auto-generated notes instead of `CHANGELOG.md`, commits generated mirrors without syncing from the canonical owner, bypasses hooks, or weakens a guard/test to make the release pass.

## Verification

For every version bump, run:

```bash
npm run guard:release-version
npm run release:notes -- --version <version>
npm test -- tests/action.test.ts
```

For package or release workflow changes, also run:

```bash
npm run release:verify
npm run check:package
npm run pack:dry
npm run guard
```

For rule or generated agent-surface changes, also run:

```bash
npm run sync:llm
npm run sync:llm:check
```

## Failure behavior

Fix the drift in the canonical source. Do not remove action version pinning, loosen the exact-version validation, skip the changelog, bypass hooks, or patch generated mirrors directly.

## Done means

All version-coupled surfaces agree with the package version, the changelog top entry names that version and is the GitHub Release body source, local release-version guards pass, and requested git/PR actions are completed without touching unrelated work.
