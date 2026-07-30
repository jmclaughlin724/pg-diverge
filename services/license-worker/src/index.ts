import { createPrivateKey, createPublicKey } from "node:crypto";
import { isSchemaContract } from "../../../src/contract/schema.js";
import {
  type CheckoutRequest,
  createCheckoutSession,
  type PlanPrice,
  parsePlanCatalog,
  successUrlWithSessionId,
} from "./checkout.js";
import {
  canonicalRepo,
  isEntitled,
  issueLicenseToken,
  licenseClaimsFor,
  verifyLicenseToken,
} from "./issue.js";
import type { WorkerStore } from "./store.js";
import type { StripeFetch } from "./stripe-api.js";
import { verifyStripeSignature } from "./webhook.js";

export interface LicenseWorkerEnv {
  CHECKOUT_CANCEL_URL: string;

  CHECKOUT_SUCCESS_URL: string;

  CONTRACT_KV: WorkerStore;

  LICENSE_KV: WorkerStore;

  STRIPE_PRICE_MAP: string;

  STRIPE_SECRET_KEY: string;

  STRIPE_WEBHOOK_SECRET: string;

  SUPASCHEMA_LICENSE_PRIVATE_KEY: string;
}

export interface LicenseWorkerStores {
  contracts: WorkerStore;
  licenses: WorkerStore;
}

interface CheckoutCompletion {
  plan: string;
  repo: string;
  sessionId: string;
  subscriptionId?: string;
}

interface LicenseWorkerRuntime {
  cancelUrl: string;
  contracts: WorkerStore;
  licensePublicKeyPem: string;
  licenses: WorkerStore;
  planCatalog: ReadonlyMap<string, PlanPrice>;
  privateKey: ReturnType<typeof createPrivateKey>;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  successUrl: string;
}

type LicenseWorkerStringKey =
  | "CHECKOUT_CANCEL_URL"
  | "CHECKOUT_SUCCESS_URL"
  | "STRIPE_PRICE_MAP"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "SUPASCHEMA_LICENSE_PRIVATE_KEY";

function asObject(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isValidRepo(repo: string): boolean {
  const parts = repo.split("/");
  return (
    repo.length > 0 &&
    repo.length <= 200 &&
    parts.length === 2 &&
    parts.every((part) => part.length > 0 && [...part].every(isRepoSlugChar))
  );
}

function isRepoSlugChar(char: string): boolean {
  return isAsciiLetter(char) || isDigit(char) || char === "." || char === "_" || char === "-";
}

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isValidPlan(plan: string): boolean {
  return plan.length > 0 && plan.length <= 64;
}

function isValidRegistryName(name: string): boolean {
  return name.length > 0 && name.length <= 96 && [...name].every(isRegistryNameChar);
}

function isRegistryNameChar(char: string): boolean {
  return isAsciiLetter(char) || isDigit(char) || char === "." || char === "_" || char === "-";
}

export function extractCheckoutCompletion(event: unknown): CheckoutCompletion | null {
  const root = asObject(event);
  if (
    root === null ||
    (property(root, "type") !== "checkout.session.completed" &&
      property(root, "type") !== "checkout.session.async_payment_succeeded")
  ) {
    return null;
  }
  const data = asObject(property(root, "data"));
  const session = data === null ? null : asObject(property(data, "object"));
  const metadata = session === null ? null : asObject(property(session, "metadata"));
  if (session === null || metadata === null) {
    return null;
  }
  const paymentStatus = property(session, "payment_status");
  if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
    return null;
  }
  const repo = property(metadata, "repo");
  const plan = property(metadata, "plan");
  const sessionId = property(session, "id");
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }
  if (typeof repo !== "string" || !isValidRepo(repo)) {
    return null;
  }
  if (typeof plan !== "string" || !isValidPlan(plan)) {
    return null;
  }
  const subscription = property(session, "subscription");
  return {
    plan,
    repo,
    sessionId,
    ...(typeof subscription === "string" && subscription.length > 0
      ? { subscriptionId: subscription }
      : {}),
  };
}

interface InvoiceRenewal {
  invoiceId: string;
  subscriptionId: string;
}

