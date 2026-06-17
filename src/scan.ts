import { type CheckReporter, type FileDiagnostics, renderCheckReport } from "./check-reporters.js";
import type { Diagnostic, SchemaModel } from "./core.js";
import { type RulePack, runRulePacks } from "./rules.js";

/**
 * Scan core (plan `.claude/plans/00-keystone-scan-and-badge.md`, task K0).
 *
 * Runs rule packs over the declarative model and aggregates a 0-100 safety score
 * plus the diagnostics. Pure and local — no DB, no network, no upload. CLI command
 * registration (`supaschema scan`) and the SVG badge build on this core.
 */

export interface ScanResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  /** 0-100; 100 is clean. */
  score: number;
  warningCount: number;
}

const ERROR_WEIGHT = 10;
const WARNING_WEIGHT = 3;
const MAX_SCORE = 100;

export function scanModel(model: SchemaModel, packs: RulePack[]): ScanResult {
  const diagnostics = runRulePacks(packs, { model });
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, MAX_SCORE - errorCount * ERROR_WEIGHT - warningCount * WARNING_WEIGHT);
  return { diagnostics, errorCount, score, warningCount };
}

/** Letter grade for the badge (A best, F worst). */
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
  const files: FileDiagnostics[] = [{ diagnostics: result.diagnostics, file }];
  return renderCheckReport(reporter, files);
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

/**
 * Embeddable SVG badge (plan `00-keystone-scan-and-badge.md`, task K1). The badge
 * is the passive distribution surface — a README badge advertises the tool the way
 * a coverage badge does. Pure string; the Worker/Action just serves it.
 */
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
