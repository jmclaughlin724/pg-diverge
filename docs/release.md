---
title: "Release"
description: "Release and trusted publishing checklist for the supaschema npm package."
---

Use this checklist for an npm release.

The package is designed for trusted publishing from GitHub Actions.

1. Create the public GitHub repository.
2. Add the npm trusted publisher for the repository and release workflow.
3. Push a tag or publish a GitHub release.
4. Confirm CI passes all required checks.
5. Add a dated CHANGELOG section for the new version.
6. Bump the package version with `npm version <version> --no-git-tag-version`.

The GitHub release creates the tag. Do not let `npm version` create it.

## Required checks

- lint;
- typecheck;
- tests;
- fixture diff;
- fixture verification;
- corpus oracle with `npm run corpus:check`;
- source-tree, dump, catalog-snapshot, large, live-catalog, shadow-round-trip, and replay-verification benchmarks;
- `npm pack`;
- global tarball install;
- `npx` tarball smoke.

The release workflow uses:

- `permissions.id-token: write`
- `actions/setup-node` with `registry-url: https://registry.npmjs.org`
- `npm publish --access public`

With npm trusted publishing, provenance is generated through GitHub Actions OIDC.

No long-lived npm token is required.

Do not publish from a laptop for production releases.