export function extractInvoiceRenewal(event: unknown): InvoiceRenewal | null {
  const root = asObject(event);
  if (root === null || property(root, "type") !== "invoice.paid") {
    return null;
  }
  const data = asObject(property(root, "data"));
  const invoice = data === null ? null : asObject(property(data, "object"));
  if (invoice === null || property(invoice, "billing_reason") !== "subscription_cycle") {
    return null;
  }
  const subscription = invoiceSubscriptionId(invoice);
  const invoiceId = property(invoice, "id");
  if (subscription === undefined) {
    return null;
  }
  return {
    invoiceId: typeof invoiceId === "string" && invoiceId.length > 0 ? invoiceId : subscription,
    subscriptionId: subscription,
  };
}

function invoiceSubscriptionId(invoice: object): string | undefined {
  const parent = asObject(property(invoice, "parent"));
  if (parent !== null && property(parent, "type") === "subscription_details") {
    const details = asObject(property(parent, "subscription_details"));
    const modern = details === null ? undefined : property(details, "subscription");
    if (typeof modern === "string" && modern.length > 0) {
      return modern;
    }
  }
  const legacy = property(invoice, "subscription");
  return typeof legacy === "string" && legacy.length > 0 ? legacy : undefined;
}

interface SubscriptionRecord {
  intervalDays: number;
  plan: string;
  repo: string;
  sessionId: string;
}

function parseSubscriptionRecord(raw: string): SubscriptionRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = asObject(parsed);
    if (record === null) {
      return null;
    }
    const sessionId = property(record, "sessionId");
    const repo = property(record, "repo");
    const plan = property(record, "plan");
    const intervalDays = property(record, "intervalDays");
    if (typeof sessionId !== "string" || typeof repo !== "string" || typeof plan !== "string") {
      return null;
    }
    return {
      intervalDays:
        typeof intervalDays === "number" && Number.isInteger(intervalDays) && intervalDays >= 1
          ? intervalDays
          : 365,
      plan,
      repo,
      sessionId,
    };
  } catch {
    return null;
  }
}

async function ensureSubscriptionRecord(
  runtime: LicenseWorkerRuntime,
  completion: NonNullable<ReturnType<typeof extractCheckoutCompletion>>
): Promise<void> {
  if (completion.subscriptionId === undefined) {
    return;
  }
  const key = `subscription:${completion.subscriptionId}`;
  if ((await runtime.licenses.get(key)) !== null) {
    return;
  }
  const record: SubscriptionRecord = {
    intervalDays: runtime.planCatalog.get(completion.plan)?.intervalDays ?? 365,
    plan: completion.plan,
    repo: completion.repo,
    sessionId: completion.sessionId,
  };
  await runtime.licenses.put(key, JSON.stringify(record));
}

