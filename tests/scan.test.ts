import { describe, expect, it } from "vitest";
import type { Diagnostic, SchemaModel, SchemaObject } from "../src/core.js";
import { hygienePack } from "../src/rules.js";
import { renderScan, scanBadge, scanModel, scoreGrade } from "../src/scan.js";

function tableObject(name: string): SchemaObject {
  return {
    dependencies: [],
    hash: "h",
    key: `public.${name}`,
    metadata: {},
    normalizedSql: "",
    ordinal: 0,
    ref: { kind: "table", name, schema: "public" },
    sql: "",
  };
}

function model(objects: SchemaObject[], diagnostics: Diagnostic[] = []): SchemaModel {
  return { diagnostics, fingerprint: "f", objects, source: "test" };
}

describe("scan core (K0)", () => {
  it("scores a clean model 100 / grade A", () => {
    const result = scanModel(model([tableObject("good_name")]), [hygienePack]);
    expect(result.score).toBe(100);
    expect(result.warningCount).toBe(0);
    expect(scoreGrade(result.score)).toBe("A");
  });

  it("lowers the score for each warning", () => {
    const result = scanModel(model([tableObject("BadName"), tableObject("AlsoBad")]), [
      hygienePack,
    ]);
    expect(result.warningCount).toBe(2);
    expect(result.score).toBe(94); // 100 - 2*3
    expect(result.diagnostics).toHaveLength(2);
  });

  it("includes extraction diagnostics in the score and error count", () => {
    const result = scanModel(
      model(
        [],
        [
          {
            code: "SUPA_EXTRACT_UNSUPPORTED",
            message: "unsupported statement",
            severity: "error",
          },
        ]
      ),
      [hygienePack]
    );
    expect(result.errorCount).toBe(1);
    expect(result.score).toBe(90);
    expect(result.diagnostics[0]?.code).toBe("SUPA_EXTRACT_UNSUPPORTED");
  });

  it("never returns a negative score", () => {
    const objects = Array.from({ length: 50 }, (_, index) => tableObject(`Bad${index}`));
    const result = scanModel(model(objects), [hygienePack]);
    expect(result.score).toBe(0);
  });

  it("renders the scan through the existing reporter", () => {
    const result = scanModel(model([tableObject("BadName")]), [hygienePack]);
    expect(renderScan(result, "json", "schema.sql")).toContain("SUPA_RULE_TABLE_NAMING");
  });

  it("maps grades across the band", () => {
    expect(scoreGrade(95)).toBe("A");
    expect(scoreGrade(85)).toBe("B");
    expect(scoreGrade(75)).toBe("C");
    expect(scoreGrade(65)).toBe("D");
    expect(scoreGrade(10)).toBe("F");
  });

  it("renders a valid SVG badge for a clean score", () => {
    const badge = scanBadge({ diagnostics: [], errorCount: 0, score: 100, warningCount: 0 });
    expect(badge.startsWith("<svg")).toBe(true);
    expect(badge.endsWith("</svg>")).toBe(true);
    expect(badge).toContain("100/100 A");
    expect(badge).toContain("#3fb950");
  });

  it("colors a failing score red", () => {
    const badge = scanBadge({ diagnostics: [], errorCount: 10, score: 0, warningCount: 0 });
    expect(badge).toContain("0/100 F");
    expect(badge).toContain("#e05d44");
  });
});
