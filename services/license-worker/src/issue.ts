import { createPublicKey, type KeyObject, sign, verify } from "node:crypto";

export interface LicenseClaims {
  exp: number;
  plan: string;

  repo: string;
}

interface LicenseHeader {
  alg: "EdDSA";
  typ: "JWT";
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBuffer(part: string): Buffer {
  return Buffer.from(part.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function isLicenseClaims(value: unknown): value is LicenseClaims {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "exp") === "number" &&
    typeof Reflect.get(value, "plan") === "string" &&
    typeof Reflect.get(value, "repo") === "string"
  );
}

function isLicenseHeader(value: unknown): value is LicenseHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "alg") === "EdDSA" &&
    Reflect.get(value, "typ") === "JWT"
  );
}

export function issueLicenseToken(claims: LicenseClaims, privateKey: KeyObject): string {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64Url(Buffer.from(JSON.stringify(claims)));
  const signature = base64Url(sign(null, Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${signature}`;
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
  try {
    const header: unknown = JSON.parse(base64UrlToBuffer(headerPart).toString("utf8"));
    if (!isLicenseHeader(header)) {
      return null;
    }
    const publicKey = createPublicKey(publicKeyPem);
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`${headerPart}.${payloadPart}`),
        publicKey,
        base64UrlToBuffer(signaturePart)
      )
    ) {
      return null;
    }
    const payload: unknown = JSON.parse(base64UrlToBuffer(payloadPart).toString("utf8"));
    return isLicenseClaims(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function canonicalRepo(repo: string): string {
  return repo.toLowerCase();
}

export function isEntitled(
  claims: LicenseClaims | null,
  repo: string,
  nowSeconds: number
): boolean {
  return (
    claims !== null && canonicalRepo(claims.repo) === canonicalRepo(repo) && claims.exp > nowSeconds
  );
}

export function licenseClaimsFor(repo: string, plan: string, nowSeconds: number): LicenseClaims {
  const oneYear = 365 * 24 * 60 * 60;
  return { exp: nowSeconds + oneYear, plan, repo: canonicalRepo(repo) };
}
