import { createHmac, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { successUrlWithSessionId } from "../../services/license-worker/src/checkout.js";
import {
  handleLicenseWorker,
  type LicenseWorkerEnv,
} from "../../services/license-worker/src/index.js";
import {
  isEntitled,
  issueLicenseToken,
  licenseClaimsFor,
  verifyLicenseToken,
} from "../../services/license-worker/src/issue.js";
import { createMemoryStore } from "../../services/license-worker/src/store.js";

const webhookSecret = "whsec_test_secret";
const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

function testEnv(): LicenseWorkerEnv {
  return {
    CHECKOUT_CANCEL_URL: "https://supaschema.com/pricing",
    CHECKOUT_SUCCESS_URL: "https://supaschema.com/license",
    CONTRACT_KV: createMemoryStore(),
    GITHUB_OAUTH_CLIENT_ID: "github-oauth-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "github-oauth-client-secret",
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

const basilInvoicePaid: {
  api_version: string;
  data: { object: { parent: { subscription_details: { subscription: string } } } };
} = JSON.parse(
  readFileSync(new URL("./fixtures/invoice-paid.basil.json", import.meta.url), "utf8")
);

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
    expect(response.headers.get("cache-control")).toBe("no-store");

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

  it("rejects internal storage keys as license retrieval session ids", async () => {
    const env = testEnv();
    await env.LICENSE_KV.put(
      "subscription:sub_123",
      JSON.stringify({ plan: "pro", repo: "acme/app", sessionId: "cs_test_123" })
    );

    const response = await handleLicenseWorker(
      new Request("https://worker.test/license?session_id=subscription:sub_123"),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("invalid session_id");
  });

  it("stores contracts under the canonical repository casing", async () => {
    const env = testEnv();
    const token = issueLicenseToken(licenseClaimsFor("Acme/App", "pro", nowSeconds), privateKey);
    const put = await handleLicenseWorker(
      new Request("https://worker.test/contracts?repo=Acme/App&name=schema", {
        body: JSON.stringify({ schemas: {} }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    expect(await put.json()).toEqual({ stored: true });
    expect(await env.CONTRACT_KV.get("contract:acme/app:schema")).not.toBeNull();
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

  it("matches subscription token expiry to the plan's paid interval", async () => {
    const env = testEnv();
    env.STRIPE_PRICE_MAP = JSON.stringify({
      pro: { intervalDays: 30, mode: "subscription", price: "price_monthly" },
    });

    const completion = await handleLicenseWorker(
      signedWebhookRequest(
        completionEvent({
          metadata: { plan: "pro", repo: "acme/app" },
          subscription: "sub_monthly",
        }),
        nowSeconds
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    expect(await completion.json()).toEqual({ issued: true, repo: "acme/app" });

    const publicKeyPem = createPublicKey(privateKey)
      .export({ format: "pem", type: "spki" })
      .toString();
    const issued = await env.LICENSE_KV.get("cs_test_123");
    if (issued === null) {
      throw new Error("expected a minted token");
    }
    const claims = verifyLicenseToken(issued, publicKeyPem);
    expect(claims?.exp).toBe(nowSeconds + 30 * 24 * 60 * 60);

    await handleLicenseWorker(
      signedWebhookRequest(
        {
          data: {
            object: {
              billing_reason: "subscription_cycle",
              id: "in_renew_monthly",
              subscription: "sub_monthly",
            },
          },
          type: "invoice.paid",
        },
        nowSeconds
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );
    const renewed = await env.LICENSE_KV.get("cs_test_123");
    if (renewed === null) {
      throw new Error("expected a renewed token");
    }
    expect(verifyLicenseToken(renewed, publicKeyPem)?.exp).toBe(nowSeconds + 30 * 24 * 60 * 60);
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

  it("renews from the basil invoice parent subscription shape", async () => {
    expect(basilInvoicePaid.api_version).toBe("2025-03-31.basil");
    expect(basilInvoicePaid.data.object.parent.subscription_details.subscription).toBe("sub_123");
    const env = testEnv();
    await handleLicenseWorker(
      signedWebhookRequest(completionEvent({ subscription: "sub_123" }), nowSeconds),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    const renewal = await handleLicenseWorker(
      signedWebhookRequest(basilInvoicePaid, nowSeconds + 100),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds + 100,
      fakeFetch
    );
    expect(await renewal.json()).toEqual({ renewed: true, repo: "acme/app" });
  });
});

describe("github oauth checkout flow", () => {
  function oauthFetch(permission: string, stripeBodies: string[]): typeof fetch {
    return (input, init) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200 })
        );
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve(new Response(JSON.stringify({ login: "buyer" }), { status: 200 }));
      }
      if (url === "https://api.github.com/repos/acme/app/collaborators/buyer/permission") {
        return Promise.resolve(new Response(JSON.stringify({ permission }), { status: 200 }));
      }
      if (url === "https://api.stripe.com/v1/checkout/sessions") {
        stripeBodies.push(String(init?.body ?? ""));
        return Promise.resolve(
          new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test_new" }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
  }

  function stateToken(repo: string, plan: string): string {
    return issueLicenseToken({ exp: nowSeconds + 600, plan, repo }, privateKey);
  }

  it("redirects /checkout into GitHub OAuth with a signed state", async () => {
    const env = testEnv();
    const response = await handleLicenseWorker(
      new Request("https://license.workers.dev/checkout?repo=acme/app&plan=bundle"),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      fakeFetch
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("github-oauth-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://license.workers.dev/auth/github/callback"
    );
    const state = location.searchParams.get("state") ?? "";
    const claims = verifyLicenseToken(
      state,
      createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString()
    );
    expect(claims).toMatchObject({ plan: "bundle", repo: "acme/app" });
  });

  it("creates the Stripe session from the verified identity at the callback", async () => {
    const env = testEnv();
    const stripeBodies: string[] = [];
    const response = await handleLicenseWorker(
      new Request(
        `https://license.workers.dev/auth/github/callback?code=oauth-code&state=${stateToken("acme/app", "bundle")}`
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      oauthFetch("admin", stripeBodies)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_new");
    expect(stripeBodies).toHaveLength(1);
    expect(stripeBodies[0]).toContain("metadata%5Brepo%5D=acme%2Fapp");
    expect(stripeBodies[0]).toContain("metadata%5Bgithub_user%5D=buyer");
  });

  it("denies the callback without creating a Stripe session when permission is insufficient", async () => {
    const env = testEnv();
    const stripeBodies: string[] = [];
    const denied = await handleLicenseWorker(
      new Request(
        `https://license.workers.dev/auth/github/callback?code=oauth-code&state=${stateToken("acme/app", "bundle")}`
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      oauthFetch("none", stripeBodies)
    );
    expect(denied.status).toBe(403);
    expect(stripeBodies).toHaveLength(0);

    const tampered = await handleLicenseWorker(
      new Request(
        `https://license.workers.dev/auth/github/callback?code=oauth-code&state=${stateToken("acme/app", "bundle")}tampered`
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      oauthFetch("admin", stripeBodies)
    );
    expect(tampered.status).toBe(400);
    expect(stripeBodies).toHaveLength(0);
  });

  it("rejects a replayed state token and survives a non-JSON exchange response", async () => {
    const env = testEnv();
    const stripeBodies: string[] = [];
    const callbackUrl = `https://license.workers.dev/auth/github/callback?code=oauth-code&state=${stateToken("acme/app", "bundle")}`;

    const first = await handleLicenseWorker(
      new Request(callbackUrl),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      oauthFetch("admin", stripeBodies)
    );
    expect(first.status).toBe(302);
    expect(stripeBodies).toHaveLength(1);

    const replay = await handleLicenseWorker(
      new Request(callbackUrl),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds,
      oauthFetch("admin", stripeBodies)
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toBe("state already used");
    expect(stripeBodies).toHaveLength(1);

    const malformedFetch: typeof fetch = (input) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve(new Response("not json", { status: 200 }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    const malformed = await handleLicenseWorker(
      new Request(
        `https://license.workers.dev/auth/github/callback?code=other-code&state=${stateToken("acme/app", "pro")}`
      ),
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      nowSeconds + 100,
      malformedFetch
    );
    expect(malformed.status).toBe(502);
    expect(stripeBodies).toHaveLength(1);
  });
});
