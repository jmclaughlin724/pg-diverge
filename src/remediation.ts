import type { Diagnostic } from "./core.js";

function describeLocation(diagnostic: Diagnostic): string {
  const ref = diagnostic.ref;
  if (ref === undefined) {
    return diagnostic.file ?? "the schema";
  }
  const qualified = ref.schema === undefined ? ref.name : `${ref.schema}.${ref.name}`;
  return `${ref.kind} ${qualified}`;
}

export function remediationPrompt(diagnostic: Diagnostic): string {
  const lines = [
    "You are a PostgreSQL migration-safety assistant. Propose a minimal, safe fix.",
    `Finding [${diagnostic.code}] (${diagnostic.severity}): ${diagnostic.message}`,
    diagnostic.hint === undefined ? "" : `Guidance: ${diagnostic.hint}`,
    `Location: ${describeLocation(diagnostic)}`,
    "Respond with: (1) the corrected SQL, (2) a one-line rationale. Change nothing unrelated.",
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

export function remediationCacheKey(diagnostic: Diagnostic): string {
  const ref = diagnostic.ref;
  const target =
    ref === undefined ? (diagnostic.file ?? "") : `${ref.kind}:${ref.schema ?? ""}.${ref.name}`;
  return `${diagnostic.code}|${target}`;
}

export interface RemediationStep {
  diagnostic: Diagnostic;
  order: number;
  prompt: string;
}

function severityRank(severity: string): number {
  if (severity === "error") {
    return 0;
  }
  return severity === "warning" ? 1 : 2;
}

export function buildRemediationPlan(diagnostics: Diagnostic[]): RemediationStep[] {
  return [...diagnostics]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .map((diagnostic, index) => ({
      diagnostic,
      order: index + 1,
      prompt: remediationPrompt(diagnostic),
    }));
}
