import { createPrivateKey } from "node:crypto";
import {
  type CheckoutRequest,
  createCheckoutSession,
  type PlanPrice,
  parsePlanCatalog,
  successUrlWithSessionId,
} from "./checkout.js";
import { issueLicenseToken, licenseClaimsFor } from "./issue.js";
import type { LicenseStore } from "./store.js";
import type { StripeFetch } from "./stripe-api.js";
import { verifyStripeSignature } from "./webhook.js";

export interface LicenseWorkerEnv {
  CHECKOUT_CANCEL_URL: string;

  CHECKOUT_SUCCESS_URL: string;

  CONTRACT_REGISTRY_TOKEN: string;

  LICENSE_KV: LicenseStore;

  STRIPE_PRICE_MAP: string;

  STRIPE_SECRET_KEY: string;

  STRIPE_WEBHOOK_SECRET: string;

  SUPASCHEMA_LICENSE_PRIVATE_KEY: string;
}

interface CheckoutCompletion {
  plan: string;
  repo: string;
  sessionId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
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
  const root = asRecord(event);
  if (root === null || root.type !== "checkout.session.completed") {
    return null;
  }
  const data = asRecord(root.data);
  const session = data === null ? null : asRecord(data.object);
  const metadata = session === null ? null : asRecord(session.metadata);
  if (session === null || metadata === null) {
    return null;
  }
  const { repo, plan } = metadata;
  const sessionId = session.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }
  if (typeof repo !== "string" || !isValidRepo(repo)) {
    return null;
  }
  if (typeof plan !== "string" || !isValidPlan(plan)) {
    return null;
  }
  return { plan, repo, sessionId };
}

async function handleWebhook(
  request: Request,
  env: LicenseWorkerEnv,
  store: LicenseStore,
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
    return jsonResponse({ ignored: true });
  }

  const existing = await store.get(completion.sessionId);
  if (existing !== null) {
    return jsonResponse({ idempotent: true, issued: true });
  }
  const privateKey = createPrivateKey(env.SUPASCHEMA_LICENSE_PRIVATE_KEY);
  const token = issueLicenseToken(
    licenseClaimsFor(completion.repo, completion.plan, nowSeconds),
    privateKey
  );
  await store.put(completion.sessionId, token);
  return jsonResponse({ issued: true, repo: completion.repo });
}

async function handleLicenseRetrieval(url: URL, store: LicenseStore): Promise<Response> {
  const sessionId = url.searchParams.get("session_id");
  if (sessionId === null || sessionId.length === 0) {
    return new Response("missing session_id", { status: 400 });
  }
  const token = await store.get(sessionId);
  if (token === null) {
    return jsonResponse({ pending: true }, 404);
  }
  return jsonResponse({ license: token });
}

async function handleCheckout(
  request: Request,
  env: LicenseWorkerEnv,
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
  let planPrice: PlanPrice | undefined;
  try {
    planPrice = parsePlanCatalog(env.STRIPE_PRICE_MAP).get(plan);
  } catch {
    return new Response("checkout misconfigured", { status: 500 });
  }
  if (planPrice === undefined) {
    return new Response("unknown plan", { status: 404 });
  }
  const checkout: CheckoutRequest = {
    cancelUrl: env.CHECKOUT_CANCEL_URL,
    plan,
    planPrice,
    repo,
    successUrl: successUrlWithSessionId(env.CHECKOUT_SUCCESS_URL),
  };
  try {
    const sessionUrl = await createCheckoutSession(stripeFetch, env.STRIPE_SECRET_KEY, checkout);
    return new Response(null, { headers: { location: sessionUrl }, status: 302 });
  } catch {
    return new Response("checkout unavailable", { status: 502 });
  }
}

async function handleContractRegistry(
  request: Request,
  env: LicenseWorkerEnv,
  store: LicenseStore,
  url: URL
): Promise<Response> {
  const key = contractStorageKey(url);
  if (key === null) {
    return new Response("invalid contract key", { status: 400 });
  }
  if (!isRegistryAuthorized(request, env)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (url.pathname === "/contracts" && request.method === "GET") {
    const stored = await store.get(key);
    return stored === null ? jsonResponse({ found: false }, 404) : jsonResponse(JSON.parse(stored));
  }
  if (url.pathname === "/contracts" && request.method === "PUT") {
    const contract = await readContract(request);
    if (contract === null) {
      return new Response("invalid contract", { status: 400 });
    }
    await store.put(key, JSON.stringify(contract));
    return jsonResponse({ stored: true });
  }
  return new Response("method not allowed", { status: 405 });
}

function contractStorageKey(url: URL): string | null {
  const repo = url.searchParams.get("repo") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!(isValidRepo(repo) && isValidRegistryName(name))) {
    return null;
  }
  return `contract:${repo}:${name}`;
}

function isRegistryAuthorized(request: Request, env: LicenseWorkerEnv): boolean {
  const token = env.CONTRACT_REGISTRY_TOKEN;
  return token.length > 0 && request.headers.get("authorization") === `Bearer ${token}`;
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

function isSchemaContract(value: unknown): boolean {
  const root = asRecord(value);
  if (root === null || Object.keys(root).length !== 1) {
    return false;
  }
  const schemas = asRecord(root.schemas);
  return schemas !== null && Object.values(schemas).every(isSchemaContractEntry);
}

function isSchemaContractEntry(value: unknown): boolean {
  const entry = asRecord(value);
  return (
    entry !== null &&
    Object.keys(entry).length === 2 &&
    Array.isArray(entry.enums) &&
    Array.isArray(entry.tables) &&
    entry.enums.every(isSchemaContractEnum) &&
    entry.tables.every(isSchemaContractTable)
  );
}

function isSchemaContractEnum(value: unknown): boolean {
  const entry = asRecord(value);
  return (
    entry !== null &&
    Object.keys(entry).length === 2 &&
    typeof entry.name === "string" &&
    Array.isArray(entry.values) &&
    entry.values.every((item) => typeof item === "string")
  );
}

function isSchemaContractTable(value: unknown): boolean {
  const entry = asRecord(value);
  return (
    entry !== null &&
    typeof entry.name === "string" &&
    Array.isArray(entry.columns) &&
    Array.isArray(entry.relationships) &&
    Array.isArray(entry.uniqueColumnSets)
  );
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
  store: LicenseStore,
  nowSeconds: number,
  stripeFetch: StripeFetch
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/checkout") {
    return handleCheckout(request, env, url, stripeFetch);
  }
  if (url.pathname === "/contracts") {
    return handleContractRegistry(request, env, store, url);
  }
  if (url.pathname === "/webhook") {
    return handleWebhook(request, env, store, nowSeconds);
  }
  if (url.pathname === "/license" && request.method === "GET") {
    return handleLicenseRetrieval(url, store);
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

const worker = {
  fetch(request: Request, env: LicenseWorkerEnv): Promise<Response> {
    return handleLicenseWorker(
      request,
      env,
      env.LICENSE_KV,
      Math.floor(Date.now() / 1000),
      fetch as unknown as StripeFetch
    );
  },
};

export default worker;
