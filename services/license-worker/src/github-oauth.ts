import { type KeyObject, randomBytes } from "node:crypto";
import { issueSignedToken, verifySignedToken } from "./signed-token.js";

const oauthStateTokenType = "SUPASCHEMA-OAUTH-STATE";

export type GitHubFetch = (
  input: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string }
) => Promise<Response>;

export interface OAuthStateClaims {
  expiresAt: number;
  nonce: string;
  plan: string;
  repo: string;
}

interface OAuthStateTokenClaims extends OAuthStateClaims {
  exp: number;
  purpose: "oauth-state";
}

export type VerifiedIdentity =
  | { login: string; ok: true; plan: string; repo: string }
  | { ok: false; reason: string; status: number };

const stateLifetimeSeconds = 600;
const permittedRoles = new Set(["admin", "write"]);

export function createOAuthState(
  repo: string,
  plan: string,
  nowSeconds: number,
  privateKey: KeyObject
): string {
  return issueSignedToken(
    oauthStateTokenType,
    {
      exp: nowSeconds + stateLifetimeSeconds,
      nonce: randomBytes(32).toString("base64url"),
      plan,
      purpose: "oauth-state",
      repo,
    },
    privateKey
  );
}

export function verifyOAuthState(
  token: string,
  publicKeyPem: string,
  nowSeconds: number
): OAuthStateClaims | null {
  const claims = verifySignedToken(token, oauthStateTokenType, publicKeyPem);
  if (!isOAuthStateTokenClaims(claims) || claims.exp <= nowSeconds) {
    return null;
  }
  return {
    expiresAt: claims.exp,
    nonce: claims.nonce,
    plan: claims.plan,
    repo: claims.repo,
  };
}

function isOAuthStateTokenClaims(value: unknown): value is OAuthStateTokenClaims {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "exp") === "number" &&
    typeof Reflect.get(value, "nonce") === "string" &&
    typeof Reflect.get(value, "plan") === "string" &&
    Reflect.get(value, "purpose") === "oauth-state" &&
    typeof Reflect.get(value, "repo") === "string"
  );
}

async function gitHubJson(
  fetchImpl: GitHubFetch,
  input: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string }
): Promise<{ json: unknown; status: number }> {
  const response = await fetchImpl(input, init);
  if (!response.ok) {
    return { json: null, status: response.status };
  }
  try {
    return { json: await response.json(), status: response.status };
  } catch {
    return { json: null, status: response.status };
  }
}

export async function exchangeOAuthCode(
  fetchImpl: GitHubFetch,
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string | null> {
  const { json, status } = await gitHubJson(
    fetchImpl,
    "https://github.com/login/oauth/access_token",
    {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }).toString(),
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }
  );
  if (status !== 200 || json === null || typeof json !== "object") {
    return null;
  }
  const token = Reflect.get(json, "access_token");
  return typeof token === "string" && token.length > 0 ? token : null;
}

async function fetchGitHubLogin(
  fetchImpl: GitHubFetch,
  accessToken: string
): Promise<string | null> {
  const { json, status } = await gitHubJson(fetchImpl, "https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}` },
  });
  if (status !== 200 || json === null || typeof json !== "object") {
    return null;
  }
  const login = Reflect.get(json, "login");
  return typeof login === "string" && login.length > 0 ? login : null;
}

async function repoPermission(
  fetchImpl: GitHubFetch,
  accessToken: string,
  repo: string,
  login: string
): Promise<boolean> {
  const { json, status } = await gitHubJson(
    fetchImpl,
    `https://api.github.com/repos/${repo}/collaborators/${login}/permission`,
    { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}` } }
  );
  if (status !== 200 || json === null || typeof json !== "object") {
    return false;
  }
  const permission = Reflect.get(json, "permission");
  return typeof permission === "string" && permittedRoles.has(permission);
}

export async function verifyRepoOwnership(
  fetchImpl: GitHubFetch,
  clientId: string,
  clientSecret: string,
  code: string,
  state: OAuthStateClaims
): Promise<VerifiedIdentity> {
  const accessToken = await exchangeOAuthCode(fetchImpl, clientId, clientSecret, code);
  if (accessToken === null) {
    return { ok: false, reason: "github oauth exchange failed", status: 502 };
  }
  const login = await fetchGitHubLogin(fetchImpl, accessToken);
  if (login === null) {
    return { ok: false, reason: "github user lookup failed", status: 502 };
  }
  const permitted = await repoPermission(fetchImpl, accessToken, state.repo, login);
  if (!permitted) {
    return { ok: false, reason: `${login} lacks write access to ${state.repo}`, status: 403 };
  }
  return { login, ok: true, plan: state.plan, repo: state.repo };
}
