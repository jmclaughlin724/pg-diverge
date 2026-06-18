import { createPublicKey, verify } from "node:crypto";

export interface LicenseClaims {
  exp: number;
  plan: string;

  repo: string;
}

interface LicenseHeader {
  alg: "EdDSA";
  typ: "JWT";
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
  return (
    typeof Reflect.get(value, "exp") === "number" &&
    typeof Reflect.get(value, "plan") === "string" &&
    typeof Reflect.get(value, "repo") === "string"
  );
}

function isLicenseHeader(value: unknown): value is LicenseHeader {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Reflect.get(value, "alg") === "EdDSA" && Reflect.get(value, "typ") === "JWT";
}

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
    const header: unknown = JSON.parse(base64UrlToBuffer(headerPart).toString("utf8"));
    if (!isLicenseHeader(header)) {
      return null;
    }
    const publicKey = createPublicKey(publicKeyPem);

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

export function isEntitledFromEnv(
  env: Record<string, string | undefined>,
  nowSeconds: number
): boolean {
  const token = env.SUPASCHEMA_LICENSE;
  const repo = env.GITHUB_REPOSITORY;
  if (token === undefined || repo === undefined) {
    return false;
  }
  return isEntitled(verifyLicenseToken(token, TRUSTED_LICENSE_PUBLIC_KEY_PEM), repo, nowSeconds);
}
