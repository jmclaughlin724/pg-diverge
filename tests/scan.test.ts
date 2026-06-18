import { describe, expect, it } from "vitest";
import type { Diagnostic, SchemaModel, SchemaObject } from "../src/core.js";
import { hygienePack } from "../src/rules.js";
import {
  aggregateOptInScanReports,
  renderScan,
  scanBadge,
  scanJsonReport,
  scanModel,
  scoreGrade,
} from "../src/scan.js";

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
    expect(result.score).toBe(94);
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
    const parsed = JSON.parse(renderScan(result, "json", "schema.sql"));
    expect(parsed.file).toBe("schema.sql");
    expect(parsed.score).toBe(97);
    expect(parsed.grade).toBe("A");
    expect(parsed.diagnostics[0]?.code).toBe("SUPA_RULE_TABLE_NAMING");
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

  it("aggregates opt-in scan reports without retaining source filenames", () => {
    const clean = scanJsonReport(
      { diagnostics: [], errorCount: 0, score: 100, warningCount: 0 },
      "customer-a/schema.sql"
    );
    const warning = scanJsonReport(
      {
        diagnostics: [
          {
            code: "SUPA_RULE_TABLE_NAMING",
            message: "table name should be snake_case",
            severity: "warning",
          },
        ],
        errorCount: 0,
        score: 97,
        warningCount: 1,
      },
      "customer-b/schema.sql"
    );
    const error = scanJsonReport(
      {
        diagnostics: [
          {
            code: "SUPA_RULE_TABLE_NAMING",
            message: "table name should be snake_case",
            severity: "warning",
          },
          {
            code: "SUPA_EXTRACT_UNSUPPORTED",
            message: "unsupported statement",
            severity: "error",
          },
        ],
        errorCount: 1,
        score: 87,
        warningCount: 1,
      },
      "customer-c/schema.sql"
    );

    const aggregate = aggregateOptInScanReports([clean, warning, error], "2026-06-18T00:00:00Z");

    expect(aggregate).toEqual({
      averageScore: (100 + 97 + 87) / 3,
      diagnosticCounts: [
        { code: "SUPA_RULE_TABLE_NAMING", count: 2, severity: "warning" },
        { code: "SUPA_EXTRACT_UNSUPPORTED", count: 1, severity: "error" },
      ],
      generatedAt: "2026-06-18T00:00:00Z",
      gradeCounts: { A: 2, B: 1, C: 0, D: 0, F: 0 },
      maxScore: 100,
      medianScore: 97,
      minScore: 87,
      sampleCount: 3,
    });
    expect(JSON.stringify(aggregate)).not.toContain("customer-");
  });

  it("rejects an aggregate with no opt-in reports", () => {
    expect(() => aggregateOptInScanReports([], "2026-06-18T00:00:00Z")).toThrow(
      "aggregate requires at least one opt-in scan report"
    );
  });
});
