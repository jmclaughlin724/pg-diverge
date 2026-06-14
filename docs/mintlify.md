---
title: "Docs site"
description: "How to preview, validate, and publish the Mintlify documentation site for supaschema."
---

This repository is configured as a Mintlify docs-as-code site in monorepo mode: the documentation content root is the `docs/` directory, with site configuration in `docs/docs.json`. Everything inside `docs/` is a page or an asset.

The site is served under the `/docs` subpath of the custom domain, so a page file maps to a URL by dropping the `.mdx` and prefixing `/docs` — `docs/commands/diff.mdx` serves at `https://supaschema.com/docs/commands/diff`. Inside the docs, link with root-relative paths (`/commands/diff`); Mintlify applies the `/docs` host prefix automatically.

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
2. In **Git settings**, turn on the **`docs.json` is in a subdirectory** toggle (Mintlify's monorepo setting) and set **Path to directory containing `docs.json`** to `/docs`. Save changes. Without this, the build looks for `docs.json` at the repository root — which does not exist — and the deploy fails.
3. In **Domain setup**, keep **Host at `/docs`** enabled so the site is served under the `/docs` subpath of `supaschema.com`.
4. Enable pull request preview deployments and keep the Mintlify GitHub App installed so pushes deploy automatically.

Because the content root is `docs/`, the rest of the repository (source code, tests, fixtures, package metadata, agent instructions) is never scanned; `docs/.mintignore` only needs to exclude stray non-content files.

## Cloudflare custom domain

The repository includes a Cloudflare Worker (`cloudflare/mintlify-docs-worker.js`) that proxies the whole custom domain to the Mintlify-hosted origin at `https://supaschema.mintlify.dev`, preserving the request path and rewriting redirect `Location` headers from the origin back to the custom host:

```js
const DOCS_URL = "supaschema.mintlify.dev";
const CUSTOM_URL = "supaschema.com";
```

Every request is proxied to the origin except `/.well-known/*` (passed through for domain verification), and `www.supaschema.com` is permanently redirected to the apex. The `/docs` subpath itself comes from Mintlify's **Host at `/docs`** setting, not from the Worker: Mintlify serves pages under `/docs` and redirects the apex (`/`) to `/docs/introduction`, so `supaschema.com` lands on `supaschema.com/docs/introduction`.

Deploy it with Wrangler after authenticating Cloudflare:

```bash
npx wrangler deploy
```

The Worker is configured by `wrangler.toml` as the Cloudflare Custom Domain target for both `supaschema.com` and `www.supaschema.com`. Keep the Mintlify dashboard in monorepo mode (the **`docs.json` is in a subdirectory** toggle, path `/docs`) with **Host at `/docs`** enabled, so the live site and the GitHub preview/deployment checks read the same content root that local validation uses.
