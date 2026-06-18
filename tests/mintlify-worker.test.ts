import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../cloudflare/mintlify-docs-worker.js";

const originalFetch = globalThis.fetch;

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
    const fetchMock = vi.fn((request: Request) =>
      Promise.resolve(
        new Response("ok", {
          headers: { "x-upstream-host": request.headers.get("Host") ?? "" },
        })
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await worker.fetch(new Request(`https://supaschema.com${pathname}`));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(new URL(request.url).hostname).toBe("supaschema.mintlify.dev");
    expect(request.headers.get("Host")).toBe("supaschema.mintlify.dev");
  });

  it("passes unrelated well-known paths through unchanged", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock as typeof fetch;

    await worker.fetch(new Request("https://supaschema.com/.well-known/acme-challenge/token"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toBe("https://supaschema.com/.well-known/acme-challenge/token");
  });

  it("rewrites Mintlify origin redirects to the custom domain", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(Response.redirect("https://supaschema.mintlify.dev/docs/quickstart", 302))
    ) as typeof fetch;

    const response = await worker.fetch(new Request("https://supaschema.com/docs"));

    expect(response.headers.get("Location")).toBe("https://supaschema.com/docs/quickstart");
  });

  it("redirects the www apex to the bare custom domain with a 308", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await worker.fetch(new Request("https://www.supaschema.com/docs/quickstart"));

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://supaschema.com/docs/quickstart");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the CF-Connecting-IP header to the origin", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock as typeof fetch;

    await worker.fetch(
      new Request("https://supaschema.com/docs", {
        headers: { "CF-Connecting-IP": "203.0.113.7" },
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
  });

  it("returns a 502 when the origin fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("origin down"))) as typeof fetch;

    const response = await worker.fetch(new Request("https://supaschema.com/docs"));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Bad Gateway");
  });
});
