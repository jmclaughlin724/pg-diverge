import { type StripeFetch, stripePost } from "./stripe-api.js";

export interface PlanPrice {
  intervalDays?: number;

  mode: "payment" | "subscription";

  price: string;
}

export type PlanCatalog = ReadonlyMap<string, PlanPrice>;

export function parsePlanCatalog(raw: string): PlanCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error("STRIPE_PRICE_MAP is not valid JSON", { cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("STRIPE_PRICE_MAP must be a JSON object");
  }
  const catalog = new Map<string, PlanPrice>();
  for (const [plan, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`STRIPE_PRICE_MAP["${plan}"] must be an object`);
    }
    const price = Reflect.get(value, "price");
    const mode = Reflect.get(value, "mode");
    const intervalDays = planIntervalDays(Reflect.get(value, "intervalDays"), plan);
    if (typeof price !== "string" || !price.startsWith("price_")) {
      throw new Error(`STRIPE_PRICE_MAP["${plan}"].price must be a Stripe price id`);
    }
    if (mode !== "payment" && mode !== "subscription") {
      throw new Error(`STRIPE_PRICE_MAP["${plan}"].mode must be "payment" or "subscription"`);
    }
    catalog.set(plan, {
      mode,
      price,
      ...(intervalDays === undefined ? {} : { intervalDays }),
    });
  }
  return catalog;
}

function planIntervalDays(value: unknown, plan: string): number | undefined {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`STRIPE_PRICE_MAP["${plan}"].intervalDays must be a positive integer`);
  }
  return value;
}

export function successUrlWithSessionId(baseUrl: string): string {
  const fragmentIndex = baseUrl.indexOf("#");
  const base = fragmentIndex === -1 ? baseUrl : baseUrl.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : baseUrl.slice(fragmentIndex);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}session_id={CHECKOUT_SESSION_ID}${fragment}`;
}

export interface CheckoutRequest {
  cancelUrl: string;
  githubUser?: string;
  plan: string;
  planPrice: PlanPrice;
  repo: string;
  successUrl: string;
}

export async function createCheckoutSession(
  fetchImpl: StripeFetch,
  secretKey: string,
  request: CheckoutRequest
): Promise<string> {
  const session = await stripePost(fetchImpl, secretKey, "checkout/sessions", {
    cancel_url: request.cancelUrl,
    "line_items[0][price]": request.planPrice.price,
    "line_items[0][quantity]": "1",
    "metadata[plan]": request.plan,
    "metadata[repo]": request.repo,
    ...(request.githubUser === undefined ? {} : { "metadata[github_user]": request.githubUser }),
    mode: request.planPrice.mode,
    success_url: request.successUrl,
  });
  const url = Reflect.get(session, "url");
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("Stripe checkout session returned no url");
  }
  return url;
}
