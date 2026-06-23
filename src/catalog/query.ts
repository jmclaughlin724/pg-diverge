import { stripOuterDoubleQuotes } from "../sql/identifiers.js";

export interface CatalogQuery {
  query: <Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Row[] }>;
}

export const managedSchemaFilter = `
  n.nspname !~ '^pg_'
  and n.nspname <> 'information_schema'
`;

export function text(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

export function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text);
  }
  const raw = text(value).trim();
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => stripOuterDoubleQuotes(item.trim()))
      .filter(Boolean);
  }
  return raw.length > 0 ? [raw] : [];
}
