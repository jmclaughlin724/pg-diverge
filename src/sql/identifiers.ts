import type { ObjectRef } from "../core.js";

export function splitQualifiedIdentifier(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (inQuote) {
      if (char === '"' && next === '"') {
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuote = false;
      }
      continue;
    }
    if (char === '"') {
      inQuote = true;
      continue;
    }
    if (char === ".") {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}
export function parseQualifiedIdentifier(
  input: string,
  defaultSchema = "public",
): { name: string; schema: string } {
  const parts = splitQualifiedIdentifier(input);
  if (parts.length === 1) {
    return {
      name: normalizeIdentifier(parts[0] ?? ""),
      schema: defaultSchema,
    };
  }
  return {
    name: normalizeIdentifier(parts.at(-1) ?? ""),
    schema: normalizeIdentifier(parts.at(-2) ?? defaultSchema),
  };
}
export function normalizeIdentifier(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed.toLowerCase();
}
export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
export function formatQualifiedName(schema: string | undefined, name: string): string {
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);
}
export function objectKey(ref: ObjectRef): string {
  const schema = ref.schema ? `${ref.schema}.` : "";
  const table = ref.table ? `:${ref.table}` : "";
  const signature = ref.signature !== undefined ? `(${ref.signature})` : "";
  return `${ref.kind}:${schema}${ref.name}${signature}${table}`;
}
export function normalizeSql(sql: string): string {
  return sql
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/;+$/u, "")
    .trim();
}
