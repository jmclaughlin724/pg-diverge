import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractCheckoutCompletion,
  handleLicenseWebhook,
} from "../services/license-worker/src/index.js";
import { issueLicenseToken, licenseClaimsFor } from "../services/license-worker/src/issue.js";
import { verifyStripeSignature } from "../services/license-worker/src/webhook.js";
import { isEntitled, verifyLicenseToken } from "../src/license.js";

const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const SECRET = "whsec_test_only_not_a_real_secret";
const NOW = 1_700_000_000;

function stripeSignatureHeader(rawBody: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function checkoutEvent(repo: string, plan: string): string {
  return JSON.stringify({
    data: { object: { metadata: { plan, repo } } },
    type: "checkout.session.completed",
  });
}

describe("license issuance ↔ verification round-trip (M30)", () => {
  it("issues a token the CLI verify-side accepts and entitles", () => {
    const token = issueLicenseToken(
      licenseClaimsFor("acme/app", "bundle", NOW),
      keyPair.privateKey
    );
    const claims = verifyLicenseToken(token, publicKeyPem);
    expect(claims?.repo).toBe("acme/app");
    expect(claims?.plan).toBe("bundle");
    expect(isEntitled(claims, "acme/app", NOW)).toBe(true);
  });
});

describe("Stripe webhook signature (M30)", () => {
  it("accepts a correctly signed body", () => {
    const body = checkoutEvent("acme/app", "bundle");
    expect(verifyStripeSignature(body, stripeSignatureHeader(body, SECRET, NOW), SECRET, NOW)).toBe(
      true
    );
  });

  it("rejects a tampered body", () => {
    const header = stripeSignatureHeader(checkoutEvent("acme/app", "bundle"), SECRET, NOW);
    expect(verifyStripeSignature(checkoutEvent("evil/repo", "bundle"), header, SECRET, NOW)).toBe(
      false
    );
  });

  it("rejects an out-of-window timestamp (replay)", () => {
    const body = checkoutEvent("acme/app", "bundle");
    const stale = stripeSignatureHeader(body, SECRET, NOW - 10_000);
    expect(verifyStripeSignature(body, stale, SECRET, NOW)).toBe(false);
  });
});

describe("license Worker handler end-to-end (M30)", () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, SUPASCHEMA_LICENSE_PRIVATE_KEY: privateKeyPem };

  it("mints a repo-bound license on a verified checkout, accepted by the CLI", async () => {
    const body = checkoutEvent("acme/app", "bundle");
    const request = new Request("https://license.example/", {
      body,
      headers: { "stripe-signature": stripeSignatureHeader(body, SECRET, NOW) },
      method: "POST",
    });
    const response = await handleLicenseWebhook(request, env, NOW);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { license: string; repo: string };
    expect(payload.repo).toBe("acme/app");
    const claims = verifyLicenseToken(payload.license, publicKeyPem);
    expect(isEntitled(claims, "acme/app", NOW)).toBe(true);
  });

  it("rejects an unsigned request", async () => {
    const body = checkoutEvent("acme/app", "bundle");
    const request = new Request("https://license.example/", { body, method: "POST" });
    const response = await handleLicenseWebhook(request, env, NOW);
    expect(response.status).toBe(400);
  });

  it("ignores non-checkout events", () => {
    expect(extractCheckoutCompletion({ type: "invoice.paid" })).toBeNull();
  });
});
