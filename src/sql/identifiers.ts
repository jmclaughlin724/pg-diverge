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
export function stripOuterDoubleQuotes(value: string): string {
  const withoutLeading = value.startsWith('"') ? value.slice(1) : value;
  return withoutLeading.endsWith('"') ? withoutLeading.slice(0, -1) : withoutLeading;
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
  const lines = sql.replaceAll("\r\n", "\n").split("\n");
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    const trimmedEnd = line.trimEnd();
    blankRun = trimmedEnd.length === 0 ? blankRun + 1 : 0;
    if (blankRun <= 1) {
      collapsed.push(trimmedEnd);
    }
  }
  const text = collapsed.join("\n").trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === ";") {
    end -= 1;
  }
  return text.slice(0, end).trimEnd();
}
