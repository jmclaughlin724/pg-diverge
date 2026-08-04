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
  createOAuthState,
  type GitHubFetch,
  verifyOAuthState,
  verifyRepoOwnership,
} from "./github-oauth.js";
import {
  canonicalRepo,
  isEntitled,
  issueLicenseToken,
  type LicenseClaims,
  licenseClaimsFor,
  licenseClaimsThrough,
  verifyLicenseToken,
} from "./issue.js";
import type { OAuthStateNamespace } from "./oauth-state.js";
import type { WorkerStore } from "./store.js";
import { type StripeFetch, stripeGet } from "./stripe-api.js";
import {
  type InvoicePaidPeriod,
  type InvoiceRenewal,
  parseSubscriptionRecord,
  type SubscriptionRecord,
  type SubscriptionRenewalNamespace,
  subscriptionRecordKey,
} from "./subscription-renewal.js";
import { verifyStripeSignature } from "./webhook.js";

export interface LicenseWorkerEnv {
  CHECKOUT_CANCEL_URL: string;

  CHECKOUT_SUCCESS_URL: string;

  CONTRACT_KV: WorkerStore;

  GITHUB_OAUTH_CLIENT_ID: string;

  GITHUB_OAUTH_CLIENT_SECRET: string;

  LICENSE_KV: WorkerStore;

  OAUTH_STATES: OAuthStateNamespace;

  STRIPE_PRICE_MAP: string;

  STRIPE_SECRET_KEY: string;

  STRIPE_WEBHOOK_SECRET: string;

  SUBSCRIPTION_RENEWALS: SubscriptionRenewalNamespace;

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
  githubOauthClientId: string;
  githubOauthClientSecret: string;
  licensePublicKeyPem: string;
  licenses: WorkerStore;
  oauthStates: OAuthStateNamespace;
  planCatalog: ReadonlyMap<string, PlanPrice>;
  privateKey: ReturnType<typeof createPrivateKey>;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  subscriptionRenewals: SubscriptionRenewalNamespace;
  successUrl: string;
}

const oauthStateCookieName = "supaschema_oauth_state";

type LicenseWorkerStringKey =
  | "CHECKOUT_CANCEL_URL"
  | "CHECKOUT_SUCCESS_URL"
  | "GITHUB_OAUTH_CLIENT_ID"
  | "GITHUB_OAUTH_CLIENT_SECRET"
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
  if (subscription === undefined || typeof invoiceId !== "string" || invoiceId.length === 0) {
    return null;
  }
  return {
    invoiceId,
    periods: invoicePaidPeriods(invoice),
    subscriptionId: subscription,
  };
}

function invoicePaidPeriods(invoice: object): InvoicePaidPeriod[] {
  const lines = asObject(property(invoice, "lines"));
  const data = lines === null ? undefined : property(lines, "data");
  if (!Array.isArray(data)) {
    return [];
  }
  const periods: InvoicePaidPeriod[] = [];
  for (const value of data) {
    const line = asObject(value);
    if (line === null) {
      continue;
    }
    const period = asObject(property(line, "period"));
    const paidThrough = period === null ? undefined : property(period, "end");
    const priceId = invoiceLinePriceId(line);
    if (!isUnixTimestamp(paidThrough) || priceId === undefined) {
      continue;
    }
    const subscriptionId = invoiceLineSubscriptionId(line);
    periods.push({
      paidThrough,
      priceId,
      ...(subscriptionId === undefined ? {} : { subscriptionId }),
    });
  }
  return periods;
}

function invoiceLinePriceId(line: object): string | undefined {
  const pricing = asObject(property(line, "pricing"));
  const priceDetails = pricing === null ? null : asObject(property(pricing, "price_details"));
  const modern = priceDetails === null ? undefined : property(priceDetails, "price");
  if (typeof modern === "string" && modern.length > 0) {
    return modern;
  }
  const legacyPrice = asObject(property(line, "price"));
  const legacy = legacyPrice === null ? undefined : property(legacyPrice, "id");
  return typeof legacy === "string" && legacy.length > 0 ? legacy : undefined;
}