async function handleWebhook(
  request: Request,
  runtime: LicenseWorkerRuntime,
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
  if (!verifyStripeSignature(rawBody, signature, runtime.stripeWebhookSecret, nowSeconds)) {
    return new Response("invalid signature", { status: 400 });
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const completion = extractCheckoutCompletion(event);
  if (completion !== null) {
    const existing = await runtime.licenses.get(completion.sessionId);
    if (existing !== null) {
      await ensureSubscriptionRecord(runtime, completion);
      return jsonResponse({ idempotent: true, issued: true });
    }
    const token = issueLicenseToken(
      licenseClaimsFor(
        completion.repo,
        completion.plan,
        nowSeconds,
        runtime.planCatalog.get(completion.plan)?.intervalDays ?? 365
      ),
      runtime.privateKey
    );
    await runtime.licenses.put(completion.sessionId, token);
    await ensureSubscriptionRecord(runtime, completion);
    return jsonResponse({ issued: true, repo: completion.repo });
  }
  const renewal = extractInvoiceRenewal(event);
  if (renewal !== null) {
    const raw = await runtime.licenses.get(`subscription:${renewal.subscriptionId}`);
    const record = raw === null ? null : parseSubscriptionRecord(raw);
    if (record === null) {
      return jsonResponse({ ignored: true });
    }
    const token = issueLicenseToken(
      licenseClaimsFor(record.repo, record.plan, nowSeconds, record.intervalDays),
      runtime.privateKey
    );
    await runtime.licenses.put(record.sessionId, token);
    return jsonResponse({ renewed: true, repo: record.repo });
  }
  return jsonResponse({ ignored: true });
}

async function handleLicenseRetrieval(url: URL, store: WorkerStore): Promise<Response> {
  const sessionId = url.searchParams.get("session_id");
  if (sessionId === null || sessionId.length === 0) {
    return new Response("missing session_id", { status: 400 });
  }
  if (sessionId.includes(":")) {
    return new Response("invalid session_id", { status: 400 });
  }
  const token = await store.get(sessionId);
  const response =
    token === null ? jsonResponse({ pending: true }, 404) : jsonResponse({ license: token });
  response.headers.set("cache-control", "no-store");
  return response;
}

async function handleCheckout(
  request: Request,
  runtime: LicenseWorkerRuntime,
  url: URL,
  stripeFetch: StripeFetch
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const repo = url.searchParams.get("repo") ?? "";
  const plan = url.searchParams.get("plan") ?? "";
  if (!isValidRepo(repo)) {
    return new Response("invalid repo", { status: 400 });
  }
  if (!isValidPlan(plan)) {
    return new Response("invalid plan", { status: 400 });
  }
  const planPrice = runtime.planCatalog.get(plan);
  if (planPrice === undefined) {
    return new Response("unknown plan", { status: 404 });
  }
  const checkout: CheckoutRequest = {
    cancelUrl: runtime.cancelUrl,
    plan,
    planPrice,
    repo,
    successUrl: successUrlWithSessionId(runtime.successUrl),
  };
  try {
    const sessionUrl = await createCheckoutSession(stripeFetch, runtime.stripeSecretKey, checkout);
    return new Response(null, { headers: { location: sessionUrl }, status: 302 });
  } catch {
    return new Response("checkout unavailable", { status: 502 });
  }
}

async function handleContractRegistry(
  request: Request,
  runtime: LicenseWorkerRuntime,
  url: URL,
  nowSeconds: number
): Promise<Response> {
  const contract = contractStorageKey(url);
  if (contract === null) {
    return new Response("invalid contract key", { status: 400 });
  }
  if (!isRegistryAuthorized(request, runtime.licensePublicKeyPem, contract.repo, nowSeconds)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (url.pathname === "/contracts" && request.method === "GET") {
    const stored = await runtime.contracts.get(contract.key);
    return stored === null ? jsonResponse({ found: false }, 404) : jsonResponse(JSON.parse(stored));
  }
  if (url.pathname === "/contracts" && request.method === "PUT") {
    const payload = await readContract(request);
    if (payload === null) {
      return new Response("invalid contract", { status: 400 });
    }
    await runtime.contracts.put(contract.key, JSON.stringify(payload));
    return jsonResponse({ stored: true });
  }
  if (url.pathname === "/contracts" && request.method === "DELETE") {
    await runtime.contracts.delete(contract.key);
    return jsonResponse({ deleted: true });
  }
  return new Response("method not allowed", { status: 405 });
}

function contractStorageKey(url: URL): { key: string; repo: string } | null {
  const repo = url.searchParams.get("repo") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!(isValidRepo(repo) && isValidRegistryName(name))) {
    return null;
  }
  return { key: `contract:${canonicalRepo(repo)}:${name}`, repo };
}

function isRegistryAuthorized(
  request: Request,
  publicKeyPem: string,
  repo: string,
  nowSeconds: number
): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token, extra] = authorization.split(" ");
  if (scheme !== "Bearer" || token === undefined || token.length === 0 || extra !== undefined) {
    return false;
  }
  return isEntitled(verifyLicenseToken(token, publicKeyPem), repo, nowSeconds);
}

async function readContract(request: Request): Promise<unknown | null> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }
  return isSchemaContract(payload) ? payload : null;
}

