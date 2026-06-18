import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractCheckoutCompletion,
  handleLicenseWorker,
  type LicenseWorkerEnv,
} from "../services/license-worker/src/index.js";
import { issueLicenseToken, licenseClaimsFor } from "../services/license-worker/src/issue.js";
import { createMemoryStore } from "../services/license-worker/src/store.js";
import type { StripeFetch } from "../services/license-worker/src/stripe-api.js";
import { verifyStripeSignature } from "../services/license-worker/src/webhook.js";
import { isEntitled, verifyLicenseToken } from "../src/license.js";
import type { TableShape } from "../src/typegen-model.js";

const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const SECRET = "whsec_test_only_not_a_real_secret";
const NOW = 1_700_000_000;
const PRICE_MAP = JSON.stringify({
  annual: { mode: "subscription", price: "price_annual" },
  bundle: { mode: "payment", price: "price_bundle" },
});

const noFetch: StripeFetch = () => Promise.reject(new Error("stripe fetch not expected"));

function recordingStripe(sessionUrl: string): {
  calls: Array<{ body: string; url: string }>;
  fetch: StripeFetch;
} {
  const calls: Array<{ body: string; url: string }> = [];
  const fetch: StripeFetch = (url, init) => {
    calls.push({ body: init.body, url });
    return Promise.resolve({
      json: () => Promise.resolve({ url: sessionUrl }),
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });
  };
  return { calls, fetch };
}

const failingStripe: StripeFetch = () =>
  Promise.resolve({
    json: () => Promise.resolve({}),
    ok: false,
    status: 402,
    text: () => Promise.resolve("payment required"),
  });

function stripeSignatureHeader(rawBody: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function checkoutEvent(repo: string, plan: string, sessionId: string): string {
  return JSON.stringify({
    data: { object: { id: sessionId, metadata: { plan, repo } } },
    type: "checkout.session.completed",
  });
}

function envWith(store: LicenseWorkerEnv["LICENSE_KV"]): LicenseWorkerEnv {
  return {
    CHECKOUT_CANCEL_URL: "https://supaschema.com/pricing",
    CHECKOUT_SUCCESS_URL: "https://supaschema.com/license",
    CONTRACT_REGISTRY_TOKEN: "registry_token",
    LICENSE_KV: store,
    STRIPE_PRICE_MAP: PRICE_MAP,
    STRIPE_SECRET_KEY: "rk_test_only_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: SECRET,
    SUPASCHEMA_LICENSE_PRIVATE_KEY: privateKeyPem,
  };
}

const usersTable: TableShape = {
  columns: [{ name: "id", notNull: true, type: "number" }],
  name: "users",
  relationships: [],
  uniqueColumnSets: [],
};

function contract(tables: TableShape[]) {
  return { schemas: { public: { enums: [], tables } } };
}

function registryRequest(method: string, body?: unknown): Request {
  return new Request("https://license.example/contracts?repo=acme/app&name=main", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: "Bearer registry_token", "content-type": "application/json" },
    method,
  });
}

function signedWebhook(body: string): Request {
  return new Request("https://license.example/webhook", {
    body,
    headers: { "stripe-signature": stripeSignatureHeader(body, SECRET, NOW) },
    method: "POST",
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
    expect(isEntitled(claims, "acme/app", NOW)).toBe(true);
  });
});

describe("Stripe webhook signature (M30)", () => {
  it("accepts a correctly signed body", () => {
    const body = checkoutEvent("acme/app", "bundle", "cs_test_sig");
    expect(verifyStripeSignature(body, stripeSignatureHeader(body, SECRET, NOW), SECRET, NOW)).toBe(
      true
    );
  });

  it("rejects a tampered body", () => {
    const header = stripeSignatureHeader(checkoutEvent("acme/app", "bundle", "cs_a"), SECRET, NOW);
    const tampered = checkoutEvent("evil/repo", "bundle", "cs_a");
    expect(verifyStripeSignature(tampered, header, SECRET, NOW)).toBe(false);
  });

  it("rejects an out-of-window timestamp (replay)", () => {
    const body = checkoutEvent("acme/app", "bundle", "cs_b");
    const stale = stripeSignatureHeader(body, SECRET, NOW - 10_000);
    expect(verifyStripeSignature(body, stale, SECRET, NOW)).toBe(false);
  });
});