function invoiceLineSubscriptionId(line: object): string | undefined {
  const parent = asObject(property(line, "parent"));
  if (parent === null || property(parent, "type") !== "subscription_item_details") {
    return;
  }
  const details = asObject(property(parent, "subscription_item_details"));
  const subscription = details === null ? undefined : property(details, "subscription");
  return typeof subscription === "string" && subscription.length > 0 ? subscription : undefined;
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

async function ensureSubscriptionRecord(
  runtime: LicenseWorkerRuntime,
  completion: NonNullable<ReturnType<typeof extractCheckoutCompletion>>,
  stripeFetch: StripeFetch
): Promise<SubscriptionRecord | null> {
  const planPrice = runtime.planCatalog.get(completion.plan);
  if (completion.subscriptionId === undefined || planPrice?.mode !== "subscription") {
    return null;
  }
  const key = subscriptionRecordKey(completion.subscriptionId);
  const raw = await runtime.licenses.get(key);
  const existing = raw === null ? null : parseSubscriptionRecord(raw);
  if (existing !== null) {
    const matchesCompletion =
      existing.plan === completion.plan &&
      existing.priceId === planPrice.price &&
      canonicalRepo(existing.repo) === canonicalRepo(completion.repo) &&
      existing.sessionId === completion.sessionId;
    return matchesCompletion ? existing : null;
  }
  const subscription = await stripeGet(
    stripeFetch,
    runtime.stripeSecretKey,
    `subscriptions/${encodeURIComponent(completion.subscriptionId)}`
  );
  const paidThrough = subscriptionPaidThrough(subscription, planPrice.price);
  if (paidThrough === null) {
    return null;
  }
  const record: SubscriptionRecord = {
    paidThrough,
    plan: completion.plan,
    priceId: planPrice.price,
    repo: completion.repo,
    sessionId: completion.sessionId,
  };
  await runtime.licenses.put(key, JSON.stringify(record));
  return record;
}

function subscriptionPaidThrough(subscription: object, priceId: string): number | null {
  const items = asObject(property(subscription, "items"));
  const data = items === null ? undefined : property(items, "data");
  if (!Array.isArray(data)) {
    return null;
  }
  const matchingPeriods: number[] = [];
  for (const value of data) {
    const item = asObject(value);
    const price = item === null ? null : asObject(property(item, "price"));
    if (item === null || price === null || property(price, "id") !== priceId) {
      continue;
    }
    const paidThrough = property(item, "current_period_end");
    if (isUnixTimestamp(paidThrough)) {
      matchingPeriods.push(paidThrough);
    }
  }
  return matchingPeriods.length === 1 ? (matchingPeriods[0] ?? null) : null;
}

function isUnixTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function handleCheckoutCompletion(
  completion: CheckoutCompletion,
  runtime: LicenseWorkerRuntime,
  nowSeconds: number,
  stripeFetch: StripeFetch
): Promise<Response> {
  const planPrice = runtime.planCatalog.get(completion.plan);
  if (planPrice === undefined) {
    return jsonResponse({ ignored: true });
  }
  const existing = await runtime.licenses.get(completion.sessionId);
  if (existing !== null) {
    if (planPrice.mode === "subscription") {
      try {
        const record = await ensureSubscriptionRecord(runtime, completion, stripeFetch);
        if (record === null) {
          return new Response("invalid subscription paid-through period", { status: 500 });
        }
      } catch {
        return new Response("subscription lookup failed", { status: 502 });
      }
    }
    return jsonResponse({ idempotent: true, issued: true });
  }
  let paidThrough: number | undefined;
  if (planPrice.mode === "subscription") {
    try {
      const record = await ensureSubscriptionRecord(runtime, completion, stripeFetch);
      paidThrough = record?.paidThrough;
    } catch {
      return new Response("subscription lookup failed", { status: 502 });
    }
    if (paidThrough === undefined || paidThrough <= nowSeconds) {
      return new Response("invalid subscription paid-through period", { status: 500 });
    }
  }
  const claims =
    paidThrough === undefined
      ? licenseClaimsFor(
          completion.repo,
          completion.plan,
          nowSeconds,
          planPrice.intervalDays ?? 365
        )
      : licenseClaimsThrough(completion.repo, completion.plan, paidThrough);
  await runtime.licenses.put(completion.sessionId, issueLicenseToken(claims, runtime.privateKey));
  return jsonResponse({ issued: true, repo: completion.repo });
}

async function handleInvoiceRenewal(
  renewal: InvoiceRenewal,
  runtime: LicenseWorkerRuntime,
  nowSeconds: number
): Promise<Response> {
  const rawRecord = await runtime.licenses.get(subscriptionRecordKey(renewal.subscriptionId));
  const record = rawRecord === null ? null : parseSubscriptionRecord(rawRecord);
  if (record === null) {
    return jsonResponse({ ignored: true });
  }
  try {
    const outcome = await runtime.subscriptionRenewals
      .getByName(record.sessionId)
      .renew(renewal.subscriptionId, renewal, nowSeconds);
    if (outcome.kind === "renewed") {
      return jsonResponse({ renewed: true, repo: outcome.repo });
    }
    if (outcome.kind === "idempotent") {
      return jsonResponse({ idempotent: true, renewed: true });
    }
    if (outcome.kind === "invalid") {
      return new Response("invalid invoice paid-through period", { status: 500 });
    }
    if (outcome.kind === "unavailable") {
      return new Response("subscription renewal state unavailable", { status: 503 });
    }
    return jsonResponse({ ignored: true });
  } catch {
    return new Response("subscription renewal unavailable", { status: 503 });
  }
}

async function handleWebhook(
  request: Request,
  runtime: LicenseWorkerRuntime,
  nowSeconds: number,
  stripeFetch: StripeFetch
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
    return handleCheckoutCompletion(completion, runtime, nowSeconds, stripeFetch);
  }
  const renewal = extractInvoiceRenewal(event);
  if (renewal !== null) {
    return handleInvoiceRenewal(renewal, runtime, nowSeconds);
  }
  return jsonResponse({ ignored: true });
}

