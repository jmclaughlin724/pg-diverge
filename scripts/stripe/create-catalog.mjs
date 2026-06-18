import { pathToFileURL } from "node:url";

const stripeApiBase = "https://api.stripe.com/v1";

export function recommendedCatalog() {
  return [
    {
      amount: 4900,
      currency: "usd",
      metadata: { pack: "type-contract", plan: "type-contract" },
      mode: "payment",
      name: "supaschema type-contract pack",
      plan: "type-contract",
    },
    {
      amount: 4900,
      currency: "usd",
      metadata: { pack: "grant-drift", plan: "grant-drift" },
      mode: "payment",
      name: "supaschema grant-drift pack",
      plan: "grant-drift",
    },
    {
      amount: 9900,
      currency: "usd",
      metadata: { pack: "bundle", plan: "bundle" },
      mode: "payment",
      name: "supaschema pack bundle",
      plan: "bundle",
    },
    {
      amount: 9900,
      currency: "usd",
      metadata: { pack: "bundle", plan: "annual" },
      mode: "subscription",
      name: "supaschema pack bundle annual",
      plan: "annual",
      recurringInterval: "year",
    },
  ];
}

export function stripePriceMap(created) {
  return Object.fromEntries(
    created.map((plan) => [plan.plan, { mode: plan.mode, price: plan.priceId }])
  );
}

export async function createStripeCatalog(fetchImpl, secretKey, catalog = recommendedCatalog()) {
  const created = [];
  for (const plan of catalog) {
    const product = await ensureProduct(fetchImpl, secretKey, plan);
    const price = await ensurePrice(fetchImpl, secretKey, product.id, plan);
    created.push({
      mode: plan.mode,
      plan: plan.plan,
      priceId: price.id,
      productId: product.id,
    });
  }
  return created;
}

async function ensureProduct(fetchImpl, secretKey, plan) {
  const existing = await findProduct(fetchImpl, secretKey, plan.name);
  if (existing !== null) {
    return existing;
  }
  return stripePost(fetchImpl, secretKey, "products", {
    name: plan.name,
    ...metadataForm(plan.metadata),
  });
}

async function findProduct(fetchImpl, secretKey, name) {
  let startingAfter;
  for (;;) {
    const query = { active: "true", limit: "100" };
    if (startingAfter !== undefined) {
      query.starting_after = startingAfter;
    }
    const page = await stripeGet(fetchImpl, secretKey, "products", query);
    const products = Array.isArray(page.data) ? page.data : [];
    const product = products.find(
      (item) => item && item.name === name && typeof item.id === "string"
    );
    if (product !== undefined) {
      return product;
    }
    if (page.has_more !== true || products.length === 0) {
      return null;
    }
    const last = products.at(-1);
    if (!last || typeof last.id !== "string") {
      return null;
    }
    startingAfter = last.id;
  }
}

async function ensurePrice(fetchImpl, secretKey, productId, plan) {
  const existing = await findPrice(fetchImpl, secretKey, productId, plan);
  if (existing !== null) {
    return existing;
  }
  const body = {
    currency: plan.currency,
    product: productId,
    unit_amount: String(plan.amount),
  };
  if (plan.recurringInterval !== undefined) {
    body["recurring[interval]"] = plan.recurringInterval;
  }
  return stripePost(fetchImpl, secretKey, "prices", body);
}

async function findPrice(fetchImpl, secretKey, productId, plan) {
  let startingAfter;
  for (;;) {
    const query = { active: "true", limit: "100", product: productId };
    if (startingAfter !== undefined) {
      query.starting_after = startingAfter;
    }
    const page = await stripeGet(fetchImpl, secretKey, "prices", query);
    const prices = Array.isArray(page.data) ? page.data : [];
    const price = prices.find((item) => priceMatchesPlan(item, plan));
    if (price !== undefined) {
      return price;
    }
    if (page.has_more !== true || prices.length === 0) {
      return null;
    }
    const last = prices.at(-1);
    if (!last || typeof last.id !== "string") {
      return null;
    }
    startingAfter = last.id;
  }
}

function priceMatchesPlan(price, plan) {
  if (!price || typeof price.id !== "string") {
    return false;
  }
  const recurring = price.recurring;
  const recurringInterval =
    recurring && typeof recurring === "object" && typeof recurring.interval === "string"
      ? recurring.interval
      : undefined;
  return (
    price.currency === plan.currency &&
    price.unit_amount === plan.amount &&
    recurringInterval === plan.recurringInterval
  );
}

async function stripeGet(fetchImpl, secretKey, endpoint, query) {
  const search = new URLSearchParams(query);
  const response = await fetchImpl(`${stripeApiBase}/${endpoint}?${search.toString()}`, {
    headers: stripeHeaders(secretKey),
    method: "GET",
  });
  return stripeJson(response, endpoint);
}

async function stripePost(fetchImpl, secretKey, endpoint, body) {
  const response = await fetchImpl(`${stripeApiBase}/${endpoint}`, {
    body: new URLSearchParams(body).toString(),
    headers: { ...stripeHeaders(secretKey), "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  return stripeJson(response, endpoint);
}

async function stripeJson(response, endpoint) {
  if (!response.ok) {
    throw new Error(`Stripe ${endpoint} returned ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error(`Stripe ${endpoint} returned a non-object response`);
  }
  return payload;
}

function stripeHeaders(secretKey) {
  return { authorization: `Bearer ${secretKey}` };
}

function metadataForm(metadata) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`metadata[${key}]`, value])
  );
}

export async function main(env = process.env, fetchImpl = fetch) {
  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  if (!(secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_"))) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe secret key");
  }
  if (env.STRIPE_CATALOG_APPROVED !== "1") {
    throw new Error("STRIPE_CATALOG_APPROVED=1 is required for catalog creation");
  }
  if (secretKey.startsWith("sk_live_") && env.STRIPE_LIVE_APPROVED !== "1") {
    throw new Error("STRIPE_LIVE_APPROVED=1 is required for live catalog creation");
  }
  const created = await createStripeCatalog(fetchImpl, secretKey);
  console.log(JSON.stringify(stripePriceMap(created)));
  return created;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
