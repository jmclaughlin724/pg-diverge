import { type KeyObject, sign } from "node:crypto";

/**
 * License token issuance (plan `20-hands-off-stack.md`, task M30 — issuance side).
 *
 * Produces the exact token shape the CLI verify-side (`src/license.ts`
 * `verifyLicenseToken`) accepts: `base64url(header).base64url(payload).base64url(sig)`
 * where the signature is Ed25519 over `header.payload`. Signing here uses
 * `node:crypto` `sign(null, …)`, the inverse of the verify-side's `verify(null, …)`,
 * so a round-trip test proves the full loop. The deployable Cloudflare Worker
 * (`index.ts`) calls this with the private key loaded from a secret binding; the
 * private key and the account are the operator's and never live in the repo.
 */

export interface LicenseClaims {
  /** Expiry, unix seconds. */
  exp: number;
  plan: string;
  /** `owner/repo` the license is bound to. */
  repo: string;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Sign an Ed25519 license token for the given claims. */
export function issueLicenseToken(claims: LicenseClaims, privateKey: KeyObject): string {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64Url(Buffer.from(JSON.stringify(claims)));
  const signature = base64Url(sign(null, Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${signature}`;
}

/** Build claims for a paid checkout: bind to the repo, set a 1-year expiry. */
export function licenseClaimsFor(repo: string, plan: string, nowSeconds: number): LicenseClaims {
  const oneYear = 365 * 24 * 60 * 60;
  return { exp: nowSeconds + oneYear, plan, repo };
}
