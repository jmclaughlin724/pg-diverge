import { describe, expect, it } from "vitest";
import { contractDrift } from "../src/contract-registry.js";
import { validateIntake } from "../src/intake.js";
import type { SchemaContract } from "../src/schema-contract.js";

const SECRET_URL = ["postgres://svc:", "s3cr3t", "@db.internal/app"].join("");
const SECRET_KV = ["pass", "word=", "p4ssval"].join("");

const REQUIRE_SCHEMAS = { label: "contract", requiredKeys: ["schemas"] };

describe("intake validator (S1)", () => {
  it("accepts a well-formed payload with the required scope", () => {
    expect(validateIntake({ schemas: {} }, REQUIRE_SCHEMAS)).toEqual([]);
  });

  it("rejects a non-object payload as malformed", () => {
    for (const bad of ["a string", 42, true, null, ["array"]]) {
      const diagnostics = validateIntake(bad, REQUIRE_SCHEMAS);
      expect(diagnostics.map((d) => d.code)).toContain("SUPA_INTAKE_MALFORMED");
    }
  });

  it("flags a missing required scope key", () => {
    const diagnostics = validateIntake({ other: 1 }, REQUIRE_SCHEMAS);
    expect(diagnostics.map((d) => d.code)).toContain("SUPA_INTAKE_MISSING_SCOPE");
  });

  it("does not treat an inherited key as present (uses own-property check)", () => {
    const diagnostics = validateIntake({}, { label: "x", requiredKeys: ["toString"] });
    expect(diagnostics.map((d) => d.code)).toContain("SUPA_INTAKE_MISSING_SCOPE");
  });

  it("detects a secret in a nested string value", () => {
    const payload = { schemas: { public: { detail: SECRET_URL } } };
    expect(validateIntake(payload, REQUIRE_SCHEMAS).map((d) => d.code)).toContain(
      "SUPA_INTAKE_SECRET"
    );
  });

  it("detects a secret inside an array value", () => {
    const payload = { schemas: { values: ["ok", SECRET_KV] } };
    expect(validateIntake(payload, REQUIRE_SCHEMAS).map((d) => d.code)).toContain(
      "SUPA_INTAKE_SECRET"
    );
  });

  it("detects a secret used as an object key", () => {
    const payload = { schemas: {}, [SECRET_KV]: "x" };
    expect(validateIntake(payload, REQUIRE_SCHEMAS).map((d) => d.code)).toContain(
      "SUPA_INTAKE_SECRET"
    );
  });

  it("never echoes the secret value into the diagnostic message", () => {
    const payload = { schemas: { detail: SECRET_URL } };
    const messages = validateIntake(payload, REQUIRE_SCHEMAS).map((d) => d.message);
    expect(messages.join(" ")).not.toContain("s3cr3t");
  });

  it("rejects pathologically deep nesting as malformed (fail closed)", () => {
    const root: Record<string, unknown> = { schemas: {} };
    let cursor = root;
    for (let i = 0; i < 70; i += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    expect(validateIntake(root, REQUIRE_SCHEMAS).map((d) => d.code)).toContain(
      "SUPA_INTAKE_MALFORMED"
    );
  });
});

describe("contractDrift intake gate (S1 × X51)", () => {
  const valid: SchemaContract = { schemas: { public: { enums: [], tables: [] } } };

  it("diffs two valid contracts (intake clean → no breaking change)", () => {
    expect(contractDrift(valid, valid)).toEqual([]);
  });

  it("fails closed on a secret-bearing contract instead of diffing", () => {
    const tainted = {
      schemas: { public: { enums: [{ name: "e", values: [SECRET_URL] }], tables: [] } },
    };
    const codes = contractDrift(valid, tainted).map((d) => d.code);
    expect(codes).toContain("SUPA_INTAKE_SECRET");

    expect(codes.some((c) => c.startsWith("SUPA_TYPE_"))).toBe(false);
  });

  it("fails closed on a malformed contract", () => {
    const codes = contractDrift(valid, null).map((d) => d.code);
    expect(codes).toContain("SUPA_INTAKE_MALFORMED");
  });

  it("fails closed when the contract shape is not usable for drift comparison", () => {
    const codes = contractDrift(valid, { schemas: { public: { enums: [], tables: [null] } } }).map(
      (d) => d.code
    );
    expect(codes).toContain("SUPA_INTAKE_MALFORMED");
  });
});
