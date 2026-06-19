import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../cloudflare/mintlify-docs-worker.js";

const originalFetch = globalThis.fetch;

function setFetchMock(implementation: typeof fetch) {
  const fetchMock = vi.fn(implementation);
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function firstFetchRequest(fetchMock: ReturnType<typeof setFetchMock>): Request {
  const call = fetchMock.mock.calls[0];
  if (call === undefined) {
    throw new Error("fetch call missing");
  }
  const [input, init] = call;
  return input instanceof Request ? input : new Request(input, init);
}

describe("Mintlify docs worker", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    "/.well-known/mcp",
    "/.well-known/mcp.json",
    "/.well-known/mcp/server-card.json",
    "/.well-known/skills/index.json",
    "/.well-known/agent-skills/index.json",
  ])("proxies Mintlify agent discovery path %s", async (pathname) => {
    const fetchMock = setFetchMock((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return Promise.resolve(
        new Response("ok", {
          headers: { "x-upstream-host": request.headers.get("Host") ?? "" },
        })
      );
    });

    const response = await worker.fetch(new Request(`https://supaschema.com${pathname}`));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = firstFetchRequest(fetchMock);
    expect(new URL(request.url).hostname).toBe("supaschema.mintlify.dev");
    expect(request.headers.get("Host")).toBe("supaschema.mintlify.dev");
  });

  it("passes unrelated well-known paths through unchanged", async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response("ok")));

    await worker.fetch(new Request("https://supaschema.com/.well-known/acme-challenge/token"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = firstFetchRequest(fetchMock);
    expect(request.url).toBe("https://supaschema.com/.well-known/acme-challenge/token");
  });

  it("rewrites Mintlify origin redirects to the custom domain", async () => {
    setFetchMock(() =>
      Promise.resolve(Response.redirect("https://supaschema.mintlify.dev/docs/quickstart", 302))
    );

    const response = await worker.fetch(new Request("https://supaschema.com/docs"));

    expect(response.headers.get("Location")).toBe("https://supaschema.com/docs/quickstart");
  });

  it("redirects the www apex to the bare custom domain with a 308", async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response("unexpected")));

    const response = await worker.fetch(new Request("https://www.supaschema.com/docs/quickstart"));

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://supaschema.com/docs/quickstart");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the CF-Connecting-IP header to the origin", async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response("ok")));

    await worker.fetch(
      new Request("https://supaschema.com/docs", {
        headers: { "CF-Connecting-IP": "203.0.113.7" },
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = firstFetchRequest(fetchMock);
    expect(request.headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
  });

  it("returns a 502 when the origin fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setFetchMock(() => Promise.reject(new Error("origin down")));

    const response = await worker.fetch(new Request("https://supaschema.com/docs"));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Bad Gateway");
  });
});
