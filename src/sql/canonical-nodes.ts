import { asRecord, readArray, typeNameToSql } from "./ast.js";

type Scope = string | null;

export function canonicalPolicyNode(node: unknown, scopes: Scope[] = []): unknown {
  return canonicalExpressionNode(node, scopes, canonicalPolicyNode);
}

export function canonicalViewNode(node: unknown, scopes: Scope[]): unknown {
  return canonicalExpressionNode(node, scopes, canonicalViewNode);
}

type CanonicalVisit = (node: unknown, scopes: Scope[]) => unknown;

function canonicalExpressionNode(node: unknown, scopes: Scope[], visit: CanonicalVisit): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => visit(item, scopes));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }
  const record = asRecord(node);
  if (!record) {
    return node;
  }
  const defElem = asRecord(record.DefElem);
  if (defElem) {
    return { ...record, DefElem: canonicalDefElem(defElem, scopes, visit) };
  }
  const typeCast = asRecord(record.TypeCast);
  if (typeCast && isRedundantJsonbPopulateRecordCast(typeCast)) {
    return visit(typeCast.arg, scopes);
  }
  if (typeCast && asRecord(typeCast.arg)?.A_Const !== undefined) {
    return visit(typeCast.arg, scopes);
  }
  const boolExpr = asRecord(record.BoolExpr);
  if (boolExpr) {
    return canonicalBoolExpr(boolExpr, scopes, visit);
  }
  const rangeFunction = asRecord(record.RangeFunction);
  if (rangeFunction) {
    return { ...record, RangeFunction: canonicalRangeFunction(rangeFunction, scopes, visit) };
  }
  const selectStmt = asRecord(record.SelectStmt);
  if (selectStmt) {
    const next = [...scopes, soleFromRelation(selectStmt)];
    return { ...record, SelectStmt: canonicalChildren(selectStmt, next, visit) };
  }
  if (isBareSelectStmt(record)) {
    return canonicalChildren(record, [...scopes, soleFromRelation(record)], visit);
  }
  const columnRef = asRecord(record.ColumnRef);
  if (columnRef) {
    return { ...record, ColumnRef: canonicalColumnRef(columnRef, scopes) };
  }
  return canonicalChildren(record, scopes, visit);
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

function canonicalBoolExpr(
  boolExpr: Record<string, unknown>,
  scopes: Scope[],
  visit: (node: unknown, scopes: Scope[]) => unknown
): unknown {
  const boolop = typeof boolExpr.boolop === "string" ? boolExpr.boolop : "";
  const canonicalArgs = readArray(boolExpr.args).map((arg) => visit(arg, scopes));
  if (boolop === "NOT_EXPR" && canonicalArgs.length === 1) {
    const distinct = asRecord(asRecord(canonicalArgs[0])?.A_Expr);
    if (distinct?.kind === "AEXPR_DISTINCT") {
      return {
        A_Expr: {
          ...distinct,
          kind: "AEXPR_NOT_DISTINCT",
        },
      };
    }
  }
  const args =
    boolop === "AND_EXPR" || boolop === "OR_EXPR"
      ? flattenBoolArgs(boolop, canonicalArgs)
      : canonicalArgs;
  return { BoolExpr: { ...boolExpr, args } };
}

function flattenBoolArgs(boolop: string, args: unknown[]): unknown[] {
  const flattened: unknown[] = [];
  for (const arg of args) {
    const nested = asRecord(asRecord(arg)?.BoolExpr);
    if (nested?.boolop === boolop && Array.isArray(nested.args)) {
      flattened.push(...nested.args);
      continue;
    }
    flattened.push(arg);
  }
  return flattened;
}

function canonicalRangeFunction(
  rangeFunction: Record<string, unknown>,
  scopes: Scope[],
  visit: (node: unknown, scopes: Scope[]) => unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rangeFunction)) {
    if (key === "alias") {
      const alias = asRecord(value);
      if (alias) {
        const { colnames: _colnames, ...rest } = alias;
        result[key] = visit(rest, scopes);
        continue;
      }
    }
    result[key] = visit(value, scopes);
  }
  return result;
}

function isRedundantJsonbPopulateRecordCast(typeCast: Record<string, unknown>): boolean {
  const funcCall = asRecord(asRecord(typeCast.arg)?.FuncCall);
  if (!funcCall || functionName(funcCall) !== "jsonb_populate_record") {
    return false;
  }
  const outerType = typeNameToSql(typeCast.typeName);
  const firstArgCast = asRecord(asRecord(readArray(funcCall.args)[0])?.TypeCast);
  if (!firstArgCast || typeNameToSql(firstArgCast.typeName) !== outerType) {
    return false;
  }
  const constant = asRecord(asRecord(firstArgCast.arg)?.A_Const);
  return constant?.isnull === true;
}

function functionName(funcCall: Record<string, unknown>): string {
  return readArray(funcCall.funcname)
    .map((part) => stringField(part))
    .filter((part): part is string => part !== undefined)
    .join(".");
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

function isBareSelectStmt(record: Record<string, unknown>): boolean {
  return (
    (typeof record.op === "string" && record.op.startsWith("SETOP_")) ||
    Array.isArray(record.targetList) ||
    Array.isArray(record.fromClause)
  );
}

function canonicalChildren(
  record: Record<string, unknown>,
  scopes: Scope[],
  visit: CanonicalVisit
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "roles" && Array.isArray(child)) {
      result[key] = canonicalPolicyRoles(child, scopes);
      continue;
    }
    const target = asRecord(child);
    if (key === "ResTarget" && target) {
      const { name: _alias, ...rest } = target;
      result[key] = visit(rest, scopes);
      continue;
    }
    result[key] = visit(child, scopes);
  }
  return result;
}

function canonicalDefElem(
  defElem: Record<string, unknown>,
  scopes: Scope[],
  visit: (node: unknown, scopes: Scope[]) => unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defElem)) {
    if (key === "arg" && typeof defElem.defname === "string") {
      const boolean = defElemBoolean(value);
      if (boolean !== undefined) {
        result[key] = { Boolean: { boolval: boolean } };
        continue;
      }
    }
    result[key] = visit(value, scopes);
  }
  return result;
}

function defElemBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return true;
  }
  const booleanNode = asRecord(asRecord(value)?.Boolean);
  if (booleanNode?.boolval === true) {
    return true;
  }
  if (booleanNode?.boolval === false) {
    return false;
  }
  const integer = asRecord(asRecord(value)?.Integer);
  if (typeof integer?.ival === "number") {
    return integer.ival !== 0;
  }
  const text = stringField(value)?.toLowerCase();
  if (text === undefined) {
    return;
  }
  if (text === "true" || text === "on" || text === "1" || text === "yes") {
    return true;
  }
  if (text === "false" || text === "off" || text === "0" || text === "no") {
    return false;
  }
}

function canonicalPolicyRoles(roles: unknown[], scopes: Scope[]): unknown[] {
  return roles
    .map((role) => canonicalPolicyNode(role, scopes))
    .sort((left, right) => roleSortKey(left).localeCompare(roleSortKey(right)));
}

function roleSortKey(role: unknown): string {
  const spec = asRecord(asRecord(role)?.RoleSpec) ?? asRecord(role);
  const type = typeof spec?.roletype === "string" ? spec.roletype : "";
  const name = typeof spec?.rolename === "string" ? spec.rolename : "";
  return `${type}:${name}`.toLowerCase();
}

function stringField(field: unknown): string | undefined {
  const sval = asRecord(asRecord(field)?.String)?.sval;
  return typeof sval === "string" ? sval : undefined;
}
