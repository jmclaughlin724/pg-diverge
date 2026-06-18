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

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("unexpected Stripe response shape");
  }
  return value as Record<string, unknown>;
}

export async function stripePost(
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

  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${await response.text()}`);
  }
  return asObject(await response.json());
}
