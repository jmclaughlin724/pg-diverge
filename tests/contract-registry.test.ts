import { describe, expect, it } from "vitest";
import {
  contractRegistryUrl,
  pullContract,
  pushContract,
} from "../src/contract-registry-client.js";
import { contractDrift, type SchemaContract, toContract } from "../src/index.js";
import type { SchemaShapes, TableShape } from "../src/typegen-model.js";

const usersTable: TableShape = {
  columns: [{ name: "id", notNull: true, type: "number" }],
  name: "users",
  relationships: [],
  uniqueColumnSets: [],
};

function contract(tables: TableShape[]): SchemaContract {
  return { schemas: { public: { enums: [], tables } } };
}

describe("contract registry (X51)", () => {
  it("flags a removed table as cross-repo drift", () => {
    const drift = contractDrift(contract([usersTable]), contract([]));
    expect(drift).toHaveLength(1);
    expect(drift[0]?.code).toBe("SUPA_TYPE_TABLE_REMOVED");
  });

  it("reports no drift for an identical contract", () => {
    const stored = contract([usersTable]);
    expect(contractDrift(stored, stored)).toHaveLength(0);
  });

  it("projects shapes into a JSON-serializable contract", () => {
    const shapes: SchemaShapes = {
      compositesByBareName: new Map(),
      compositesByQualifiedName: new Map(),
      domains: new Map(),
      enumsByBareName: new Map(),
      enumsByQualifiedName: new Map(),
      schemas: new Map([
        ["public", { composites: [], enums: [], functions: [], tables: [usersTable], views: [] }],
      ]),
    };
    const projected = toContract(shapes);
    expect(JSON.stringify(projected)).toContain("users");
    expect(projected.schemas.public?.tables).toHaveLength(1);
  });

  it("builds a registry URL with repo and contract name query parameters", () => {
    expect(
      contractRegistryUrl({
        name: "main",
        registryUrl: "https://license.example/base",
        repo: "acme/app",
      })
    ).toBe("https://license.example/contracts?repo=acme%2Fapp&name=main");
  });

  it("pushes a contract with bearer authorization", async () => {
    const calls: {
      body: string | undefined;
      headers: HeadersInit | undefined;
      method: string;
      url: string;
    }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      calls.push({
        body: typeof init.body === "string" ? init.body : undefined,
        headers: init.headers,
        method: init.method ?? "GET",
        url,
      });
      return Promise.resolve(new Response(JSON.stringify({ stored: true }), { status: 200 }));
    };

    await pushContract({
      contract: contract([usersTable]),
      fetchImpl,
      license: "token",
      name: "main",
      registryUrl: "https://license.example",
      repo: "acme/app",
    });

    expect(calls).toEqual([
      {
        body: JSON.stringify(contract([usersTable])),
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        method: "PUT",
        url: "https://license.example/contracts?repo=acme%2Fapp&name=main",
      },
    ]);
  });

  it("pulls a contract with bearer authorization", async () => {
    const stored = contract([usersTable]);
    const calls: { headers: HeadersInit | undefined; method: string; url: string }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      calls.push({ headers: init.headers, method: init.method ?? "GET", url });
      return Promise.resolve(new Response(JSON.stringify(stored), { status: 200 }));
    };

    const pulled = await pullContract({
      fetchImpl,
      license: "token",
      name: "main",
      registryUrl: "https://license.example",
      repo: "acme/app",
    });

    expect(pulled).toEqual(stored);
    expect(calls).toEqual([
      {
        headers: { authorization: "Bearer token" },
        method: "GET",
        url: "https://license.example/contracts?repo=acme%2Fapp&name=main",
      },
    ]);
  });

  it("fails closed on registry errors", async () => {
    const fetchImpl = () => Promise.resolve(new Response("unauthorized", { status: 401 }));
    await expect(
      pullContract({
        fetchImpl,
        license: "token",
        name: "main",
        registryUrl: "https://license.example",
        repo: "acme/app",
      })
    ).rejects.toThrow("HTTP 401");
  });
});
