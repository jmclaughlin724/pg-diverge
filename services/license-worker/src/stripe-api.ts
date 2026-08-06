export interface StripeResponse {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type StripeFetch = (
  url: string,
  init: { body?: string; headers: Record<string, string>; method: string }
) => Promise<StripeResponse>;

function stripeObject(value: unknown): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("unexpected Stripe response shape");
  }
  return value;
}

export async function stripeGet(
  fetchImpl: StripeFetch,
  secretKey: string,
  path: string
): Promise<object> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${await response.text()}`);
  }
  return stripeObject(await response.json());
}

export async function stripePost(
  fetchImpl: StripeFetch,
  secretKey: string,
  path: string,
  form: Record<string, string>
): Promise<object> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    body: new URLSearchParams(form).toString(),
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${await response.text()}`);
  }
  return stripeObject(await response.json());
}
