import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import {
  isManagedSchemaOverlay,
  overlayRetainedSchemas,
  retainCatalogOverlayObjects,
} from "../../src/sql/ownership.js";
import { makeObject } from "../../src/sql/statements.js";

const config = resolveConfig({
  managedSchemas: ["auth"],
  managedSchemaOverlays: ["policy:auth.select_own:accounts"],
  schemas: { exclude: ["auth"], include: [] },
});

describe("overlayRetainedSchemas", () => {
  it("retains excluded managed schemas that carry configured overlays", () => {
    expect(overlayRetainedSchemas(config)).toEqual(["auth"]);
  });

  it("retains managed schemas omitted from a non-empty include filter", () => {
    expect(
      overlayRetainedSchemas(
        resolveConfig({
          managedSchemas: ["auth"],
          managedSchemaOverlays: ["policy:auth.select_own:accounts"],
          schemas: { exclude: [], include: ["public"] },
        })
      )
    ).toEqual(["auth"]);
  });

  it("keeps SQL exclusion when no overlays are configured", () => {
    expect(
      overlayRetainedSchemas(
        resolveConfig({ managedSchemas: ["auth"], schemas: { exclude: ["auth"], include: [] } })
      )
    ).toEqual([]);
  });
});

describe("retainCatalogOverlayObjects", () => {
  const overlayPolicy = makeObject(
    { kind: "policy", name: "select_own", schema: "auth", table: "accounts" },
    "CREATE POLICY select_own ON auth.accounts",
    0
  );
  const table = makeObject(
    { kind: "table", name: "accounts", schema: "auth" },
    "CREATE TABLE auth.accounts (id bigint)",
    1
  );

  it("keeps configured overlay objects and drops other objects in the retained schema", () => {
    expect(isManagedSchemaOverlay(overlayPolicy, config)).toBe(true);
    const retained = retainCatalogOverlayObjects([overlayPolicy, table], ["auth"], config);
    expect(retained).toEqual([overlayPolicy]);
  });

  it("returns objects unchanged when no schema is retained", () => {
    expect(retainCatalogOverlayObjects([table], [], config)).toEqual([table]);
  });
});
