---
title: "Docs site"
description: "How to preview, validate, and publish the Mintlify documentation site for supaschema."
---

# Docs site

This repository is configured as a Mintlify docs-as-code site in monorepo mode: the documentation content root is the `docs/` directory, with site configuration in `docs/docs.json`. Everything inside `docs/` is a page or an asset; page paths map to site URLs relative to `docs/` (so `docs/commands/diff.mdx` serves at `/commands/diff`).

## Local preview

Install dependencies and start the local Mintlify preview. The npm scripts use a pinned Mintlify CLI version through `npx`, so a global Mintlify install is optional.

```bash
npm ci
npm run docs:dev
```

The preview runs on port `3000` by default. Pass Mintlify CLI flags through npm when needed:

```bash
npm run docs:dev -- --port 3333
```

## Validation

Run the docs validation suite before opening a docs pull request:

```bash
npm run docs:check
```

The check validates the Mintlify project, broken links, anchors, and accessibility issues.

## Publishing

Connect the GitHub repository in the Mintlify dashboard:

1. Use production branch `main`.
2. In Git settings, enable the **Set up as monorepo** toggle and set the documentation path to `/docs` (no trailing slash).
3. Enable pull request preview deployments.
4. Keep the Mintlify GitHub App installed so pushes deploy automatically.

Because the content root is `docs/`, the rest of the repository (source code, tests, fixtures, package metadata, agent instructions) is never scanned; `docs/.mintignore` only needs to exclude stray non-content files.

## Cloudflare custom domain

The repository includes a Cloudflare Worker for routing `https://supaschema.com` to the Mintlify-hosted origin at `https://supaschema.mintlify.dev` while preserving the public custom host:

```js
const DOCS_URL = "supaschema.mintlify.dev";
const CUSTOM_URL = "supaschema.com";
```

Deploy it with Wrangler after authenticating Cloudflare:

```bash
npx wrangler deploy
```

The Worker is configured by `wrangler.toml` as the Cloudflare Custom Domain target for both `supaschema.com` and `www.supaschema.com`; `www` redirects permanently to the apex domain. Keep the Mintlify dashboard in monorepo mode with `/docs` as the documentation path so GitHub preview/deployment checks read the same content root that local validation uses.
