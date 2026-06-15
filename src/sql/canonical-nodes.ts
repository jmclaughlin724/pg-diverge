import { asRecord } from "./ast.js";

type Scope = string | null;

export function canonicalPolicyNode(node: unknown, scopes: Scope[] = []): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => canonicalPolicyNode(item, scopes));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }
  const record = node as Record<string, unknown>;
  const typeCast = asRecord(record.TypeCast);
  if (typeCast && asRecord(typeCast.arg)?.A_Const !== undefined) {
    return canonicalPolicyNode(typeCast.arg, scopes);
  }
  // A subquery inside a policy expression is its own SELECT scope. pg_get_expr
  // qualifies that subquery's columns with its relation (`members.item_id`)
  // where the declarative source writes them bare (`item_id`); stripping the
  // sole-from-relation qualifier of the innermost scope converges both lanes,
  // exactly as canonicalViewNode does. Correlated refs to an outer scope keep
  // their written qualification (the conservative stance that never masks a
  // real change).
  const selectStmt = asRecord(record.SelectStmt);
  if (selectStmt) {
    const next = [...scopes, soleFromRelation(selectStmt)];
    const inner: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(selectStmt)) {
      inner[key] = canonicalPolicyNode(value, next);
    }
    return { ...record, SelectStmt: inner };
  }
  const columnRef = asRecord(record.ColumnRef);
  if (columnRef) {
    return { ...record, ColumnRef: canonicalColumnRef(columnRef, scopes) };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "ResTarget" && typeof value === "object" && value !== null) {
      const { name: _alias, ...rest } = value as Record<string, unknown>;
      result[key] = canonicalPolicyNode(rest, scopes);
      continue;
    }
    result[key] = canonicalPolicyNode(value, scopes);
  }
  return result;
}

export function canonicalViewNode(node: unknown, scopes: Scope[]): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => canonicalViewNode(item, scopes));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }
  const record = node as Record<string, unknown>;
  const selectStmt = asRecord(record.SelectStmt);
  if (selectStmt) {
    const next = [...scopes, soleFromRelation(selectStmt)];
    return { ...record, SelectStmt: canonicalChildren(selectStmt, next) };
  }
  const columnRef = asRecord(record.ColumnRef);
  if (columnRef) {
    return { ...record, ColumnRef: canonicalColumnRef(columnRef, scopes) };
  }
  return canonicalChildren(record, scopes);
}

function canonicalColumnRef(
  columnRef: Record<string, unknown>,
  scopes: Scope[]
): Record<string, unknown> {
  const fields = columnRef.fields;
  if (!Array.isArray(fields) || fields.length !== 2) {
    return columnRef;
  }
  const qualifier = stringField(fields[0]);
  const innermost = scopes.at(-1);
  if (qualifier === undefined || innermost === null || qualifier !== innermost) {
    return columnRef;
  }
  return { ...columnRef, fields: [fields[1]] };
}

function soleFromRelation(selectStmt: Record<string, unknown>): Scope {
  const fromClause = selectStmt.fromClause;
  if (!Array.isArray(fromClause) || fromClause.length !== 1) {
    return null;
  }
  const rangeVar = asRecord(asRecord(fromClause[0])?.RangeVar);
  if (!rangeVar) {
    return null;
  }
  const aliasName = asRecord(rangeVar.alias)?.aliasname;
  if (typeof aliasName === "string") {
    return aliasName;
  }
  return typeof rangeVar.relname === "string" ? rangeVar.relname : null;
}

function canonicalChildren(
  record: Record<string, unknown>,
  scopes: Scope[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    result[key] = canonicalViewNode(child, scopes);
  }
  return result;
}

function stringField(field: unknown): string | undefined {
  const sval = asRecord(asRecord(field)?.String)?.sval;
  return typeof sval === "string" ? sval : undefined;
}
