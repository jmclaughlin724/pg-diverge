import { redactSecrets } from "../redaction.js";
import type { Diagnostic, DiagnosticSeverity, ObjectRef } from "../types.js";

interface DiagnosticExtras {
  file?: string | undefined;
  hint?: string | undefined;
  ref?: ObjectRef | undefined;
  schemas?: string[] | undefined;
  statement?: string | undefined;
}

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  extras: DiagnosticExtras = {}
): Diagnostic {
  const output: Diagnostic = {
    code,
    message: redactSecrets(message),
    severity,
  };
  if (extras.file !== undefined) {
    output.file = extras.file;
  }
  if (extras.hint !== undefined) {
    output.hint = redactSecrets(extras.hint);
  }
  if (extras.ref !== undefined) {
    output.ref = extras.ref;
  }
  if (extras.statement !== undefined) {
    output.statement = redactSecrets(extras.statement);
  }
  if (extras.schemas !== undefined && extras.schemas.length > 0) {
    output.schemas = extras.schemas;
  }
  return output;
}
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

export function isDiagnostic(value: unknown): value is Diagnostic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const code = Reflect.get(value, "code");
  const message = Reflect.get(value, "message");
  const severity = Reflect.get(value, "severity");
  return (
    typeof code === "string" &&
    typeof message === "string" &&
    (severity === "info" || severity === "warning" || severity === "error")
  );
}

export function formatDiagnostic(item: Diagnostic): string {
  const location = item.file ? ` ${item.file}` : "";
  const ref = item.ref ? ` ${formatRef(item.ref)}` : "";
  const hint = item.hint ? `\n  hint: ${item.hint}` : "";
  return `${item.severity.toUpperCase()} ${item.code}${location}${ref}: ${item.message}${hint}`;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  const grouped = new Map<string, number>();
  for (const item of diagnostics) {
    const formatted = formatDiagnostic(item);
    grouped.set(formatted, (grouped.get(formatted) ?? 0) + 1);
  }
  return [...grouped]
    .map(([formatted, count]) => formatDiagnosticCount(formatted, count))
    .join("\n");
}

function formatDiagnosticCount(formatted: string, count: number): string {
  return count === 1 ? formatted : `${formatted}\n  repeated: ${count} occurrences`;
}

function formatRef(ref: ObjectRef): string {
  const schema = ref.schema ? `${ref.schema}.` : "";
  const table = ref.table ? ` on ${ref.schema ? `${ref.schema}.` : ""}${ref.table}` : "";
  const signature = ref.signature ? `(${ref.signature})` : "";
  return `[${ref.kind}:${schema}${ref.name}${signature}${table}]`;
}
