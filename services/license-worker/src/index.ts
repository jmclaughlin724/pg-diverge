import { createPrivateKey } from "node:crypto";
import { issueLicenseToken, licenseClaimsFor } from "./issue.js";
import { verifyStripeSignature } from "./webhook.js";

/**
 * License issuance Worker (plan `20-hands-off-stack.md`, task M30). On a verified
 * Stripe `checkout.session.completed` webhook it mints a repo-bound Ed25519 license
 * token (verified later by the CLI's `src/license.ts`). Runs on Cloudflare Workers
 * with `nodejs_compat` (so `node:crypto` is available). The signing key and Stripe
 * secret come from secret bindings — never the repo. The handler is split out and
 * `nowSeconds`-injected so it is testable without a live runtime or real clock.
 */

export interface LicenseWorkerEnv {
  /** Stripe webhook endpoint signing secret, from a Worker secret binding. */
  STRIPE_WEBHOOK_SECRET: string;
  /** Ed25519 private key, PKCS8 PEM, from a Worker secret binding. */
  SUPASCHEMA_LICENSE_PRIVATE_KEY: string;
}

interface CheckoutCompletion {
  plan: string;
  repo: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** A repo binding must be a single `owner/name` slug, not an arbitrary string. */
function isValidRepo(repo: string): boolean {
  return repo.length > 0 && repo.length <= 200 && REPO_PATTERN.test(repo);
}

/** Pull the repo/plan binding out of a `checkout.session.completed` event, or null. */
export function extractCheckoutCompletion(event: unknown): CheckoutCompletion | null {
  const root = asRecord(event);
  if (root === null || root.type !== "checkout.session.completed") {
    return null;
  }
  const data = asRecord(root.data);
  const session = data === null ? null : asRecord(data.object);
  const metadata = session === null ? null : asRecord(session.metadata);
  if (metadata === null) {
    return null;
  }
  const { repo, plan } = metadata;
  if (typeof repo !== "string" || !isValidRepo(repo) || typeof plan !== "string") {
    return null;
  }
  if (plan.length === 0 || plan.length > 64) {
    return null;
  }
  return { plan, repo };
}

export async function handleLicenseWebhook(
  request: Request,
  env: LicenseWorkerEnv,
  nowSeconds: number
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const signature = request.headers.get("stripe-signature");
  if (signature === null) {
    return new Response("missing signature", { status: 400 });
  }
  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, nowSeconds)) {
    return new Response("invalid signature", { status: 400 });
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const completion = extractCheckoutCompletion(event);
  if (completion === null) {
    return new Response(JSON.stringify({ ignored: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }
  const privateKey = createPrivateKey(env.SUPASCHEMA_LICENSE_PRIVATE_KEY);
  const token = issueLicenseToken(
    licenseClaimsFor(completion.repo, completion.plan, nowSeconds),
    privateKey
  );
  return new Response(JSON.stringify({ license: token, repo: completion.repo }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

const worker = {
  fetch(request: Request, env: LicenseWorkerEnv): Promise<Response> {
    return handleLicenseWebhook(request, env, Math.floor(Date.now() / 1000));
  },
};

export default worker;
