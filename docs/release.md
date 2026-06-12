---
title: "Release"
description: "Release and trusted publishing checklist for the supaschema npm package."
---

# Release

The package is designed for npm trusted publishing from GitHub Actions.

1. Create the public GitHub repository.
2. Add the npm trusted publisher for the repository and release workflow.
3. Push a tag or publish a GitHub release.
4. Confirm CI passes lint, typecheck, tests, fixture diff, fixture verification, the corpus oracle (`npm run corpus:check`, dirty-real reconvergence), source-tree, dump, catalog-snapshot, large, live-catalog, shadow-round-trip, and replay-verification benchmarks, `npm pack`, global tarball install, and `npx` tarball smoke.
5. Stamp the release date on the `0.1.0 (unreleased)` CHANGELOG heading in the release commit.

The release workflow uses:

- `permissions.id-token: write`
- `actions/setup-node` with `registry-url: https://registry.npmjs.org`
- `npm publish --access public`

With npm trusted publishing, provenance is generated through the GitHub Actions OIDC trust relationship, so no long-lived npm token is required.

Do not publish from a laptop for production releases.
