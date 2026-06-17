# supaschema license worker (M30 issuance)

Cloudflare Worker that mints repo-bound Ed25519 license tokens on a verified Stripe `checkout.session.completed` webhook. The CLI verifies those tokens locally (`src/license.ts`) — there is no per-run server call.

This is the **issuance** half of M30. The signing/verification logic and the full Stripe-webhook → token → CLI-verify loop are implemented and tested (`tests/license-worker.test.ts`, 7 tests). What remains is **operator deployment**, which needs accounts and secrets that must not live in the repo.

## Code map

- `src/issue.ts` — `issueLicenseToken` (Ed25519, `node:crypto` `sign(null, …)`, the exact inverse of the CLI's `verifyLicenseToken`) and `licenseClaimsFor`.
- `src/webhook.ts` — `verifyStripeSignature` (raw-body HMAC-SHA256, replay window, constant-time compare).
- `src/index.ts` — the Worker handler: verify signature → parse event → mint a token.

## Deployment handoff (operator)

1. Generate the signing keypair (keep the private key secret):
   ```bash
   openssl genpkey -algorithm ed25519 -out license_private.pem
   openssl pkey -in license_private.pem -pubout -out license_public.pem
   ```
2. Embed `license_public.pem` in the CLI's `TRUSTED_LICENSE_PUBLIC_KEY_PEM` constant before issuing production tokens. The CLI must not read the public key from runtime env.
3. Set the Worker secrets (never committed):
   ```bash
   wrangler secret put SUPASCHEMA_LICENSE_PRIVATE_KEY   # paste license_private.pem
   wrangler secret put STRIPE_WEBHOOK_SECRET            # whsec_... from the Stripe dashboard
   ```
4. `wrangler deploy`, then add the Worker URL as a Stripe webhook endpoint for `checkout.session.completed`.
5. On the Checkout Session, set `metadata.repo` (`owner/repo`) and `metadata.plan`; the Worker binds the issued license to that repo.

Provisioning the Cloudflare account, the Stripe account, and the signing key is the operator's responsibility — this repo intentionally contains none of them.
