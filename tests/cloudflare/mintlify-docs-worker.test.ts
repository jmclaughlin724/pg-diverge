import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../cloudflare/mintlify-docs-worker.js";

function proxiedUrls(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mintlify docs worker", () => {
  it("proxies well-known verification paths to the docs origin instead of looping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok")))
    );

    await worker.fetch(
      new Request("https://supaschema.com/.well-known/acme-challenge/token-123"),
      {}
    );

    expect(proxiedUrls()).toEqual([
      "https://supaschema.mintlify.dev/.well-known/acme-challenge/token-123",
    ]);
  });

  it("proxies agent discovery paths to the docs origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok")))
    );

    await worker.fetch(new Request("https://supaschema.com/.well-known/mcp"), {});

    expect(proxiedUrls()).toEqual(["https://supaschema.mintlify.dev/.well-known/mcp"]);
  });
});
