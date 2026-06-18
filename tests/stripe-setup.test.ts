import { describe, expect, it } from "vitest";
import {
  createStripeCatalog,
  main,
  recommendedCatalog,
  stripePriceMap,
} from "../scripts/stripe/create-catalog.mjs";
import { parsePlanCatalog } from "../services/license-worker/src/checkout.js";

function okResponse(payload: unknown) {
  return {
    json: () => Promise.resolve(payload),
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
  };
}

describe("Stripe catalog setup (M31)", () => {
  it("recommends the roadmap prices with an annual option", () => {
    const catalog = recommendedCatalog();
    expect(catalog.map((plan) => plan.amount)).toEqual([4900, 4900, 9900, 9900]);
    expect(catalog.map((plan) => plan.plan)).toEqual([
      "type-contract",
      "grant-drift",
      "bundle",
      "annual",
    ]);
    expect(catalog.some((plan) => plan.recurringInterval === "year")).toBe(true);
  });

  it("creates a product then a price per plan, with the recurring interval", async () => {
    const calls: { body: string; url: string }[] = [];
    let count = 0;
    const fetchImpl = (url: string, init: RequestInit) => {
      calls.push({ body: String(init.body ?? ""), url });
      if (init.method === "GET") {
        return Promise.resolve(okResponse({ data: [], has_more: false }));
      }
      count += 1;
      return Promise.resolve(okResponse({ id: `id_${count}` }));
    };
    const created = await createStripeCatalog(fetchImpl, "sk_test_fake", [
      {
        amount: 9900,
        currency: "usd",
        metadata: { pack: "bundle", plan: "annual" },
        mode: "subscription",
        name: "supaschema pack bundle annual",
        plan: "annual",
        recurringInterval: "year",
      },
    ]);
    expect(created).toEqual([
      { mode: "subscription", plan: "annual", priceId: "id_2", productId: "id_1" },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.stripe.com/v1/products?active=true&limit=100",
      "https://api.stripe.com/v1/products",
      "https://api.stripe.com/v1/prices?active=true&limit=100&product=id_1",
      "https://api.stripe.com/v1/prices",
    ]);
    expect(calls[3]?.body).toContain("recurring%5Binterval%5D=year");
    expect(stripePriceMap(created)).toEqual({
      annual: { mode: "subscription", price: "id_2" },
    });
  });

  it("emits a Worker-parseable price map for every recommended plan", () => {
    const created = recommendedCatalog().map((plan) => ({
      mode: plan.mode,
      plan: plan.plan,
      priceId: `price_${plan.plan.replaceAll("-", "_")}`,
      productId: `prod_${plan.plan.replaceAll("-", "_")}`,
    }));
    const parsed = parsePlanCatalog(JSON.stringify(stripePriceMap(created)));
    expect([...parsed.keys()]).toEqual(["type-contract", "grant-drift", "bundle", "annual"]);
    expect(parsed.get("bundle")).toEqual({ mode: "payment", price: "price_bundle" });
    expect(parsed.get("annual")).toEqual({ mode: "subscription", price: "price_annual" });
  });

  it("reuses an existing matching product and price", async () => {
    const calls: { body: string; url: string }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      calls.push({ body: String(init.body ?? ""), url });
      if (url.includes("/products?")) {
        return Promise.resolve(
          okResponse({ data: [{ id: "prod_existing", name: "supaschema pack bundle" }] })
        );
      }
      if (url.includes("/prices?")) {
        return Promise.resolve(
          okResponse({
            data: [{ currency: "usd", id: "price_existing", unit_amount: 9900 }],
          })
        );
      }
      return Promise.reject(new Error("unexpected mutation"));
    };
    const created = await createStripeCatalog(fetchImpl, "sk_test_fake", [
      {
        amount: 9900,
        currency: "usd",
        metadata: { pack: "bundle", plan: "bundle" },
        mode: "payment",
        name: "supaschema pack bundle",
        plan: "bundle",
      },
    ]);
    expect(created).toEqual([
      { mode: "payment", plan: "bundle", priceId: "price_existing", productId: "prod_existing" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("fails closed on a non-2xx Stripe response", async () => {
    const fetchImpl = () =>
      Promise.resolve({
        json: () => Promise.resolve({}),
        ok: false,
        status: 401,
        text: () => Promise.resolve("invalid key"),
      });
    await expect(createStripeCatalog(fetchImpl, "sk_bad", recommendedCatalog())).rejects.toThrow(
      "401"
    );
  });

  it("requires explicit operator approval before catalog mutation", async () => {
    const fetchImpl = () => Promise.reject(new Error("fetch not expected"));
    await expect(main({ STRIPE_SECRET_KEY: "sk_test_fake" }, fetchImpl)).rejects.toThrow(
      "STRIPE_CATALOG_APPROVED=1"
    );
  });

  it("requires a second approval before live catalog mutation", async () => {
    const fetchImpl = () => Promise.reject(new Error("fetch not expected"));
    await expect(
      main({ STRIPE_CATALOG_APPROVED: "1", STRIPE_SECRET_KEY: "sk_live_fake" }, fetchImpl)
    ).rejects.toThrow("STRIPE_LIVE_APPROVED=1");
  });
});
