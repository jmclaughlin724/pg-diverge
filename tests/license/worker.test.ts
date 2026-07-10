import { execFileSync } from "node:child_process";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hasLicenseWorkerSources = [
  "services/license-worker/src/index.js",
  "services/license-worker/src/issue.js",
  "services/license-worker/src/store.js",
  "services/license-worker/src/webhook.js",
].every((file) => existsSync(resolve(file)));
let extractCheckoutCompletion: any;
let handleLicenseWorker: any;
let issueLicenseToken: any;
let licenseClaimsFor: any;
let createMemoryStore: any;
let verifyStripeSignature: any;
let isEntitled: any;
let verifyLicenseToken: any;

function optionalImport(specifier: string): Promise<any> {
  return import(specifier);
}

if (hasLicenseWorkerSources) {
  ({ extractCheckoutCompletion, handleLicenseWorker } = await optionalImport(
    "../../services/license-worker/src/index.js"
  ));
  ({ issueLicenseToken, licenseClaimsFor } = await optionalImport(
    "../../services/license-worker/src/issue.js"
  ));
  ({ createMemoryStore } = await optionalImport("../../services/license-worker/src/store.js"));
  ({ verifyStripeSignature } = await optionalImport(
    "../../services/license-worker/src/webhook.js"
  ));
  ({ isEntitled, verifyLicenseToken } = await optionalImport("../../src/license.js"));
}

const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const SECRET = "whsec_test_only_not_a_real_secret";
const NOW = 1_700_000_000;
const PRICE_MAP = JSON.stringify({
  annual: { mode: "subscription", price: "price_annual" },
  bundle: { mode: "payment", price: "price_bundle" },
});

const noFetch = () => Promise.reject(new Error("stripe fetch not expected"));

function jsonRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
}

