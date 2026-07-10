import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import type { Diagnostic, SchemaModel, SchemaObject } from "../../src/core.js";
import { aggregateScanReportFiles, parseScanAggregateArgs } from "../../src/scan/aggregate.js";
import { scanGeneratedContractUsage } from "../../src/scan/generated-contracts.js";
import {
  aggregateOptInScanReports,
  isScanJsonReport,
  renderScan,
  scanBadge,
  scanDiagnostics,
  scanJsonReport,
  scanModel,
  scoreGrade,
} from "../../src/scan/model.js";
import { hygienePack } from "../../src/scan/rules.js";

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
    expect(isScanJsonReport(parsed)).toBe(true);
  });

  it("renders source-file diagnostics through grouped reporters", () => {
    const result = scanDiagnostics([
      {
        code: "SUPA_SCAN_CONTRACT_IMPORT_RENAME",
        file: "src/app.ts",
        message: "generated contract import was renamed",
        severity: "warning",
      },
    ]);

    expect(renderScan(result, "github", "database/schemas")).toContain(
      "::warning file=src/app.ts,title=SUPA_SCAN_CONTRACT_IMPORT_RENAME::"
    );
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

  it("aggregates scan report files through the compiled command owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supa-scan-aggregate-"));
    const input = join(directory, "scan.json");
    await writeFile(
      input,
      `${JSON.stringify(
        scanJsonReport(
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
          "schema.sql"
        )
      )}\n`
    );

    const aggregate = await aggregateScanReportFiles({
      generatedAt: "2026-06-18T00:00:00Z",
      inputs: [input],
    });

    const parsed = JSON.parse(aggregate);
    expect(parsed).toMatchObject({
      averageScore: 97,
      generatedAt: "2026-06-18T00:00:00Z",
      gradeCounts: { A: 1, B: 0, C: 0, D: 0, F: 0 },
      sampleCount: 1,
    });
  });

  it("parses aggregate command options", () => {
    expect(
      parseScanAggregateArgs(["--generated-at", "now", "--out", "out.json", "scan.json"])
    ).toEqual({
      generatedAt: "now",
      inputs: ["scan.json"],
      out: "out.json",
    });
    expect(() => parseScanAggregateArgs([])).toThrow("provide at least one scan JSON report");
    expect(() => parseScanAggregateArgs(["--out"])).toThrow("--out requires a value");
  });
});

describe("generated contract usage scan", () => {
  it("reports high-signal generated-contract misuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-contract-usage-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "database.types.ts"), "export const Constants = {};\n");
    await writeFile(join(root, "database.zod.ts"), "export const Tables = {};\n");
    await writeFile(
      join(root, "src", "app.ts"),
      [
        'import { Constants as DatabaseConstants } from "../database.types";',
        'import { Tables } from "../database.zod";',
        "const loanStatuses = DatabaseConstants.public.Enums.loan_status;",
        "const loanTable = Tables.public.loans;",
        "const typed = {} as { id: string };",
        'supabase.from("loans").select("*").overrideTypes<{ id: string }>();',
        'supabase.rpc("calculate").returns<string>();',
        "void loanStatuses;",
        "void loanTable;",
        "void typed;",
      ].join("\n")
    );

    const diagnostics = await scanGeneratedContractUsage({
      config: resolveConfig({ typesFile: "database.types.ts", zodFile: "database.zod.ts" }),
      cwd: root,
      root: "src",
    });

    expect(diagnostics.map((item) => item.code).sort()).toEqual([
      "SUPA_SCAN_CONTRACT_ASSERTION",
      "SUPA_SCAN_CONTRACT_IMPORT_RENAME",
      "SUPA_SCAN_CONTRACT_OVERRIDE_TYPES",
      "SUPA_SCAN_CONTRACT_RETURNS",
      "SUPA_SCAN_CONTRACT_RUNTIME_COPY",
      "SUPA_SCAN_CONTRACT_RUNTIME_COPY",
    ]);
    expect(diagnostics.every((item) => item.file === "src/app.ts")).toBe(true);
  });

  it("ignores files that do not import generated contracts", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-contract-ignore-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "app.ts"), "const typed = {} as { id: string };\n");

    const diagnostics = await scanGeneratedContractUsage({
      config: resolveConfig({ typesFile: "database.types.ts", zodFile: "database.zod.ts" }),
      cwd: root,
      root: "src",
    });

    expect(diagnostics).toEqual([]);
  });
});
