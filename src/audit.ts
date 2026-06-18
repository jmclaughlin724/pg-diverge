import type { Diagnostic, SchemaModel } from "./core.js";

export interface AuditFinding {
  code: string;
  count: number;
  message: string;
  samples: string[];
  severity: string;
}

export interface AuditReport {
  errorStatements: number;
  findings: AuditFinding[];
  objectsByKind: Record<string, number>;
  objectsBySchema: Record<string, number>;
  source: string;
  supported: boolean;
  totalObjects: number;
}

const sampleLimit = 5;
const sampleLength = 120;

export function auditModel(model: SchemaModel): AuditReport {
  const objectsByKind: Record<string, number> = {};
  const objectsBySchema: Record<string, number> = {};
  for (const object of model.objects) {
    objectsByKind[object.ref.kind] = (objectsByKind[object.ref.kind] ?? 0) + 1;
    const schema = object.ref.schema ?? (object.ref.kind === "schema" ? object.ref.name : "-");
    objectsBySchema[schema] = (objectsBySchema[schema] ?? 0) + 1;
  }
  const groups = new Map<string, { diagnostics: Diagnostic[]; severity: string }>();
  for (const item of model.diagnostics) {
    if (item.severity !== "error" && item.severity !== "warning") {
      continue;
    }
    const group = groups.get(item.code) ?? { diagnostics: [], severity: item.severity };
    group.diagnostics.push(item);
    groups.set(item.code, group);
  }
  const findings: AuditFinding[] = [...groups.entries()]
    .map(([code, group]) => ({
      code,
      count: group.diagnostics.length,
      message: group.diagnostics[0]?.message ?? "",
      samples: group.diagnostics
        .map((item) => item.statement ?? item.hint ?? "")
        .filter(Boolean)
        .slice(0, sampleLimit)
        .map((sample) => collapseWhitespace(sample).slice(0, sampleLength)),
      severity: group.severity,
    }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  const errorStatements = findings
    .filter((finding) => finding.severity === "error")
    .reduce((total, finding) => total + finding.count, 0);
  return {
    errorStatements,
    findings,
    objectsByKind,
    objectsBySchema,
    source: model.source,
    supported: errorStatements === 0,
    totalObjects: model.objects.length,
  };
}

function collapseWhitespace(value: string): string {
  const words: string[] = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words.join(" ");
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

export function renderAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`supaschema audit: ${report.source}`);
  lines.push(
    `objects modeled: ${report.totalObjects} across ${Object.keys(report.objectsBySchema).length} schema(s)`
  );
  const kinds = Object.entries(report.objectsByKind)
    .sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => `${kind}=${count}`)
    .join(" ");
  lines.push(`by kind: ${kinds || "none"}`);
  if (report.findings.length === 0) {
    lines.push("contract coverage: full — no findings");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `contract coverage: ${report.errorStatements} statement(s) outside the contract, ${report.findings.length} finding class(es)`
  );
  for (const finding of report.findings) {
    lines.push(`  ${finding.severity.toUpperCase()} ${finding.code} ×${finding.count}`);
    for (const sample of finding.samples) {
      lines.push(`    ${sample}`);
    }
  }
  lines.push("run `supaschema explain <CODE>` for remediation guidance per code");
  return `${lines.join("\n")}\n`;
}
