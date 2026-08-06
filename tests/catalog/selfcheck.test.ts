import { describe, expect, it } from "vitest";
import { selfCheckCatalogModel } from "../../src/catalog/selfcheck.js";
import { fingerprintObjects } from "../../src/hash.js";
import { finalizeObject } from "../../src/sql/facts.js";
import { rlsStateSql } from "../../src/sql/rls.js";
import { makeObject } from "../../src/sql/statements.js";
import type { Diagnostic } from "../../src/types.js";

describe("catalog selfcheck failure handling", () => {
  it("stops after catalog extraction errors without parsing an empty script", async () => {
    const extractionError: Diagnostic = {
      code: "SUPA_CATALOG_EXTRACT_FAILED",
      message: "catalog unavailable",
      severity: "error",
    };
    const result = await selfCheckCatalogModel({
      diagnostics: [extractionError],
      fingerprint: fingerprintObjects([]),
      objects: [],
      source: "selfcheck",
    });

    expect(result).toEqual({
      checkedObjects: 0,
      diagnostics: [extractionError],
      mismatches: 0,
    });
    expect(result.diagnostics.map((item) => item.code)).not.toContain("SUPA_PARSE_ERROR");
  });

  it("normalizes multi-statement RLS state before comparing catalog parity", async () => {
    const state = { rlsEnabled: true, rlsForced: true };
    const object = makeObject(
      { kind: "rls", name: "accounts", schema: "app", table: "accounts" },
      rlsStateSql("app", "accounts", state),
      0,
      undefined,
      state
    );
    await finalizeObject(object);

    const result = await selfCheckCatalogModel({
      diagnostics: [],
      fingerprint: fingerprintObjects([object]),
      objects: [object],
      source: "selfcheck",
    });

    expect(result).toMatchObject({ checkedObjects: 1, mismatches: 0 });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("preserves multiline constraint literals during parity extraction", async () => {
    const sql = `ALTER TABLE ONLY "app"."accounts" ADD CONSTRAINT "accounts_payload" CHECK (validate('{
  "type": "object"
}'::json))`;
    const object = makeObject(
      { kind: "constraint", name: "accounts_payload", schema: "app", table: "accounts" },
      sql,
      0,
      undefined,
      { constraintColumns: [], constraintType: "CONSTR_CHECK" }
    );
    await finalizeObject(object);

    const result = await selfCheckCatalogModel({
      diagnostics: [],
      fingerprint: fingerprintObjects([object]),
      objects: [object],
      source: "selfcheck",
    });

    expect(result).toMatchObject({ checkedObjects: 1, mismatches: 0 });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});
