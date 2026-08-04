import type { KeyObject } from "node:crypto";
import { issueSignedToken, verifySignedToken } from "./signed-token.js";

const licenseTokenType = "SUPASCHEMA-LICENSE";

export interface LicenseClaims {
  exp: number;
  plan: string;

  purpose: "license";

  repo: string;
}

function isLicenseClaims(value: unknown): value is LicenseClaims {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "exp") === "number" &&
    typeof Reflect.get(value, "plan") === "string" &&
    Reflect.get(value, "purpose") === "license" &&
    typeof Reflect.get(value, "repo") === "string"
  );
}

export function issueLicenseToken(claims: LicenseClaims, privateKey: KeyObject): string {
  return issueSignedToken(licenseTokenType, claims, privateKey);
}

export function verifyLicenseToken(token: string, publicKeyPem: string): LicenseClaims | null {
  const payload = verifySignedToken(token, licenseTokenType, publicKeyPem);
  return isLicenseClaims(payload) ? payload : null;
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

export function licenseClaimsFor(
  repo: string,
  plan: string,
  nowSeconds: number,
  intervalDays = 365
): LicenseClaims {
  const secondsPerDay = 24 * 60 * 60;
  return {
    exp: nowSeconds + intervalDays * secondsPerDay,
    plan,
    purpose: "license",
    repo: canonicalRepo(repo),
  };
}

export function licenseClaimsThrough(
  repo: string,
  plan: string,
  paidThrough: number
): LicenseClaims {
  return {
    exp: paidThrough,
    plan,
    purpose: "license",
    repo: canonicalRepo(repo),
  };
}
