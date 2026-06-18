import { type StripeFetch, stripePost } from "./stripe-api.js";

export interface StripePlan {
  metadata: Record<string, string>;

  name: string;

  priceUsdCents: number;

  recurring?: "year";
}

export function recommendedCatalog(): StripePlan[] {
  return [
    { metadata: { pack: "type-contract" }, name: "type-contract pack", priceUsdCents: 4900 },
    { metadata: { pack: "grant-drift" }, name: "grant-drift pack", priceUsdCents: 4900 },
    { metadata: { pack: "bundle" }, name: "pack bundle", priceUsdCents: 9900 },
    {
      metadata: { pack: "bundle" },
      name: "pack bundle annual",
      priceUsdCents: 9900,
      recurring: "year",
    },
  ];
}

export interface CreatedPlan {
  name: string;
  priceId: string;
  productId: string;
}

export async function createStripeCatalog(
  fetchImpl: StripeFetch,
  secretKey: string,
  catalog: StripePlan[]
): Promise<CreatedPlan[]> {
  const created: CreatedPlan[] = [];
  for (const plan of catalog) {
    const product = await stripePost(fetchImpl, secretKey, "products", {
      name: plan.name,
      ...Object.fromEntries(
        Object.entries(plan.metadata).map(([key, value]) => [`metadata[${key}]`, value])
      ),
    });
    if (typeof product.id !== "string" || product.id.length === 0) {
      throw new Error(`Stripe product create returned no id for "${plan.name}"`);
    }
    const productId = product.id;
    const priceForm: Record<string, string> = {
      currency: "usd",
      product: productId,
      unit_amount: String(plan.priceUsdCents),
    };
    if (plan.recurring !== undefined) {
      priceForm["recurring[interval]"] = plan.recurring;
    }
    const price = await stripePost(fetchImpl, secretKey, "prices", priceForm);
    if (typeof price.id !== "string" || price.id.length === 0) {
      throw new Error(`Stripe price create returned no id for "${plan.name}"`);
    }
    created.push({ name: plan.name, priceId: price.id, productId });
  }
  return created;
}