function recordingStripe(sessionUrl: string): {
  calls: Array<{ body: string; url: string }>;
  fetch: any;
} {
  const calls: Array<{ body: string; url: string }> = [];
  const fetch = (url: string, init: { body: string }) => {
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

const failingStripe = () =>
  Promise.resolve({
    json: () => Promise.resolve({}),
    ok: false,
    status: 402,
    text: () => Promise.resolve("payment required"),
  });

function stripeSignature(rawBody: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function stripeSignatureHeader(rawBody: string, secret: string, timestamp: number): string {
  const signature = stripeSignature(rawBody, secret, timestamp);
  return `t=${timestamp},v1=${signature}`;
}

function checkoutEvent(
  repo: string,
  plan: string,
  sessionId: string,
  options: { paymentStatus?: string; type?: string } = {}
): string {
  return JSON.stringify({
    data: {
      object: {
        id: sessionId,
        metadata: { plan, repo },
        payment_status: options.paymentStatus ?? "paid",
      },
    },
    type: options.type ?? "checkout.session.completed",
  });
}

function memoryStores() {
  return { contracts: createMemoryStore(), licenses: createMemoryStore() };
}

function envWith(stores: { contracts: unknown; licenses: unknown }) {
  return {
    CHECKOUT_CANCEL_URL: "https://supaschema.com/pricing",
    CHECKOUT_SUCCESS_URL: "https://supaschema.com/license",
    CONTRACT_KV: stores.contracts,
    LICENSE_KV: stores.licenses,
    STRIPE_PRICE_MAP: PRICE_MAP,
    STRIPE_SECRET_KEY: "rk_test_only_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: SECRET,
    SUPASCHEMA_LICENSE_PRIVATE_KEY: privateKeyPem,
  };
}

const usersTable = {
  columns: [{ name: "id", notNull: true, type: "number" }],
  name: "users",
  relationships: [],
  uniqueColumnSets: [],
};

function contract(tables: unknown[]) {
  return { schemas: { public: { enums: [], tables } } };
}

function registryLicense(repo = "acme/app"): string {
  return issueLicenseToken(licenseClaimsFor(repo, "bundle", NOW), keyPair.privateKey);
}

function registryRequest(
  method: string,
  body?: unknown,
  repo = "acme/app",
  license = registryLicense(repo)
): Request {
  const url = `https://license.example/contracts?repo=${encodeURIComponent(repo)}&name=main`;
  return new Request(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${license}`, "content-type": "application/json" },
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

function taploCli(): string {
  return resolve("node_modules", "@taplo", "cli", "dist", "cli.js");
}

function wranglerConfig(): Record<string, unknown> {
  return jsonRecord(
    execFileSync(process.execPath, [
      taploCli(),
      "get",
      "-f",
      "services/license-worker/wrangler.toml",
      "-o",
      "json",
    ]).toString("utf8")
  );
}

describe.skipIf(!hasLicenseWorkerSources)(
  "license issuance ↔ verification round-trip (M30)",
  () => {
    it("issues a token the CLI verify-side accepts and entitles", () => {
      const token = issueLicenseToken(
        licenseClaimsFor("acme/app", "bundle", NOW),
        keyPair.privateKey
      );
      const claims = verifyLicenseToken(token, publicKeyPem);
      expect(claims?.repo).toBe("acme/app");
      expect(isEntitled(claims, "acme/app", NOW)).toBe(true);
    });
  }
);

describe.skipIf(!hasLicenseWorkerSources)("license Worker deployment config (M30/X51)", () => {
  it("declares the Worker entrypoint, automatic KV bindings, and required secrets", () => {
    const config = wranglerConfig();
    expect(config.name).toBe("supaschema-license-worker");
    expect(config.main).toBe("src/index.ts");
    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(config.secrets).toEqual({
      required: [
        "STRIPE_PRICE_MAP",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "SUPASCHEMA_LICENSE_PRIVATE_KEY",
      ],
    });
    expect(config.kv_namespaces).toEqual([{ binding: "CONTRACT_KV" }, { binding: "LICENSE_KV" }]);
    expect(config.vars).toEqual({
      CHECKOUT_CANCEL_URL: "https://supaschema.com/pricing",
      CHECKOUT_SUCCESS_URL: "https://supaschema.com/license",
    });
  });
});

describe.skipIf(!hasLicenseWorkerSources)("Stripe webhook signature (M30)", () => {
  it("accepts a correctly signed body", () => {
    const body = checkoutEvent("acme/app", "bundle", "cs_test_sig");
    expect(verifyStripeSignature(body, stripeSignatureHeader(body, SECRET, NOW), SECRET, NOW)).toBe(
      true
    );
  });

  it("accepts a matching rotated signature that is not the last v1 value", () => {
    const body = checkoutEvent("acme/app", "bundle", "cs_test_sig_rotation");
    const matching = stripeSignature(body, SECRET, NOW);
    const stale = stripeSignature(body, "whsec_previous_secret", NOW);
    expect(verifyStripeSignature(body, `t=${NOW},v1=${matching},v1=${stale}`, SECRET, NOW)).toBe(
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

describe.skipIf(!hasLicenseWorkerSources)("license Worker end-to-end (M30/M31)", () => {
  it("fails closed when deployment configuration is incomplete", async () => {
    const stores = memoryStores();
    const env = { ...envWith(stores), STRIPE_PRICE_MAP: "{}" };

    const response = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=unknown"),
      env,
      stores,
      NOW,
      noFetch
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("worker misconfigured");
  });

  it("fails closed when the signing key is not an Ed25519 private key", async () => {
    const stores = memoryStores();
    const env = { ...envWith(stores), SUPASCHEMA_LICENSE_PRIVATE_KEY: "invalid" };

    const response = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=unknown"),
      env,
      stores,
      NOW,
      noFetch
    );

    expect(response.status).toBe(500);
  });

  it("fails closed when required KV bindings are missing", async () => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=unknown"),
      envWith(stores),
      {
        contracts: stores.contracts,
      },
      NOW,
      noFetch
    );

    expect(response.status).toBe(500);
  });

  it("mints + stores on verified checkout, retrievable by session_id and CLI-valid", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    const webhook = await handleLicenseWorker(
      signedWebhook(checkoutEvent("acme/app", "bundle", "cs_test_abc")),
      env,
      stores,
      NOW,
      noFetch
    );
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({ issued: true });

    const retrieval = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=cs_test_abc"),
      env,
      stores,
      NOW,
      noFetch
    );
    expect(retrieval.status).toBe(200);
    const retrievalBody = await retrieval.json();
    const license = typeof retrievalBody.license === "string" ? retrievalBody.license : "";
    expect(isEntitled(verifyLicenseToken(license, publicKeyPem), "acme/app", NOW)).toBe(true);
  });

  it("is idempotent on a webhook retry (no second mint)", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    const body = checkoutEvent("acme/app", "bundle", "cs_test_dup");
    await handleLicenseWorker(signedWebhook(body), env, stores, NOW, noFetch);
    const first = await stores.licenses.get("cs_test_dup");
    const retry = await handleLicenseWorker(signedWebhook(body), env, stores, NOW, noFetch);
    expect(await retry.json()).toMatchObject({ idempotent: true });
    expect(await stores.licenses.get("cs_test_dup")).toBe(first);
  });

  it("does not mint for an unpaid completed Checkout Session", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    const sessionId = "cs_test_unpaid";
    const body = checkoutEvent("acme/app", "bundle", sessionId, { paymentStatus: "unpaid" });

    const response = await handleLicenseWorker(signedWebhook(body), env, stores, NOW, noFetch);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(await stores.licenses.get(sessionId)).toBeNull();
  });

  it("mints after a delayed Checkout payment succeeds", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    const sessionId = "cs_test_async_paid";
    const body = checkoutEvent("acme/app", "bundle", sessionId, {
      type: "checkout.session.async_payment_succeeded",
    });

    const response = await handleLicenseWorker(signedWebhook(body), env, stores, NOW, noFetch);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ issued: true });
    expect(await stores.licenses.get(sessionId)).not.toBeNull();
  });

  it("rejects an unsigned webhook", async () => {
    const stores = memoryStores();
    const request = new Request("https://license.example/webhook", {
      body: checkoutEvent("acme/app", "bundle", "cs_test_x"),
      method: "POST",
    });
    const response = await handleLicenseWorker(request, envWith(stores), stores, NOW, noFetch);
    expect(response.status).toBe(400);
  });

  it("returns pending 404 for an unknown session_id", async () => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      new Request("https://license.example/license?session_id=unknown"),
      envWith(stores),
      stores,
      NOW,
      noFetch
    );
    expect(response.status).toBe(404);
  });

  it("ignores non-checkout events", () => {
    expect(extractCheckoutCompletion({ type: "invoice.paid" })).toBeNull();
  });
});

describe.skipIf(!hasLicenseWorkerSources)("self-serve checkout (M31)", () => {
  function checkout(repo: string, plan: string, stripeFetch: any): Promise<Response> {
    const stores = memoryStores();
    const url = `https://license.example/checkout?repo=${encodeURIComponent(repo)}&plan=${plan}`;
    return handleLicenseWorker(new Request(url), envWith(stores), stores, NOW, stripeFetch);
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

describe.skipIf(!hasLicenseWorkerSources)("contract registry Worker routes (X51)", () => {
  it("stores and retrieves an authenticated schema contract", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    const stored = await handleLicenseWorker(
      registryRequest("PUT", contract([usersTable])),
      env,
      stores,
      NOW,
      noFetch
    );
    expect(stored.status).toBe(200);

    const retrieved = await handleLicenseWorker(registryRequest("GET"), env, stores, NOW, noFetch);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual(contract([usersTable]));
  });

  it("deletes an authenticated schema contract", async () => {
    const stores = memoryStores();
    const env = envWith(stores);
    await handleLicenseWorker(
      registryRequest("PUT", contract([usersTable])),
      env,
      stores,
      NOW,
      noFetch
    );

    const deleted = await handleLicenseWorker(registryRequest("DELETE"), env, stores, NOW, noFetch);
    expect(deleted.status).toBe(200);

    const retrieved = await handleLicenseWorker(registryRequest("GET"), env, stores, NOW, noFetch);
    expect(retrieved.status).toBe(404);
  });

  it("rejects unauthenticated registry writes", async () => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      new Request("https://license.example/contracts?repo=acme/app&name=main", {
        body: JSON.stringify(contract([usersTable])),
        method: "PUT",
      }),
      envWith(stores),
      stores,
      NOW,
      noFetch
    );
    expect(response.status).toBe(401);
  });

  it("rejects registry writes when the license belongs to another repo", async () => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      registryRequest("PUT", contract([usersTable]), "acme/app", registryLicense("other/repo")),
      envWith(stores),
      stores,
      NOW,
      noFetch
    );
    expect(response.status).toBe(401);
  });

  it("rejects payloads outside the contract shape before storage", async () => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      registryRequest("PUT", { schemas: { public: { enums: [], tables: [] } }, token: "abc123" }),
      envWith(stores),
      stores,
      NOW,
      noFetch
    );
    expect(response.status).toBe(400);
  });

  it.each([
    {
      name: "column",
      table: { ...usersTable, columns: [null] },
    },
    {
      name: "relationship",
      table: { ...usersTable, relationships: [null] },
    },
    {
      name: "unique column set",
      table: { ...usersTable, uniqueColumnSets: [null] },
    },
  ])("rejects malformed nested $name entries", async ({ table }) => {
    const stores = memoryStores();
    const response = await handleLicenseWorker(
      registryRequest("PUT", contract([table])),
      envWith(stores),
      stores,
      NOW,
      noFetch
    );

    expect(response.status).toBe(400);
  });
});
