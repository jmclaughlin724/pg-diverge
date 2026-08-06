import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "../..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a TOML table`);
  }
  return value;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};

describe("license Worker deployment config", () => {
  it("wires the checkout success page to the configured Worker custom domain", () => {
    const configPath = join(repositoryRoot, "services/license-worker/wrangler.toml");
    const config = requireRecord(parseToml(readFileSync(configPath, "utf8")), "Wrangler config");
    const variables = requireRecord(config.vars, "Wrangler vars");
    const successUrl = new URL(
      requireString(variables.CHECKOUT_SUCCESS_URL, "CHECKOUT_SUCCESS_URL")
    );
    const routes = config.routes;
    if (!Array.isArray(routes)) {
      throw new TypeError("Wrangler routes must be an array");
    }
    const customDomain = routes
      .map((route) => requireRecord(route, "Wrangler route"))
      .find((route) => route.custom_domain === true);
    const workerOrigin = `https://${requireString(customDomain?.pattern, "custom-domain pattern")}`;
    const successPagePath = join(
      repositoryRoot,
      "docs/pages",
      `${successUrl.pathname.slice(1)}.astro`
    );
    const successPage = readFileSync(successPagePath, "utf8");

    expect(successPage).toContain(`const LICENSE_ENDPOINT = "${workerOrigin}/license";`);
    expect(successPage).toContain('endpoint.searchParams.set("session_id", sessionId);');
    expect(successPage).toContain("await fetch(endpoint");
    expect(successPage).toContain("window.history.replaceState(");
    expect(successPage.indexOf("window.history.replaceState(")).toBeLessThan(
      successPage.indexOf("await fetch(endpoint")
    );
    expect(successPage).not.toContain("analytics={data.config.analytics}");
    expect(successPage).toContain("const abortController = new AbortController();");
    expect(successPage).toContain("signal: abortController.signal");
    expect(successPage.indexOf("if (!response.ok)")).toBeLessThan(
      successPage.lastIndexOf("await readResponse(response)")
    );
    expect(successPage).toContain("noindex");
  });

  it("provisions SQLite coordinators for renewals and one-time OAuth states", () => {
    const config = requireRecord(
      parseToml(
        readFileSync(join(repositoryRoot, "services/license-worker/wrangler.toml"), "utf8")
      ),
      "Wrangler config"
    );
    const durableObjects = requireRecord(config.durable_objects, "durable_objects");
    if (!Array.isArray(durableObjects.bindings)) {
      throw new TypeError("durable_objects.bindings must be an array");
    }
    expect(durableObjects.bindings).toEqual(
      expect.arrayContaining([
        { class_name: "OAuthStateCoordinator", name: "OAUTH_STATES" },
        {
          class_name: "SubscriptionRenewalCoordinator",
          name: "SUBSCRIPTION_RENEWALS",
        },
      ])
    );
    const exports = requireRecord(config.exports, "exports");
    expect(exports.OAuthStateCoordinator).toEqual({
      storage: "sqlite",
      type: "durable-object",
    });
    expect(exports.SubscriptionRenewalCoordinator).toEqual({
      storage: "sqlite",
      type: "durable-object",
    });
  });
});