describe("license Worker end-to-end (M30/M31)", () => {
  it("mints + stores on verified checkout, retrievable by session_id and CLI-valid", async () => {
    const store = createMemoryStore();
    const env = envWith(store);
    const webhook = await handleLicenseWorker(
      signedWebhook(checkoutEvent("acme/app", "bundle", "cs_test_abc")),
      env,
      store,
      NOW,
      noFetch
    );
    expect(webhook.status).toBe(200);
    expect(((await webhook.json()) as { issued: boolean }).issued).toBe(true);

    const retrieval = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=cs_test_abc"),
      env,
      store,
      NOW,
      noFetch
    );
    expect(retrieval.status).toBe(200);
    const { license } = (await retrieval.json()) as { license: string };
    expect(isEntitled(verifyLicenseToken(license, publicKeyPem), "acme/app", NOW)).toBe(true);
  });

  it("is idempotent on a webhook retry (no second mint)", async () => {
    const store = createMemoryStore();
    const env = envWith(store);
    const body = checkoutEvent("acme/app", "bundle", "cs_test_dup");
    await handleLicenseWorker(signedWebhook(body), env, store, NOW, noFetch);
    const first = await store.get("cs_test_dup");
    const retry = await handleLicenseWorker(signedWebhook(body), env, store, NOW, noFetch);
    expect(((await retry.json()) as { idempotent?: boolean }).idempotent).toBe(true);
    expect(await store.get("cs_test_dup")).toBe(first);
  });

  it("rejects an unsigned webhook", async () => {
    const store = createMemoryStore();
    const request = new Request("https://license.example/webhook", {
      body: checkoutEvent("acme/app", "bundle", "cs_test_x"),
      method: "POST",
    });
    const response = await handleLicenseWorker(request, envWith(store), store, NOW, noFetch);
    expect(response.status).toBe(400);
  });

  it("returns pending 404 for an unknown session_id", async () => {
    const store = createMemoryStore();
    const response = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=unknown"),
      envWith(store),
      store,
      NOW,
      noFetch
    );
    expect(response.status).toBe(404);
  });

  it("ignores non-checkout events", () => {
    expect(extractCheckoutCompletion({ type: "invoice.paid" })).toBeNull();
  });
});

describe("self-serve checkout (M31)", () => {
  function checkout(repo: string, plan: string, stripeFetch: StripeFetch): Promise<Response> {
    const store = createMemoryStore();
    const url = `https://license.example/checkout?repo=${encodeURIComponent(repo)}&plan=${plan}`;
    return handleLicenseWorker(new Request(url), envWith(store), store, NOW, stripeFetch);
  }

  it("creates a repo-bound session and 302-redirects to its hosted url", async () => {
    const stripe = recordingStripe("https://checkout.stripe.com/c/pay/cs_test_redirect");
    const response = await checkout("acme/app", "bundle", stripe.fetch);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_redirect"
    );
    expect(stripe.calls[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions");

    const sent = new URLSearchParams(stripe.calls[0]?.body);
    expect(sent.get("metadata[repo]")).toBe("acme/app");
    expect(sent.get("metadata[plan]")).toBe("bundle");
    expect(sent.get("line_items[0][price]")).toBe("price_bundle");
    expect(sent.get("mode")).toBe("payment");

    expect(sent.has("payment_method_types")).toBe(false);

    expect(sent.get("success_url")).toContain("{CHECKOUT_SESSION_ID}");
  });

  it("uses subscription mode for the annual plan", async () => {
    const stripe = recordingStripe("https://checkout.stripe.com/c/pay/cs_annual");
    await checkout("acme/app", "annual", stripe.fetch);
    expect(new URLSearchParams(stripe.calls[0]?.body).get("mode")).toBe("subscription");
  });

  it("rejects an invalid repo slug before reaching Stripe", async () => {
    const response = await checkout("not-a-slug", "bundle", noFetch);
    expect(response.status).toBe(400);
  });

  it("404s an unknown plan before reaching Stripe", async () => {
    const response = await checkout("acme/app", "ghost", noFetch);
    expect(response.status).toBe(404);
  });

  it("fails closed with 502 when Stripe rejects the request", async () => {
    const response = await checkout("acme/app", "bundle", failingStripe);
    expect(response.status).toBe(502);
  });
});

describe("contract registry Worker routes (X51)", () => {
  it("stores and retrieves an authenticated schema contract", async () => {
    const store = createMemoryStore();
    const env = envWith(store);
    const stored = await handleLicenseWorker(
      registryRequest("PUT", contract([usersTable])),
      env,
      store,
      NOW,
      noFetch
    );
    expect(stored.status).toBe(200);

    const retrieved = await handleLicenseWorker(registryRequest("GET"), env, store, NOW, noFetch);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual(contract([usersTable]));
  });

  it("rejects unauthenticated registry writes", async () => {
    const store = createMemoryStore();
    const response = await handleLicenseWorker(
      new Request("https://license.example/contracts?repo=acme/app&name=main", {
        body: JSON.stringify(contract([usersTable])),
        method: "PUT",
      }),
      envWith(store),
      store,
      NOW,
      noFetch
    );
    expect(response.status).toBe(401);
  });

  it("rejects payloads outside the contract shape before storage", async () => {
    const store = createMemoryStore();
    const response = await handleLicenseWorker(
      registryRequest("PUT", { schemas: { public: { enums: [], tables: [] } }, token: "abc123" }),
      envWith(store),
      store,
      NOW,
      noFetch
    );
    expect(response.status).toBe(400);
  });
});
