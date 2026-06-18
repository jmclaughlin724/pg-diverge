# supaschema license worker (M30 / M31 / X51)

Cloudflare Worker for the hands-off monetization loop and hosted schema-contract registry. It creates repo-bound Stripe Checkout Sessions, mints repo-bound Ed25519 license tokens on a verified Stripe `checkout.session.completed` webhook, serves the minted token back to the buyer, and stores authenticated cross-repo schema contracts. The CLI verifies license tokens locally (`src/license.ts`) — there is no per-run server call.

The signing/verification logic and the full self-serve loop (checkout → webhook → mint+store → buyer retrieval → CLI verify) are implemented and tested (`tests/license-worker.test.ts`). What remains is **operator deployment**, which needs accounts and secrets that must not live in the repo.

## Routes

- `GET /checkout?repo=<owner/name>&plan=<plan>` — create a repo-bound Checkout Session and `302` to its hosted Stripe URL. The price and mode come from the operator `STRIPE_PRICE_MAP`, never the query, so a buyer cannot self-select a price; dynamic payment methods are used (`payment_method_types` is never sent). The `success_url` carries `{CHECKOUT_SESSION_ID}` so the buyer lands on a page that can call `/license`.
- `GET /contracts?repo=<owner/name>&name=<contract>` — retrieve an authenticated schema contract from KV.
- `PUT /contracts?repo=<owner/name>&name=<contract>` — store an authenticated schema contract in KV. The payload must match the `SchemaContract` JSON shape from `src/contract-registry.ts`; drift comparison remains in the package library through `contractDrift`.
- `POST /webhook` — verify the Stripe signature over the raw body, then on `checkout.session.completed` mint a repo-bound token and **store** it keyed by the Checkout session id. Idempotent: a Stripe retry returns the stored token, never a second mint.
- `GET /license?session_id=<id>` — the buyer retrieves their token after the success redirect (`{ "license": "…" }`), or `404 { "pending": true }` until the webhook has stored it. The token never returns to Stripe.

## Code map

- `src/issue.ts` — `issueLicenseToken` (Ed25519, `node:crypto` `sign(null, …)`, the exact inverse of the CLI's `verifyLicenseToken`) and `licenseClaimsFor`.
- `src/webhook.ts` — `verifyStripeSignature` (raw-body HMAC-SHA256, replay window, constant-time compare).
- `src/stripe-api.ts` — shared, fetch-injected, status-checked Stripe REST POST transport (used by checkout and catalog setup).
- `src/checkout.ts` — `parsePlanCatalog` (operator `STRIPE_PRICE_MAP`), `createCheckoutSession`, `successUrlWithSessionId`.
- `src/stripe-setup.ts` — one-shot product/price catalog creation helper (`recommendedCatalog`, `createStripeCatalog`).
- `src/store.ts` — `LicenseStore` interface (a Cloudflare KV binding satisfies it) and `createMemoryStore` for tests.
- `src/index.ts` — the Worker router (`handleLicenseWorker`) dispatching `/checkout`, `/contracts`, `/webhook`, `/license`; the default export injects the KV store and the global `fetch`.

## Deployment handoff (operator)

1. Generate the signing keypair (keep the private key secret):
   ```bash
   openssl genpkey -algorithm ed25519 -out license_private.pem
   openssl pkey -in license_private.pem -pubout -out license_public.pem
   ```
2. Embed `license_public.pem` in the CLI's `TRUSTED_LICENSE_PUBLIC_KEY_PEM` constant before issuing production tokens. The CLI must not read the public key from runtime env.
3. Create the KV namespace for stored tokens and paste its id into `wrangler.toml` (`[[kv_namespaces]]` `LICENSE_KV`):
   ```bash
   wrangler kv namespace create LICENSE_KV
   ```
4. Create the Stripe catalog (`scripts/stripe/create-catalog.py`, with your approved prices), then paste the live `price_…` ids into `STRIPE_PRICE_MAP` in `wrangler.toml` and set `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL`.
5. Set the Worker secrets (never committed):
   ```bash
   wrangler secret put SUPASCHEMA_LICENSE_PRIVATE_KEY   # paste license_private.pem
   wrangler secret put STRIPE_WEBHOOK_SECRET            # whsec_... from the Stripe dashboard
   wrangler secret put STRIPE_SECRET_KEY                # restricted key (rk_...), Checkout Sessions: write
   wrangler secret put CONTRACT_REGISTRY_TOKEN           # bearer token for /contracts reads and writes
   ```
6. `wrangler deploy`, then add the Worker `/webhook` URL as a Stripe webhook endpoint for `checkout.session.completed`.
7. Link buyers to `GET /checkout?repo=<owner/name>&plan=<plan>`; the Worker binds the issued license to that repo via `metadata.repo`/`metadata.plan`.

Provisioning the Cloudflare account, the Stripe account, the restricted key, and the signing key is the operator's responsibility — this repo intentionally contains none of them.
