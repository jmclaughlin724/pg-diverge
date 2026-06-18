import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isEntitled,
  isEntitledFromEnv,
  isEntitledFromEnvWithTrustedKey,
  type LicenseClaims,
  verifyLicenseToken,
} from "../src/license.js";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function makeToken(
  claims: LicenseClaims,
  privateKey: KeyObject,
  headerInput: unknown = { alg: "EdDSA", typ: "JWT" }
): string {
  const header = base64Url(Buffer.from(JSON.stringify(headerInput)));
  const payload = base64Url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = base64Url(sign(null, Buffer.from(signingInput), privateKey));
  return `${signingInput}.${signature}`;
}

const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const NOW = 1_000_000;
const validClaims: LicenseClaims = { exp: NOW + 100, plan: "bundle", repo: "acme/app" };

describe("license entitlement (M30/M32 verify side)", () => {
  it("verifies a well-formed token and returns claims", () => {
    const claims = verifyLicenseToken(makeToken(validClaims, keyPair.privateKey), publicKeyPem);
    expect(claims?.repo).toBe("acme/app");
    expect(claims?.plan).toBe("bundle");
  });

  it("rejects a tampered payload", () => {
    const token = makeToken(validClaims, keyPair.privateKey);
    const [header, , signature] = token.split(".");
    const forged = base64Url(
      Buffer.from(JSON.stringify({ exp: NOW + 100, plan: "bundle", repo: "evil/repo" }))
    );
    expect(verifyLicenseToken(`${header}.${forged}.${signature}`, publicKeyPem)).toBeNull();
  });

  it("rejects a non-Ed25519 (RSA) public key — algorithm-confusion defense", () => {
    const rsaPublicKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ format: "pem", type: "spki" })
      .toString();
    const token = makeToken(validClaims, keyPair.privateKey);
    expect(verifyLicenseToken(token, rsaPublicKeyPem)).toBeNull();
  });

  it("rejects a signed token with a non-EdDSA header", () => {
    const token = makeToken(validClaims, keyPair.privateKey, { alg: "HS256", typ: "JWT" });
    expect(verifyLicenseToken(token, publicKeyPem)).toBeNull();
  });

  it("rejects a signed token with a non-JWT header", () => {
    const token = makeToken(validClaims, keyPair.privateKey, { alg: "EdDSA", typ: "JWS" });
    expect(verifyLicenseToken(token, publicKeyPem)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyLicenseToken("not-a-token", publicKeyPem)).toBeNull();
  });

  it("entitles a valid, unexpired, repo-matching token", () => {
    const claims = verifyLicenseToken(makeToken(validClaims, keyPair.privateKey), publicKeyPem);
    expect(isEntitled(claims, "acme/app", NOW)).toBe(true);
  });

  it("denies an expired token", () => {
    const expired: LicenseClaims = { exp: NOW - 1, plan: "bundle", repo: "acme/app" };
    const claims = verifyLicenseToken(makeToken(expired, keyPair.privateKey), publicKeyPem);
    expect(isEntitled(claims, "acme/app", NOW)).toBe(false);
  });

  it("denies a repo mismatch", () => {
    const claims = verifyLicenseToken(makeToken(validClaims, keyPair.privateKey), publicKeyPem);
    expect(isEntitled(claims, "other/repo", NOW)).toBe(false);
  });
});

describe("env entitlement gate (M32)", () => {
  it("is entitled with a valid token signed by the trusted key and matching repo", () => {
    const env = {
      GITHUB_REPOSITORY: "acme/app",
      SUPASCHEMA_LICENSE: makeToken(validClaims, keyPair.privateKey),
    };
    expect(isEntitledFromEnvWithTrustedKey(env, NOW, publicKeyPem)).toBe(true);
  });

  it("ignores caller-provided public keys as trust anchors", () => {
    const env = {
      GITHUB_REPOSITORY: "acme/app",
      SUPASCHEMA_LICENSE: makeToken(validClaims, keyPair.privateKey),
      SUPASCHEMA_LICENSE_PUBLIC_KEY: publicKeyPem,
    };
    expect(isEntitledFromEnv(env, NOW)).toBe(false);
  });

  it("is not entitled when the token is missing", () => {
    const env = { GITHUB_REPOSITORY: "acme/app" };
    expect(isEntitledFromEnv(env, NOW)).toBe(false);
  });

  it("is not entitled on a repo mismatch", () => {
    const env = {
      GITHUB_REPOSITORY: "other/repo",
      SUPASCHEMA_LICENSE: makeToken(validClaims, keyPair.privateKey),
    };
    expect(isEntitledFromEnvWithTrustedKey(env, NOW, publicKeyPem)).toBe(false);
  });
});