function requiredString(
  env: LicenseWorkerEnv,
  key: LicenseWorkerStringKey,
  errors: string[]
): string | undefined {
  const value = env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  errors.push(`${key} is required`);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasStoreMethods(value: unknown): value is WorkerStore {
  const store = asObject(value);
  return (
    store !== null &&
    typeof property(store, "delete") === "function" &&
    typeof property(store, "get") === "function" &&
    typeof property(store, "put") === "function"
  );
}

function licenseWorkerRuntime(
  env: LicenseWorkerEnv,
  stores: Partial<LicenseWorkerStores>
): { errors: string[]; runtime?: LicenseWorkerRuntime } {
  const errors: string[] = [];
  const contracts = stores.contracts;
  const licenses = stores.licenses;
  const cancelUrl = requiredString(env, "CHECKOUT_CANCEL_URL", errors);
  const successUrl = requiredString(env, "CHECKOUT_SUCCESS_URL", errors);
  const priceMap = requiredString(env, "STRIPE_PRICE_MAP", errors);
  const stripeSecretKey = requiredString(env, "STRIPE_SECRET_KEY", errors);
  const stripeWebhookSecret = requiredString(env, "STRIPE_WEBHOOK_SECRET", errors);
  const privateKeyPem = requiredString(env, "SUPASCHEMA_LICENSE_PRIVATE_KEY", errors);
  let planCatalog: ReadonlyMap<string, PlanPrice> | undefined;
  let privateKey: ReturnType<typeof createPrivateKey> | undefined;
  let licensePublicKeyPem: string | undefined;
  if (cancelUrl !== undefined && !isHttpsUrl(cancelUrl)) {
    errors.push("CHECKOUT_CANCEL_URL must be an HTTPS URL");
  }
  if (successUrl !== undefined && !isHttpsUrl(successUrl)) {
    errors.push("CHECKOUT_SUCCESS_URL must be an HTTPS URL");
  }
  if (priceMap !== undefined) {
    try {
      planCatalog = parsePlanCatalog(priceMap);
      if (planCatalog.size === 0) {
        errors.push("STRIPE_PRICE_MAP must contain at least one plan");
      }
    } catch {
      errors.push("STRIPE_PRICE_MAP must be valid");
    }
  }
  if (privateKeyPem !== undefined) {
    try {
      privateKey = createPrivateKey(privateKeyPem);
      if (privateKey.asymmetricKeyType === "ed25519") {
        licensePublicKeyPem = createPublicKey(privateKeyPem)
          .export({ format: "pem", type: "spki" })
          .toString();
      } else {
        errors.push("SUPASCHEMA_LICENSE_PRIVATE_KEY must be an Ed25519 private key");
      }
    } catch {
      errors.push("SUPASCHEMA_LICENSE_PRIVATE_KEY must be an Ed25519 private key");
    }
  }
  if (!hasStoreMethods(contracts)) {
    errors.push("CONTRACT_KV must provide get, put, and delete");
  }
  if (!hasStoreMethods(licenses)) {
    errors.push("LICENSE_KV must provide get, put, and delete");
  }
  if (
    errors.length > 0 ||
    !hasStoreMethods(contracts) ||
    !hasStoreMethods(licenses) ||
    cancelUrl === undefined ||
    successUrl === undefined ||
    planCatalog === undefined ||
    privateKey === undefined ||
    licensePublicKeyPem === undefined ||
    stripeSecretKey === undefined ||
    stripeWebhookSecret === undefined
  ) {
    return { errors };
  }
  return {
    errors,
    runtime: {
      cancelUrl,
      contracts,
      licensePublicKeyPem,
      licenses,
      planCatalog,
      privateKey,
      stripeSecretKey,
      stripeWebhookSecret,
      successUrl,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

export function handleLicenseWorker(
  request: Request,
  env: LicenseWorkerEnv,
  stores: Partial<LicenseWorkerStores>,
  nowSeconds: number,
  stripeFetch: StripeFetch
): Promise<Response> {
  const readiness = licenseWorkerRuntime(env, stores);
  const runtime = readiness.runtime;
  if (runtime === undefined) {
    return Promise.resolve(new Response("worker misconfigured", { status: 500 }));
  }
  const url = new URL(request.url);
  if (url.pathname === "/checkout") {
    return handleCheckout(request, runtime, url, stripeFetch);
  }
  if (url.pathname === "/contracts") {
    return handleContractRegistry(request, runtime, url, nowSeconds);
  }
  if (url.pathname === "/webhook") {
    return handleWebhook(request, runtime, nowSeconds);
  }
  if (url.pathname === "/license") {
    return handleLicenseCors(request, url, runtime);
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

function handleLicenseCors(
  request: Request,
  url: URL,
  runtime: LicenseWorkerRuntime
): Promise<Response> {
  const allowedOrigin = new URL(runtime.successUrl).origin;
  if (request.method === "OPTIONS") {
    return Promise.resolve(
      new Response(null, {
        headers: {
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-origin": allowedOrigin,
          "access-control-max-age": "86400",
        },
        status: 204,
      })
    );
  }
  if (request.method !== "GET") {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
  return handleLicenseRetrieval(url, runtime.licenses).then((response) =>
    withCorsOrigin(response, allowedOrigin)
  );
}

function withCorsOrigin(response: Response, allowedOrigin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("cache-control", "no-store");
  headers.set("vary", "Origin");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const worker = {
  fetch(request: Request, env: LicenseWorkerEnv): Promise<Response> {
    return handleLicenseWorker(
      request,
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      Math.floor(Date.now() / 1000),
      globalThis.fetch
    );
  },
};

export default worker;
