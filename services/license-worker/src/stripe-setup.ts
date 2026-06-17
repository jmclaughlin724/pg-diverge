/**
 * Stripe product/price setup (plan `20-hands-off-stack.md`, task M31). Idempotent-ish
 * automation that creates the paid-pack products and prices through the Stripe REST
 * API. The transport is injected, so the catalog logic is testable without a Stripe
 * account or network; production passes real `fetch` and a restricted secret key
 * read from env (never argv, never the repo). Prices here are the **recommended**
 * defaults from the roadmap ($49 per pack / $99 bundle) and must be confirmed by the
 * operator before this runs — pricing is a human decision, not a code default.
 */

export interface StripePlan {
  /** Product metadata (e.g. which pack it unlocks). */
  metadata: Record<string, string>;
  /** Stripe product name. */
  name: string;
  /** Price in USD cents. */
  priceUsdCents: number;
  /** `"year"` for an annual recurring price; omit for a one-time price. */
  recurring?: "year";
}

export interface StripeResponse {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type StripeFetch = (
  url: string,
  init: { body: string; headers: Record<string, string>; method: string }
) => Promise<StripeResponse>;

/** Recommended catalog from the roadmap. Confirm prices before creating them live. */
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

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("unexpected Stripe response shape");
  }
  return value as Record<string, unknown>;
}

async function stripePost(
  fetchImpl: StripeFetch,
  secretKey: string,
  path: string,
  form: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    body: new URLSearchParams(form).toString(),
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  // Check status before parsing the body (Rule 15: fail closed on non-2xx).
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${await response.text()}`);
  }
  return asObject(await response.json());
}

export interface CreatedPlan {
  name: string;
  priceId: string;
  productId: string;
}

/** Create each plan as a Stripe product + price. Returns the created identifiers. */
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
