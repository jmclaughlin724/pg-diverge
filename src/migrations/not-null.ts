import { sha256 } from "../hash.js";

export function notNullProofConstraintName(schema: string, table: string, column: string): string {
  return `supaschema_not_null_${sha256(`${schema}.${table}.${column}`).slice(0, 16)}`;
}
