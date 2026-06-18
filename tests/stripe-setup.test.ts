import { describe, expect, it } from "vitest";
import type { StripeFetch, StripeResponse } from "../services/license-worker/src/stripe-api.js";
import {
  createStripeCatalog,
  recommendedCatalog,
} from "../services/license-worker/src/stripe-setup.js";

function okResponse(id: string): StripeResponse {
  return {
    json: () => Promise.resolve({ id }),
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
  };
}

describe("Stripe catalog setup (M31)", () => {
  it("recommends the roadmap prices with an annual option", () => {
    const catalog = recommendedCatalog();
    expect(catalog.map((plan) => plan.priceUsdCents)).toEqual([4900, 4900, 9900, 9900]);
    expect(catalog.some((plan) => plan.recurring === "year")).toBe(true);
  });

  it("creates a product then a price per plan, with the recurring interval", async () => {
    const calls: { body: string; url: string }[] = [];
    let count = 0;
    const fetchImpl: StripeFetch = (url, init) => {
      calls.push({ body: init.body, url });
      count += 1;
      return Promise.resolve(okResponse(`id_${count}`));
    };
    const created = await createStripeCatalog(fetchImpl, "sk_test_fake", [
      { metadata: { pack: "bundle" }, name: "bundle", priceUsdCents: 9900, recurring: "year" },
    ]);
    expect(created).toEqual([{ name: "bundle", priceId: "id_2", productId: "id_1" }]);
    expect(calls[0]?.url).toContain("/products");
    expect(calls[1]?.url).toContain("/prices");
    expect(calls[1]?.body).toContain("recurring%5Binterval%5D=year");
  });

  it("fails closed on a non-2xx Stripe response", async () => {
    const fetchImpl: StripeFetch = () =>
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
});
