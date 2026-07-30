import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { successUrlWithSessionId } from "../../services/license-worker/src/checkout.js";
import {
  handleLicenseWorker,
  type LicenseWorkerEnv,
} from "../../services/license-worker/src/index.js";
import { isEntitled, licenseClaimsFor } from "../../services/license-worker/src/issue.js";
import { createMemoryStore } from "../../services/license-worker/src/store.js";

const webhookSecret = "whsec_test_secret";
const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

function testEnv(): LicenseWorkerEnv {
  return {
    CHECKOUT_CANCEL_URL: "https://supaschema.com/pricing",
    CHECKOUT_SUCCESS_URL: "https://supaschema.com/license",
    CONTRACT_KV: createMemoryStore(),
    LICENSE_KV: createMemoryStore(),
    STRIPE_PRICE_MAP: JSON.stringify({
      bundle: { mode: "payment", price: "price_payment" },
      pro: { mode: "subscription", price: "price_subscription" },
    }),
    STRIPE_SECRET_KEY: "sk_test_secret",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SUPASCHEMA_LICENSE_PRIVATE_KEY: privateKeyPem,
  };
}

function signedWebhookRequest(event: unknown, nowSeconds: number): Request {
  const rawBody = JSON.stringify(event);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${nowSeconds}.${rawBody}`)
    .digest("hex");
  return new Request("https://license.workers.dev/webhook", {
    body: rawBody,
    headers: { "stripe-signature": `t=${nowSeconds},v1=${signature}` },
    method: "POST",
  });
}

function completionEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      object: {
        id: "cs_test_123",
        metadata: { plan: "bundle", repo: "acme/app" },
        payment_status: "paid",
        ...overrides,
      },
    },
    type: "checkout.session.completed",
  };
}

const nowSeconds = 1_800_000_000;
const fakeFetch: typeof fetch = () =>
  Promise.reject(new Error("unexpected external fetch in test"));

describe("successUrlWithSessionId", () => {
  it("inserts the session query before any URL fragment", () => {
    expect(successUrlWithSessionId("https://example.com/license#status")).toBe(
      "https://example.com/license?session_id={CHECKOUT_SESSION_ID}#status"
    );
    expect(successUrlWithSessionId("https://example.com/license?ref=nav#status")).toBe(
      "https://example.com/license?ref=nav&session_id={CHECKOUT_SESSION_ID}#status"
    );
    expect(successUrlWithSessionId("https://example.com/license")).toBe(
      "https://example.com/license?session_id={CHECKOUT_SESSION_ID}"
    );
  });
});

describe("canonicalRepo entitlement", () => {
  it("matches GitHub repo identifiers case-insensitively", () => {
    const claims = licenseClaimsFor("Jmclaughlin724/Anilize", "pro", nowSeconds);
    expect(claims.repo).toBe("jmclaughlin724/anilize");
    expect(isEntitled(claims, "JMCLAUGHLIN724/ANILIZE", nowSeconds)).toBe(true);
    expect(isEntitled(claims, "jmclaughlin724/anilize", nowSeconds)).toBe(true);
    expect(isEntitled(claims, "jmclaughlin724/other", nowSeconds)).toBe(false);
  });
});

describe("license worker", () => {
  it("serves /license with CORS scoped to the success origin", async () => {
    const env = testEnv();
    const response = await handleLicenseWorker(
      new Request("https://license.workers.dev/license?session_id=cs_test_none"),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://supaschema.com");

    const preflight = await handleLicenseWorker(
      new Request("https://license.workers.dev/license", { method: "OPTIONS" }),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://supaschema.com");
  });

  it("issues on async_payment_succeeded and ignores unpaid completions", async () => {
    const env = testEnv();
    const unpaid = await handleLicenseWorker(
      signedWebhookRequest(
        {
          data: {
            object: {
              id: "cs_test_unpaid",
              metadata: { plan: "bundle", repo: "acme/app" },
              payment_status: "unpaid",
            },
          },
          type: "checkout.session.completed",
        },
        nowSeconds
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    expect(await unpaid.json()).toEqual({ ignored: true });
    expect(await env.LICENSE_KV.get("cs_test_unpaid")).toBeNull();

    const asyncPaid = await handleLicenseWorker(
      signedWebhookRequest(
        { ...completionEvent(), type: "checkout.session.async_payment_succeeded" },
        nowSeconds
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    expect(await asyncPaid.json()).toEqual({ issued: true, repo: "acme/app" });
    expect(await env.LICENSE_KV.get("cs_test_123")).not.toBeNull();
  });

  it("repairs a missing subscription mapping on a webhook retry", async () => {
    const env = testEnv();
    await env.LICENSE_KV.put("cs_test_123", "previously-minted-token");

    const response = await handleLicenseWorker(
      signedWebhookRequest(completionEvent({ subscription: "sub_123" }), nowSeconds),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    expect(await response.json()).toEqual({ idempotent: true, issued: true });
    const mapping = await env.LICENSE_KV.get("subscription:sub_123");
    if (mapping === null) {
      throw new Error("expected subscription mapping to be repaired");
    }
    expect(JSON.parse(mapping)).toMatchObject({
      plan: "bundle",
      repo: "acme/app",
      sessionId: "cs_test_123",
    });
  });

  it("renews a subscription token from invoice.paid under the original session id", async () => {
    const env = testEnv();
    const completion = await handleLicenseWorker(
      signedWebhookRequest(completionEvent({ subscription: "sub_123" }), nowSeconds),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    expect(await completion.json()).toEqual({ issued: true, repo: "acme/app" });
    const original = await env.LICENSE_KV.get("cs_test_123");
    expect(original).not.toBeNull();

    const unknown = await handleLicenseWorker(
      signedWebhookRequest(
        {
          data: {
            object: {
              billing_reason: "subscription_cycle",
              id: "in_unknown",
              subscription: "sub_other",
            },
          },
          type: "invoice.paid",
        },
        nowSeconds + 100
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds + 100,
      fakeFetch
    );
    expect(await unknown.json()).toEqual({ ignored: true });

    const renewal = await handleLicenseWorker(
      signedWebhookRequest(
        {
          data: {
            object: {
              billing_reason: "subscription_cycle",
              id: "in_123",
              subscription: "sub_123",
            },
          },
          type: "invoice.paid",
        },
        nowSeconds + 100
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds + 100,
      fakeFetch
    );
    expect(await renewal.json()).toEqual({ renewed: true, repo: "acme/app" });
    const renewed = await env.LICENSE_KV.get("cs_test_123");
    expect(renewed).not.toBeNull();
    expect(renewed).not.toBe(original);
  });
});
