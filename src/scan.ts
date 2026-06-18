import { type CheckReporter, type FileDiagnostics, renderCheckReport } from "./check-reporters.js";
import type { Diagnostic, SchemaModel } from "./core.js";
import { type RulePack, runRulePacks } from "./rules.js";

export interface ScanResult {
  diagnostics: Diagnostic[];
  errorCount: number;

  score: number;
  warningCount: number;
}

export interface ScanJsonReport extends ScanResult {
  file: string;
  grade: ReturnType<typeof scoreGrade>;
}

const ERROR_WEIGHT = 10;
const WARNING_WEIGHT = 3;
const MAX_SCORE = 100;

export function scanModel(model: SchemaModel, packs: RulePack[]): ScanResult {
  const diagnostics = [...model.diagnostics, ...runRulePacks(packs, { model })];
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, MAX_SCORE - errorCount * ERROR_WEIGHT - warningCount * WARNING_WEIGHT);
  return { diagnostics, errorCount, score, warningCount };
}

export function scoreGrade(score: number): "A" | "B" | "C" | "D" | "F" {
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

export function renderScan(result: ScanResult, reporter: CheckReporter, file: string): string {
  if (reporter === "json") {
    return `${JSON.stringify(scanJsonReport(result, file), null, 2)}\n`;
  }
  const files: FileDiagnostics[] = [{ diagnostics: result.diagnostics, file }];
  return renderCheckReport(reporter, files);
}

export function scanJsonReport(result: ScanResult, file: string): ScanJsonReport {
  return { ...result, file, grade: scoreGrade(result.score) };
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
