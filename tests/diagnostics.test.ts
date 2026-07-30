import { describe, expect, it } from "vitest";
import { diagnosticCatalog, diagnosticDefinitions } from "../src/diagnostics/catalog.js";

describe("structured diagnostic catalog", () => {
  it("keeps the summary catalog derived from structured definitions", () => {
    for (const [code, definition] of Object.entries(diagnosticDefinitions)) {
      expect(diagnosticCatalog[code]).toBe(definition.summary);
    }
  });

  it("ships a complete generated-artifact recovery procedure", () => {
    expect(diagnosticDefinitions.SUPA_GENERATED_ARTIFACT_EDIT).toMatchObject({
      commands: expect.arrayContaining(["supaschema doctor", "supaschema sync"]),
      forbiddenActions: expect.arrayContaining([
        "do not manually edit generated TypeScript or Zod contracts",
      ]),
      recoverySteps: expect.arrayContaining([
        expect.stringContaining("Change declarative schema SQL or generator configuration"),
      ]),
    });
  });

  it("ships fail-closed recovery when the generated-artifact hook cannot classify a write", () => {
    expect(diagnosticDefinitions.SUPA_GENERATED_ARTIFACT_GUARD_FAILED).toMatchObject({
      commands: expect.arrayContaining(["supaschema config validate", "supaschema doctor"]),
      forbiddenActions: expect.arrayContaining([
        "do not treat a classifier failure as permission to write",
      ]),
      recoverySteps: expect.arrayContaining([
        expect.stringContaining("repair the first reported config error"),
      ]),
    });
  });

  it("ships migration replay recovery without an unrelated fallback", () => {
    const definition = diagnosticDefinitions.SUPA_MIGRATION_BASELINE_REPLAY_REQUIRED;

    expect(definition?.recoverySteps).toEqual(
      expect.arrayContaining([expect.stringContaining("first replay diagnostic")])
    );
    expect(definition?.forbiddenActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("do not select empty: or an unrelated Git ref"),
        expect.stringContaining("do not edit generated migrations or generated types"),
      ])
    );
  });

  it("ships a rebuild-first recovery for stale dist builds", () => {
    expect(diagnosticDefinitions.SUPA_BUILD_STALE_DIST).toMatchObject({
      commands: expect.arrayContaining(["npm run build", "supaschema doctor"]),
      forbiddenActions: expect.arrayContaining([
        expect.stringContaining("do not suppress the warning"),
      ]),
      recoverySteps: expect.arrayContaining([expect.stringContaining("npm run build")]),
    });
  });

  it("ships a regenerate-first recovery for contract drift", () => {
    expect(diagnosticDefinitions.SUPA_TYPES_CONTRACT_DRIFT).toMatchObject({
      commands: expect.arrayContaining(["supaschema types", "supaschema types --check"]),
      forbiddenActions: expect.arrayContaining([
        expect.stringContaining("do not manually edit generated TypeScript or Zod contracts"),
      ]),
      recoverySteps: expect.arrayContaining([expect.stringContaining("supaschema types")]),
    });
  });
});
