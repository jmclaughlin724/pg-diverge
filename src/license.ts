import { createPublicKey, verify } from "node:crypto";

/**
 * License entitlement — verify side (plan `20-hands-off-stack.md`, tasks M30/M32).
 *
 * Verifies an Ed25519-signed license token against a public key embedded in the
 * CLI, with no per-run server call. This is the half that is codeable without
 * secrets: the issuance Worker (signs with the private key on a Stripe webhook) and
 * the Stripe/Cloudflare accounts are M30/M31 and remain blocked. The OSS CLI stays
 * free — only the paid packs / `--enforce` consult entitlement.
 */

export interface LicenseClaims {
  /** Expiry, unix seconds. */
  exp: number;
  plan: string;
  /** `owner/repo` the license is bound to. */
  repo: string;
}

export const TRUSTED_LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHQm8wOkw+0KwWtHORh56qzBqpwNj9lIY8RIZtleRil0=
-----END PUBLIC KEY-----`;

function base64UrlToBuffer(part: string): Buffer {
  return Buffer.from(part.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function isLicenseClaims(value: unknown): value is LicenseClaims {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.exp === "number" &&
    typeof record.plan === "string" &&
    typeof record.repo === "string"
  );
}

/** Verify the token's Ed25519 signature and shape; return claims or null. */
export function verifyLicenseToken(token: string, publicKeyPem: string): LicenseClaims | null {
  const parts = token.split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (
    parts.length !== 3 ||
    headerPart === undefined ||
    payloadPart === undefined ||
    signaturePart === undefined
  ) {
    return null;
  }
  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  let signatureValid = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    // Reject any non-Ed25519 key. `verify(null, ...)` selects the algorithm from
    // the key type, so without this a substituted RSA/ECDSA public key would let an
    // attacker who controls the key sign a token with the matching private key
    // (algorithm-confusion bypass). The issuer only ever signs with Ed25519.
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return null;
    }
    signatureValid = verify(null, signingInput, publicKey, base64UrlToBuffer(signaturePart));
  } catch {
    return null;
  }
  if (!signatureValid) {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(base64UrlToBuffer(payloadPart).toString("utf8"));
    return isLicenseClaims(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** True only when the token is valid, unexpired, and bound to this repo. */
export function isEntitled(
  claims: LicenseClaims | null,
  repo: string,
  nowSeconds: number
): boolean {
  if (claims === null) {
    return false;
  }
  return claims.repo === repo && claims.exp > nowSeconds;
}

/**
 * Resolve entitlement from the environment for the `--enforce` gate (task M32).
 * The token and bound repository are caller-provided, but the verifier trust
 * anchor is embedded in the CLI and not read from the caller environment.
 */
export function isEntitledFromEnv(
  env: Record<string, string | undefined>,
  nowSeconds: number
): boolean {
  return isEntitledFromEnvWithTrustedKey(env, nowSeconds, TRUSTED_LICENSE_PUBLIC_KEY_PEM);
}

export function isEntitledFromEnvWithTrustedKey(
  env: Record<string, string | undefined>,
  nowSeconds: number,
  trustedPublicKeyPem: string
): boolean {
  const token = env.SUPASCHEMA_LICENSE;
  const repo = env.GITHUB_REPOSITORY;
  if (token === undefined || repo === undefined) {
    return false;
  }
  return isEntitled(verifyLicenseToken(token, trustedPublicKeyPem), repo, nowSeconds);
}
