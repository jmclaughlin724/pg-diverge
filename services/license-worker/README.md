# supaschema license worker (M30 / M31 / X51)

Cloudflare Worker for the hands-off monetization loop and hosted schema-contract registry. It creates repo-bound Stripe Checkout Sessions, mints repo-bound Ed25519 license tokens on a verified Stripe `checkout.session.completed` webhook, serves the minted token back to the buyer, and stores repo-bound schema contracts authenticated by that same license token. The CLI verifies license tokens locally (`src/license.ts`) -- there is no per-run server call.

The signing/verification logic and the full self-serve loop is implemented and tested (`tests/license-worker.test.ts`). What remains is operator deployment, which needs Cloudflare, Stripe, and signing-key state that must not live in the repo.

## Routes

- `GET /checkout?repo=acme/app&plan=bundle` creates a repo-bound Checkout Session and redirects to its hosted Stripe URL. The price and mode come from the operator `STRIPE_PRICE_MAP`, never the query, so a buyer cannot self-select a price. Dynamic payment methods are used; `payment_method_types` is never sent. The `success_url` carries `{CHECKOUT_SESSION_ID}` so the buyer lands on a page that can call `/license`.
- `GET /contracts?repo=acme/app&name=main` retrieves a schema contract when the request carries an unexpired repo-bound license token in `Authorization`.
- `PUT /contracts?repo=acme/app&name=main` stores a schema contract when the request carries an unexpired repo-bound license token in `Authorization`. The payload must match the `SchemaContract` JSON shape from `src/contract-registry.ts`; drift comparison remains in the package library through `contractDrift`.
- `DELETE /contracts?repo=acme/app&name=main` deletes a schema contract when the request carries an unexpired repo-bound license token in `Authorization`.
- `POST /webhook` verifies the Stripe signature over the raw body, then on `checkout.session.completed` mints a repo-bound token and stores it keyed by the Checkout session id. A Stripe retry returns the stored token, never a second mint.
- `GET /license?session_id=cs_test_123` lets the buyer retrieve their token after the success redirect, or returns `404 { "pending": true }` until the webhook has stored it. The token never returns to Stripe.

## Code map

- `src/issue.ts` - `issueLicenseToken` (Ed25519, `node:crypto` `sign(null, ...)`, the exact inverse of the CLI's `verifyLicenseToken`) and `licenseClaimsFor`.
- `src/webhook.ts` - `verifyStripeSignature` (raw-body HMAC-SHA256, replay window, constant-time compare).
- `src/stripe-api.ts` - Worker checkout Stripe REST POST transport.
- `src/checkout.ts` - `parsePlanCatalog` (operator `STRIPE_PRICE_MAP`), `createCheckoutSession`, `successUrlWithSessionId`.
- `src/store.ts` - `WorkerStore` interface (Cloudflare KV bindings satisfy it) and `createMemoryStore` for tests.
- `src/index.ts` - the Worker router (`handleLicenseWorker`) dispatching `/checkout`, `/contracts`, `/webhook`, `/license`; the default export injects the KV store and the global `fetch`.
- `scripts/stripe/create-catalog.mjs` - one-shot product/price catalog creation owner; it emits the `STRIPE_PRICE_MAP` JSON consumed by the Worker.

## Deployment Handoff

1. Generate the signing keypair (keep the private key secret):
   ```bash
   keydir="$(mktemp -d)"
   openssl genpkey -algorithm ed25519 -out "$keydir/supaschema_license_private.pem"
   openssl pkey -in "$keydir/supaschema_license_private.pem" -pubout -out "$keydir/supaschema_license_public.pem"
   cat "$keydir/supaschema_license_public.pem"
   ```
2. Embed the printed public key in the CLI's `TRUSTED_LICENSE_PUBLIC_KEY_PEM` constant before issuing production tokens. The CLI must not read the public key from runtime env.
3. Keep `services/license-worker/wrangler.toml` as the canonical Worker config. It declares `LICENSE_KV` and `CONTRACT_KV` without ids so Wrangler provisions the namespaces during deploy and writes the account-specific ids after provisioning.
4. Create the Stripe catalog with the approved prices:
   ```bash
   STRIPE_CATALOG_APPROVED=1 node scripts/stripe/create-catalog.mjs
   ```
5. Set the Worker secrets and deployment-specific plan map in Cloudflare:
   ```bash
   wrangler secret put SUPASCHEMA_LICENSE_PRIVATE_KEY < "$keydir/supaschema_license_private.pem"
   wrangler secret put STRIPE_WEBHOOK_SECRET
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_PRICE_MAP
   ```
6. Run `wrangler deploy`, then add the Worker `/webhook` URL as a Stripe webhook endpoint for `checkout.session.completed`.
7. Link buyers to `/checkout` with a repo and plan query; the Worker binds the issued license to that repo via `metadata.repo` and `metadata.plan`.

Provisioning the Cloudflare account, the Stripe account, the restricted key, and the signing key is the operator's responsibility. This repo intentionally contains none of them.