function handleLicenseRetrieval(url: URL, runtime: LicenseWorkerRuntime): Promise<Response> {
  const sessionId = url.searchParams.get("session_id");
  if (sessionId === null || sessionId.length === 0) {
    return Promise.resolve(new Response("missing session_id", { status: 400 }));
  }
  if (sessionId.includes(":")) {
    return Promise.resolve(new Response("invalid session_id", { status: 400 }));
  }
  return sessionLicenseResponse(sessionId, runtime);
}

async function sessionLicenseResponse(
  sessionId: string,
  runtime: LicenseWorkerRuntime
): Promise<Response> {
  const directToken = await runtime.licenses.get(sessionId);
  if (directToken === null) {
    return licenseRetrievalResponse(null);
  }
  const directClaims = verifiedLicenseClaims(directToken, runtime);
  const directMode =
    directClaims === null ? undefined : runtime.planCatalog.get(directClaims.plan)?.mode;
  if (directClaims === null || directMode === undefined) {
    return unavailableLicenseResponse("license unavailable");
  }
  if (directMode === "payment") {
    return licenseRetrievalResponse(directToken);
  }
  let coordinatedToken: string | null;
  try {
    coordinatedToken = await runtime.subscriptionRenewals
      .getByName(sessionId)
      .license("", sessionId);
  } catch {
    return unavailableLicenseResponse("subscription license unavailable");
  }
  if (coordinatedToken !== null) {
    const claims = verifiedLicenseClaims(coordinatedToken, runtime);
    if (
      claims === null ||
      runtime.planCatalog.get(claims.plan)?.mode !== "subscription" ||
      claims.plan !== directClaims.plan ||
      canonicalRepo(claims.repo) !== canonicalRepo(directClaims.repo)
    ) {
      return unavailableLicenseResponse("subscription license unavailable");
    }
    return licenseRetrievalResponse(
      claims.exp >= directClaims.exp ? coordinatedToken : directToken
    );
  }
  return licenseRetrievalResponse(directToken);
}

function licenseRetrievalResponse(token: string | null): Response {
  const response =
    token === null ? jsonResponse({ pending: true }, 404) : jsonResponse({ license: token });
  response.headers.set("cache-control", "no-store");
  return response;
}

function unavailableLicenseResponse(message: string): Response {
  const response = new Response(message, { status: 503 });
  response.headers.set("cache-control", "no-store");
  return response;
}

function verifiedLicenseClaims(token: string, runtime: LicenseWorkerRuntime): LicenseClaims | null {
  const claims = verifyLicenseToken(token, runtime.licensePublicKeyPem);
  if (claims === null || !isUnixTimestamp(claims.exp)) {
    return null;
  }
  return claims;
}

function handleCheckout(
  request: Request,
  runtime: LicenseWorkerRuntime,
  url: URL,
  nowSeconds: number
): Response {
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
  if (runtime.planCatalog.get(plan) === undefined) {
    return new Response("unknown plan", { status: 404 });
  }
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", runtime.githubOauthClientId);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/github/callback`);
  const stateToken = createOAuthState(repo, plan, nowSeconds, runtime.privateKey);
  authorize.searchParams.set("state", stateToken);
  return new Response(null, {
    headers: {
      location: authorize.toString(),
      "set-cookie": oauthStateCookie(stateToken, 600),
    },
    status: 302,
  });
}

