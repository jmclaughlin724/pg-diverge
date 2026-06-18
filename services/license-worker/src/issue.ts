import { type KeyObject, sign } from "node:crypto";

export interface LicenseClaims {
  exp: number;
  plan: string;

  repo: string;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function issueLicenseToken(claims: LicenseClaims, privateKey: KeyObject): string {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64Url(Buffer.from(JSON.stringify(claims)));
  const signature = base64Url(sign(null, Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${signature}`;
}

export function licenseClaimsFor(repo: string, plan: string, nowSeconds: number): LicenseClaims {
  const oneYear = 365 * 24 * 60 * 60;
  return { exp: nowSeconds + oneYear, plan, repo };
}
