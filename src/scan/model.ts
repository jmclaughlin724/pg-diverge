import { type CheckReporter, type FileDiagnostics, renderCheckReport } from "../check/report.js";
import { isDiagnostic } from "../diagnostics/diagnostics.js";
import type { Diagnostic, SchemaModel } from "../types.js";
import { type RulePack, runRulePacks } from "./rules.js";

export interface ScanResult {
  diagnostics: Diagnostic[];
  errorCount: number;

  score: number;
  warningCount: number;
}

const SCAN_GRADE_COUNTS = { A: 0, B: 0, C: 0, D: 0, F: 0 };

export type ScanGrade = keyof typeof SCAN_GRADE_COUNTS;

export interface ScanJsonReport extends ScanResult {
  file: string;
  grade: ScanGrade;
}

export interface ScanAggregateDiagnostic {
  code: string;
  count: number;
  severity: Diagnostic["severity"];
}

export interface ScanAggregateReport {
  averageScore: number;
  diagnosticCounts: ScanAggregateDiagnostic[];
  generatedAt: string;
  gradeCounts: Record<ScanJsonReport["grade"], number>;
  maxScore: number;
  medianScore: number;
  minScore: number;
  sampleCount: number;
}

const ERROR_WEIGHT = 10;
const WARNING_WEIGHT = 3;
const MAX_SCORE = 100;

export function scanModel(model: SchemaModel, packs: RulePack[]): ScanResult {
  const diagnostics = [...model.diagnostics, ...runRulePacks(packs, { model })];
  return scanDiagnostics(diagnostics);
}

export function scanDiagnostics(diagnostics: Diagnostic[]): ScanResult {
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, MAX_SCORE - errorCount * ERROR_WEIGHT - warningCount * WARNING_WEIGHT);
  return { diagnostics, errorCount, score, warningCount };
}

export function scoreGrade(score: number): ScanGrade {
  if (score >= 90) {
    return "A";
  }
  if (score >= 80) {
    return "B";
  }
  if (score >= 70) {
    return "C";
  }
  if (score >= 60) {
    return "D";
  }
  return "F";
}

export function isScanJsonReport(value: unknown): value is ScanJsonReport {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.file === "string" &&
    typeof value.score === "number" &&
    typeof value.errorCount === "number" &&
    typeof value.warningCount === "number" &&
    isScanGrade(value.grade) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDiagnostic)
  );
}

export function renderScan(result: ScanResult, reporter: CheckReporter, file: string): string {
  if (reporter === "json") {
    return `${JSON.stringify(scanJsonReport(result, file), null, 2)}\n`;
  }
  const files = scanFileDiagnostics(result, file);
  return renderCheckReport(reporter, files);
}

export function scanJsonReport(result: ScanResult, file: string): ScanJsonReport {
  return { ...result, file, grade: scoreGrade(result.score) };
}

export function aggregateOptInScanReports(
  reports: readonly ScanJsonReport[],
  generatedAt: string
): ScanAggregateReport {
  if (reports.length === 0) {
    throw new Error("aggregate requires at least one opt-in scan report");
  }
  if (generatedAt.length === 0) {
    throw new Error("aggregate requires a generatedAt value");
  }
  const scores = reports.map((report) => report.score).sort((left, right) => left - right);
  const diagnosticCounts = new Map<string, ScanAggregateDiagnostic>();
  const gradeCounts = { ...SCAN_GRADE_COUNTS };
  for (const report of reports) {
    gradeCounts[report.grade] += 1;
    for (const diagnostic of report.diagnostics) {
      const key = `${diagnostic.severity}:${diagnostic.code}`;
      const current = diagnosticCounts.get(key);
      if (current === undefined) {
        diagnosticCounts.set(key, {
          code: diagnostic.code,
          count: 1,
          severity: diagnostic.severity,
        });
      } else {
        current.count += 1;
      }
    }
  }
  return {
    averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    diagnosticCounts: [...diagnosticCounts.values()].sort(compareAggregateDiagnostics),
    generatedAt,
    gradeCounts,
    maxScore: scores.at(-1) ?? 0,
    medianScore: medianScore(scores),
    minScore: scores[0] ?? 0,
    sampleCount: reports.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScanGrade(value: unknown): value is ScanJsonReport["grade"] {
  return typeof value === "string" && Object.hasOwn(SCAN_GRADE_COUNTS, value);
}

function scanFileDiagnostics(result: ScanResult, fallbackFile: string): FileDiagnostics[] {
  const grouped = new Map<string, Diagnostic[]>();
  for (const item of result.diagnostics) {
    const file = item.file ?? fallbackFile;
    const diagnostics = grouped.get(file) ?? [];
    diagnostics.push(groupDiagnostic(item, file));
    grouped.set(file, diagnostics);
  }
  return [...grouped.entries()].map(([file, diagnostics]) => ({ diagnostics, file }));
}

function groupDiagnostic(item: Diagnostic, file: string): Diagnostic {
  if (item.file !== file) {
    return item;
  }
  const { file: _file, ...rest } = item;
  return rest;
}

function medianScore(scores: readonly number[]): number {
  const midpoint = Math.floor(scores.length / 2);
  if (scores.length % 2 === 1) {
    return scores[midpoint] ?? 0;
  }
  return ((scores[midpoint - 1] ?? 0) + (scores[midpoint] ?? 0)) / 2;
}

function compareAggregateDiagnostics(
  left: ScanAggregateDiagnostic,
  right: ScanAggregateDiagnostic
): number {
  return (
    right.count - left.count ||
    left.severity.localeCompare(right.severity) ||
    left.code.localeCompare(right.code)
  );
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return "#3fb950";
    case "B":
      return "#7bc043";
    case "C":
      return "#dfb317";
    case "D":
      return "#fe7d37";
    default:
      return "#e05d44";
  }
}

export function scanBadge(result: ScanResult): string {
  const grade = scoreGrade(result.score);
  const value = `${result.score}/100 ${grade}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="20" role="img" aria-label="Postgres safety: ${value}">`,
    '<rect width="115" height="20" fill="#555"/>',
    `<rect x="115" width="75" height="20" fill="${gradeColor(grade)}"/>`,
    '<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">',
    '<text x="8" y="14">Postgres safety</text>',
    `<text x="123" y="14">${value}</text>`,
    "</g></svg>",
  ].join("");
}