async function handleOAuthCallback(
  request: Request,
  url: URL,
  runtime: LicenseWorkerRuntime,
  nowSeconds: number,
  githubFetch: GitHubFetch,
  stripeFetch: StripeFetch
): Promise<Response> {
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (code === null || code.length === 0 || stateToken === null) {
    return new Response("missing code or state", { status: 400 });
  }
  if (requestCookie(request, oauthStateCookieName) !== stateToken) {
    return new Response("invalid state", { status: 400 });
  }
  const state = verifyOAuthState(stateToken, runtime.licensePublicKeyPem, nowSeconds);
  if (state === null || !isValidRepo(state.repo) || !isValidPlan(state.plan)) {
    return new Response("invalid state", { status: 400 });
  }
  let consumed: boolean;
  try {
    consumed = await runtime.oauthStates
      .getByName(state.nonce)
      .consume(state.expiresAt, nowSeconds);
  } catch {
    return new Response("oauth state unavailable", { status: 503 });
  }
  if (!consumed) {
    return new Response("state already used", { status: 400 });
  }
  const planPrice = runtime.planCatalog.get(state.plan);
  if (planPrice === undefined) {
    return new Response("unknown plan", { status: 404 });
  }
  const identity = await verifyRepoOwnership(
    githubFetch,
    runtime.githubOauthClientId,
    runtime.githubOauthClientSecret,
    code,
    state
  );
  if (!identity.ok) {
    return new Response(identity.reason, { status: identity.status });
  }
  const checkout: CheckoutRequest = {
    cancelUrl: runtime.cancelUrl,
    githubUser: identity.login,
    plan: state.plan,
    planPrice,
    repo: state.repo,
    successUrl: successUrlWithSessionId(runtime.successUrl),
  };
  try {
    const sessionUrl = await createCheckoutSession(stripeFetch, runtime.stripeSecretKey, checkout);
    return new Response(null, {
      headers: {
        location: sessionUrl,
        "set-cookie": oauthStateCookie("", 0),
      },
      status: 302,
    });
  } catch {
    return new Response("checkout unavailable", { status: 502 });
  }
}

function oauthStateCookie(value: string, maxAgeSeconds: number): string {
  return `${oauthStateCookieName}=${value}; HttpOnly; Max-Age=${maxAgeSeconds}; Path=/auth/github/callback; SameSite=Lax; Secure`;
}

function requestCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0 && trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
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

function hasSubscriptionRenewalNamespace(value: unknown): value is SubscriptionRenewalNamespace {
  const namespace = asObject(value);
  return namespace !== null && typeof property(namespace, "getByName") === "function";
}

function hasOAuthStateNamespace(value: unknown): value is OAuthStateNamespace {
  const namespace = asObject(value);
  return namespace !== null && typeof property(namespace, "getByName") === "function";
}

function licenseWorkerRuntime(
  env: LicenseWorkerEnv,
  stores: Partial<LicenseWorkerStores>
): { errors: string[]; runtime?: LicenseWorkerRuntime } {
  const errors: string[] = [];
  const contracts = stores.contracts;
  const licenses = stores.licenses;
  const oauthStates = env.OAUTH_STATES;
  const subscriptionRenewals = env.SUBSCRIPTION_RENEWALS;
  const cancelUrl = requiredString(env, "CHECKOUT_CANCEL_URL", errors);
  const successUrl = requiredString(env, "CHECKOUT_SUCCESS_URL", errors);
  const githubOauthClientId = requiredString(env, "GITHUB_OAUTH_CLIENT_ID", errors);
  const githubOauthClientSecret = requiredString(env, "GITHUB_OAUTH_CLIENT_SECRET", errors);
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
  if (!hasOAuthStateNamespace(oauthStates)) {
    errors.push("OAUTH_STATES must provide getByName");
  }
  if (!hasSubscriptionRenewalNamespace(subscriptionRenewals)) {
    errors.push("SUBSCRIPTION_RENEWALS must provide getByName");
  }
  if (
    errors.length > 0 ||
    !hasStoreMethods(contracts) ||
    !hasStoreMethods(licenses) ||
    !hasOAuthStateNamespace(oauthStates) ||
    !hasSubscriptionRenewalNamespace(subscriptionRenewals) ||
    cancelUrl === undefined ||
    githubOauthClientId === undefined ||
    githubOauthClientSecret === undefined ||
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
      githubOauthClientId,
      githubOauthClientSecret,
      licensePublicKeyPem,
      licenses,
      oauthStates,
      planCatalog,
      privateKey,
      stripeSecretKey,
      stripeWebhookSecret,
      subscriptionRenewals,
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
  fetchImpl: typeof fetch
): Promise<Response> {
  const readiness = licenseWorkerRuntime(env, stores);
  const runtime = readiness.runtime;
  if (runtime === undefined) {
    return Promise.resolve(new Response("worker misconfigured", { status: 500 }));
  }
  const url = new URL(request.url);
  if (url.pathname === "/checkout") {
    return Promise.resolve(handleCheckout(request, runtime, url, nowSeconds));
  }
  if (url.pathname === "/auth/github/callback") {
    return handleOAuthCallback(request, url, runtime, nowSeconds, fetchImpl, fetchImpl);
  }
  if (url.pathname === "/contracts") {
    return handleContractRegistry(request, runtime, url, nowSeconds);
  }
  if (url.pathname === "/webhook") {
    return handleWebhook(request, runtime, nowSeconds, fetchImpl);
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
  return handleLicenseRetrieval(url, runtime).then((response) =>
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
