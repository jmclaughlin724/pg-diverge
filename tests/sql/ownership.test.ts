import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import { objectSchema } from "../../src/sql/dependents.js";
import {
  isManagedSchemaOverlay,
  overlayRetainedSchemas,
  retainCatalogOverlayObjects,
} from "../../src/sql/ownership.js";
import { buildCommentObject } from "../../src/sql/privileges.js";
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

describe("isManagedSchemaOverlay key shapes", () => {
  it("matches configured comment keys with or without the table suffix", () => {
    const tableComment = makeObject(
      { kind: "comment", name: "abcd1234efgh5678", schema: "auth", table: "accounts" },
      "COMMENT ON COLUMN auth.accounts.id IS 'x'",
      0,
      undefined,
      {
        commentTarget: { kind: "column", name: "id", schema: "auth", table: "accounts" },
        description: "x",
      }
    );
    const legacyConfig = resolveConfig({
      managedSchemas: ["auth"],
      managedSchemaOverlays: ["comment:auth.abcd1234efgh5678"],
      schemas: { exclude: [], include: [] },
    });
    const suffixedConfig = resolveConfig({
      managedSchemas: ["auth"],
      managedSchemaOverlays: [tableComment.key],
      schemas: { exclude: [], include: [] },
    });
    expect(isManagedSchemaOverlay(tableComment, legacyConfig)).toBe(true);
    expect(isManagedSchemaOverlay(tableComment, suffixedConfig)).toBe(true);
  });

  it("classifies extension comments by their metadata schema", () => {
    const extensionComment = makeObject(
      { kind: "comment", name: "feed0beef00dbabe", schema: "auth" },
      "COMMENT ON EXTENSION pgcrypto IS 'crypto'",
      0,
      undefined,
      {
        commentTarget: { kind: "extension", name: "pgcrypto" },
        description: "crypto",
        schema: "auth",
      }
    );
    const retained = retainCatalogOverlayObjects([extensionComment], ["auth"], config);
    expect(retained).toEqual([]);
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

  it("classifies extension comments by their real schema instead of public", () => {
    const extensionComment = buildCommentObject({
      description: "ext docs",
      ordinal: 2,
      sql: "COMMENT ON EXTENSION pg_trgm IS 'ext docs'",
      target: { kind: "extension", name: "pg_trgm" },
    });
    extensionComment.metadata.schema = "auth";

    expect(objectSchema(extensionComment)).toBe("auth");
    const retained = retainCatalogOverlayObjects(
      [overlayPolicy, extensionComment],
      ["auth"],
      config
    );
    expect(retained).toEqual([overlayPolicy]);
  });

  it("matches configured overlays for table-scoped comment keys", () => {
    const columnComment = buildCommentObject({
      description: "contact",
      ordinal: 2,
      sql: "COMMENT ON COLUMN auth.accounts.email IS 'contact'",
      target: { kind: "column", name: "email", schema: "auth", table: "accounts" },
    });
    const overlayConfig = resolveConfig({
      managedSchemas: ["auth"],
      managedSchemaOverlays: [columnComment.key],
      schemas: { exclude: ["auth"], include: [] },
    });

    expect(columnComment.key).not.toContain(":accounts");
    expect(isManagedSchemaOverlay(columnComment, overlayConfig)).toBe(true);
  });
});
