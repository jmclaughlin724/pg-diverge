import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOAuthState,
  exchangeOAuthCode,
  type GitHubFetch,
  verifyOAuthState,
  verifyRepoOwnership,
} from "../../services/license-worker/src/github-oauth.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const nowSeconds = 1_800_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fetchRouter(routes: Record<string, (init?: RequestInit) => Response>): GitHubFetch {
  return (input, init) => {
    const handler = routes[input];
    if (handler === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(handler(init));
  };
}

describe("oauth state tokens", () => {
  it("round-trips a signed state with repo and plan", () => {
    const token = createOAuthState("acme/app", "bundle", nowSeconds, privateKey);
    expect(verifyOAuthState(token, publicKeyPem, nowSeconds + 1)).toEqual({
      plan: "bundle",
      repo: "acme/app",
    });
  });

  it("rejects tampered and expired state", () => {
    const token = createOAuthState("acme/app", "bundle", nowSeconds, privateKey);
    const [head, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
    claims.repo = "victim/repo";
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    expect(verifyOAuthState(forged, publicKeyPem, nowSeconds + 1)).toBeNull();
    expect(verifyOAuthState(token, publicKeyPem, nowSeconds + 601)).toBeNull();
  });
});

describe("exchangeOAuthCode", () => {
  it("returns the access token on success and null on failure", async () => {
    const okFetch = fetchRouter({
      "https://github.com/login/oauth/access_token": () =>
        jsonResponse({ access_token: "gho_test" }),
    });
    await expect(exchangeOAuthCode(okFetch, "id", "secret", "code")).resolves.toBe("gho_test");

    const badFetch = fetchRouter({
      "https://github.com/login/oauth/access_token": () =>
        jsonResponse({ error: "bad_verification_code" }, 200),
    });
    await expect(exchangeOAuthCode(badFetch, "id", "secret", "code")).resolves.toBeNull();

    const failFetch: GitHubFetch = () => Promise.resolve(new Response("down", { status: 502 }));
    await expect(exchangeOAuthCode(failFetch, "id", "secret", "code")).resolves.toBeNull();
  });
});

describe("verifyRepoOwnership", () => {
  function gitHubFetch(permission: string): GitHubFetch {
    return fetchRouter({
      "https://github.com/login/oauth/access_token": () =>
        jsonResponse({ access_token: "gho_test" }),
      "https://api.github.com/user": () => jsonResponse({ login: "buyer" }),
      "https://api.github.com/repos/acme/app/collaborators/buyer/permission": () =>
        jsonResponse({ permission }),
    });
  }

  it("accepts admin, maintain-equivalent write roles and denies others", async () => {
    const state = { plan: "bundle", repo: "acme/app" };
    await expect(
      verifyRepoOwnership(gitHubFetch("admin"), "id", "secret", "code", state)
    ).resolves.toEqual({
      login: "buyer",
      ok: true,
      plan: "bundle",
      repo: "acme/app",
    });
    await expect(
      verifyRepoOwnership(gitHubFetch("write"), "id", "secret", "code", state)
    ).resolves.toMatchObject({
      ok: true,
    });
    for (const denied of ["read", "none", "triage"]) {
      const result = await verifyRepoOwnership(gitHubFetch(denied), "id", "secret", "code", state);
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("blocks the cross-tenant case: authenticated buyer targets another tenant's repo", async () => {
    const fetchImpl = fetchRouter({
      "https://github.com/login/oauth/access_token": () =>
        jsonResponse({ access_token: "gho_test" }),
      "https://api.github.com/user": () => jsonResponse({ login: "buyer" }),
      "https://api.github.com/repos/victim/repo/collaborators/buyer/permission": () =>
        new Response("not found", { status: 404 }),
    });
    const result = await verifyRepoOwnership(fetchImpl, "id", "secret", "code", {
      plan: "bundle",
      repo: "victim/repo",
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
