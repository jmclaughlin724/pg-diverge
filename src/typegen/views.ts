import type { SchemaObject } from "../core.js";
import {
  asRecord,
  astNodeKind,
  astNodeOf,
  readArray,
  readString,
  stringList,
  typeNameToSql,
} from "../sql/ast.js";
import { parseSqlAst } from "../sql/parser.js";
import type { ColumnShape, TableShape } from "./model.js";

interface ViewTarget {
  alias?: string;
  expression?: unknown;
  isStar: boolean;
  sourceColumn?: string;
  starQualifier?: string;
}

interface SourceInfo {
  columns: ColumnShape[];
  qualifiedColumns: Map<string, ColumnShape[]>;
}

interface InferenceContext {
  ctes: Map<string, ColumnShape[]>;
  defaultSchema: string;
  fromInfo?: SourceInfo;
  tablesByKey: Map<string, TableShape>;
}

export async function collectViewColumns(
  object: SchemaObject,
  tablesByKey: Map<string, TableShape>
): Promise<ColumnShape[]> {
  const aliasNames = Array.isArray(object.metadata.viewColumns)
    ? object.metadata.viewColumns.map((value) => String(value))
    : undefined;
  const parsed = await parseSqlAst(object.sql, object.file);
  const select = firstSelect(parsed.ast);
  const expanded = columnsForSelect(select, object.ref.schema ?? "public", tablesByKey);
  if (aliasNames) {
    return aliasNames.map((name, index) => ({
      name,
      notNull: false,
      type:
        aliasNames.length === expanded.length ? (expanded[index]?.type ?? "unknown") : "unknown",
    }));
  }
  return expanded;
}

function columnsForSelect(
  select: Record<string, unknown> | undefined,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  inheritedCtes: Map<string, ColumnShape[]> = new Map()
): ColumnShape[] {
  if (!select) {
    return [];
  }
  const ctes = collectCteSources(select, defaultSchema, tablesByKey, inheritedCtes);
  const fromInfo = collectFromClauseSourceInfo(select, defaultSchema, tablesByKey, ctes);
  const targets = readArray(select.targetList).map((target) => parseTarget(target));
  const context: InferenceContext = {
    ctes,
    defaultSchema,
    ...(fromInfo ? { fromInfo } : {}),
    tablesByKey,
  };
  return targets.flatMap((target) => expandTarget(target, context));
}

function expandTarget(target: ViewTarget, context: InferenceContext): ColumnShape[] {
  if (target.isStar) {
    return expandStarTarget(target, context.fromInfo);
  }

  const name = target.alias ?? target.sourceColumn;
  if (!name) {
    return [];
  }

  const expressionType = inferExpressionType(target.expression, context);
  const match =
    target.sourceColumn === undefined || !context.fromInfo
      ? undefined
      : findColumn(context.fromInfo, target);
  const type = expressionType && expressionType !== "unknown" ? expressionType : match?.type;
  return [{ name, notNull: false, type: type ?? "unknown" }];
}

function expandStarTarget(target: ViewTarget, fromInfo: SourceInfo | undefined): ColumnShape[] {
  if (
    !fromInfo ||
    (target.starQualifier !== undefined && !fromInfo.qualifiedColumns.has(target.starQualifier))
  ) {
    return [];
  }
  return fromInfo.columns.map((column) => ({
    name: column.name,
    notNull: false,
    type: column.type,
  }));
}

function parseTarget(target: unknown): ViewTarget {
  const resTarget = astNodeOf(target, "ResTarget");
  const columnRef = astNodeOf(resTarget?.val, "ColumnRef");
  const fields = readArray(columnRef?.fields);
  const lastField = fields.at(-1);
  const isStar = astNodeKind(lastField) === "A_Star";
  const lastName = stringList(columnRef?.fields).at(-1);
  const alias = readString(resTarget?.name);
  if (isStar) {
    return {
      isStar: true,
      ...(lastName !== undefined && fields.length > 1 ? { starQualifier: lastName } : {}),
    };
  }
  return {
    isStar: false,
    ...(alias === undefined ? {} : { alias }),
    ...(resTarget?.val === undefined ? {} : { expression: resTarget.val }),
    ...(lastName === undefined ? {} : { sourceColumn: lastName }),
  };
}

function firstSelect(ast: unknown): Record<string, unknown> | undefined {
  const statements = readArray(asRecord(ast)?.stmts);
  const stmt = asRecord(asRecord(statements[0])?.stmt);
  const view = astNodeOf(stmt, "ViewStmt");
  const tableAs = astNodeOf(stmt, "CreateTableAsStmt");
  return selectStatement(view?.query ?? tableAs?.query);
}

function collectFromClauseSourceInfo(
  select: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  ctes: Map<string, ColumnShape[]>
): SourceInfo | undefined {
  const fromClause = readArray(select.fromClause);
  if (fromClause.length === 0) {
    return;
  }
  const info: SourceInfo = { columns: [], qualifiedColumns: new Map() };
  for (const item of fromClause) {
    addFromItem(info, item, defaultSchema, tablesByKey, ctes);
  }
  return info.columns.length > 0 ? info : undefined;
}

function collectCteSources(
  select: Record<string, unknown> | undefined,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  inheritedCtes: Map<string, ColumnShape[]>
): Map<string, ColumnShape[]> {
  const ctes = new Map(inheritedCtes);
  for (const item of readArray(asRecord(select?.withClause)?.ctes)) {
    const cte = astNodeOf(item, "CommonTableExpr");
    if (!cte) {
      continue;
    }
    const name = readString(cte?.ctename);
    const query = selectStatement(cte?.ctequery);
    if (!(name && query)) {
      continue;
    }
    const aliasNames = stringList(cte.aliascolnames);
    const columns = applyColumnAliases(
      columnsForSelect(query, defaultSchema, tablesByKey, ctes),
      aliasNames
    );
    ctes.set(name, columns);
  }
  return ctes;
}

function addFromItem(
  info: SourceInfo,
  item: unknown,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  ctes: Map<string, ColumnShape[]>
): void {
  const rangeVar = astNodeOf(item, "RangeVar");
  if (rangeVar) {
    addRangeVar(info, rangeVar, defaultSchema, tablesByKey, ctes);
    return;
  }

  const rangeSubselect = astNodeOf(item, "RangeSubselect");
  if (rangeSubselect) {
    addRangeSubselect(info, rangeSubselect, defaultSchema, tablesByKey, ctes);
    return;
  }

  const join = astNodeOf(item, "JoinExpr");
  if (join) {
    addFromItem(info, join.larg, defaultSchema, tablesByKey, ctes);
    addFromItem(info, join.rarg, defaultSchema, tablesByKey, ctes);
  }
}

function addRangeVar(
  info: SourceInfo,
  rangeVar: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  ctes: Map<string, ColumnShape[]>
): void {
  const relname = readString(rangeVar?.relname);
  if (!relname) {
    return;
  }
  const schemaName = readString(rangeVar?.schemaname) ?? defaultSchema;
  const columns = ctes.get(relname) ?? tablesByKey.get(`${schemaName}.${relname}`)?.columns;
  if (!columns) {
    return;
  }
  const aliasName = readString(asRecord(rangeVar.alias)?.aliasname);
  addSourceColumns(info, columns, aliasName ? [relname, aliasName] : [relname]);
}

function addRangeSubselect(
  info: SourceInfo,
  rangeSubselect: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  ctes: Map<string, ColumnShape[]>
): void {
  const query = selectStatement(rangeSubselect.subquery);
  if (!query) {
    return;
  }
  const alias = asRecord(rangeSubselect.alias);
  const aliasName = readString(alias?.aliasname);
  const columns = applyColumnAliases(
    columnsForSelect(query, defaultSchema, tablesByKey, ctes),
    stringList(alias?.colnames)
  );
  addSourceColumns(info, columns, aliasName ? [aliasName] : []);
}

function addSourceColumns(info: SourceInfo, columns: ColumnShape[], names: string[]): void {
  if (columns.length === 0) {
    return;
  }
  info.columns.push(...columns);
  for (const name of names) {
    info.qualifiedColumns.set(name, columns);
  }
}

function applyColumnAliases(columns: ColumnShape[], aliasNames: string[]): ColumnShape[] {
  if (aliasNames.length !== columns.length) {
    return columns;
  }
  return columns.map((column, index) => ({
    ...column,
    name: aliasNames[index] ?? column.name,
  }));
}

function findColumn(fromInfo: SourceInfo, target: ViewTarget): ColumnShape | undefined {
  if (!target.sourceColumn) {
    return;
  }
  if (target.starQualifier) {
    return fromInfo.qualifiedColumns
      .get(target.starQualifier)
      ?.find((column) => column.name === target.sourceColumn);
  }
  const matches = fromInfo.columns.filter((column) => column.name === target.sourceColumn);
  return matches.length === 1 ? matches[0] : undefined;
}

function inferExpressionType(expression: unknown, context: InferenceContext): string | undefined {
  switch (astNodeKind(expression)) {
    case "A_ArrayExpr": {
      const array = astNodeOf(expression, "A_ArrayExpr");
      const elementType = firstKnownType(readArray(array?.elements), context);
      return elementType ? `${elementType}[]` : undefined;
    }
    case "A_Expr": {
      const expr = astNodeOf(expression, "A_Expr");
      return expr ? aExprType(expr, context) : undefined;
    }
    case "BoolExpr":
    case "BooleanTest":
    case "NullTest":
      return "boolean";
    case "CaseExpr": {
      const caseExpr = astNodeOf(expression, "CaseExpr");
      const results = readArray(caseExpr?.args).flatMap((item) => {
        const result = astNodeOf(item, "CaseWhen")?.result;
        return result === undefined ? [] : [result];
      });
      if (caseExpr?.defresult !== undefined) {
        results.push(caseExpr.defresult);
      }
      return firstKnownType(results, context);
    }
    case "CoalesceExpr": {
      const coalesce = astNodeOf(expression, "CoalesceExpr");
      return firstKnownType(readArray(coalesce?.args), context);
    }
    case "ColumnRef": {
      const columnRef = astNodeOf(expression, "ColumnRef");
      return columnRef ? columnRefType(columnRef, context) : undefined;
    }
    case "FuncCall": {
      const func = astNodeOf(expression, "FuncCall");
      return func ? functionReturnType(func) : undefined;
    }
    case "SubLink": {
      const subLink = astNodeOf(expression, "SubLink");
      return subLink ? subLinkType(subLink, context) : undefined;
    }
    case "TypeCast": {
      const typeCast = astNodeOf(expression, "TypeCast");
      return typeCast ? typeNameToSql(typeCast.typeName) : undefined;
    }
    default:
      return;
  }
}

function columnRefType(
  columnRef: Record<string, unknown>,
  context: InferenceContext
): string | undefined {
  const fromInfo = context.fromInfo;
  if (!fromInfo) {
    return;
  }
  const fields = stringList(columnRef.fields);
  const columnName = fields.at(-1);
  if (!columnName) {
    return;
  }
  if (fields.length > 1) {
    const qualifier = fields.at(-2);
    return fromInfo.qualifiedColumns
      .get(String(qualifier))
      ?.find((column) => column.name === columnName)?.type;
  }
  const matches = fromInfo.columns.filter((column) => column.name === columnName);
  return matches.length === 1 ? matches[0]?.type : undefined;
}

function firstKnownType(expressions: unknown[], context: InferenceContext): string | undefined {
  for (const expression of expressions) {
    const type = inferExpressionType(expression, context);
    if (type && type !== "unknown") {
      return type;
    }
  }
}

function aExprType(expr: Record<string, unknown>, context: InferenceContext): string | undefined {
  if (expr.kind === "AEXPR_NULLIF") {
    return inferExpressionType(expr.lexpr, context);
  }
  const operator = stringList(expr.name).at(-1);
  if (operator === "->>") {
    return "text";
  }
  if (operator === "->") {
    return "jsonb";
  }
  if (operator && booleanOperators.has(operator)) {
    return "boolean";
  }
  if (booleanExpressionKinds.has(readString(expr.kind) ?? "")) {
    return "boolean";
  }
}

function subLinkType(link: Record<string, unknown>, context: InferenceContext): string | undefined {
  const kind = readString(link.subLinkType) ?? "";
  if (kind === "EXISTS_SUBLINK") {
    return "boolean";
  }
  const query = selectStatement(link.subselect);
  if (!query) {
    return;
  }
  const firstColumn = columnsForSelect(
    query,
    context.defaultSchema,
    context.tablesByKey,
    context.ctes
  ).at(0);
  if (!(firstColumn?.type && firstColumn.type !== "unknown")) {
    return;
  }
  return kind === "ARRAY_SUBLINK" ? `${firstColumn.type}[]` : firstColumn.type;
}

function functionReturnType(func: Record<string, unknown>): string | undefined {
  const name = stringList(func.funcname).join(".");
  const shortName = name.split(".").at(-1) ?? "";
  return functionTypeMap.get(name) ?? functionTypeMap.get(shortName);
}

function selectStatement(value: unknown): Record<string, unknown> | undefined {
  return astNodeOf(value, "SelectStmt");
}

const booleanOperators = new Set([
  "=",
  "<>",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "~~",
  "!~~",
  "~~*",
  "!~~*",
]);

const booleanExpressionKinds = new Set([
  "AEXPR_BETWEEN",
  "AEXPR_BETWEEN_SYM",
  "AEXPR_DISTINCT",
  "AEXPR_ILIKE",
  "AEXPR_IN",
  "AEXPR_LIKE",
  "AEXPR_NOT_BETWEEN",
  "AEXPR_NOT_BETWEEN_SYM",
  "AEXPR_NOT_DISTINCT",
  "AEXPR_OP_ALL",
  "AEXPR_OP_ANY",
  "AEXPR_SIMILAR",
]);

const functionTypeMap = new Map([
  ["array_length", "integer"],
  ["btrim", "text"],
  ["cardinality", "integer"],
  ["communication_channel_or_null", "platform.communication_channel"],
  ["count", "bigint"],
  ["lower", "text"],
  ["ltrim", "text"],
  ["row_number", "bigint"],
  ["rtrim", "text"],
  ["safe_bigint_from_jsonb", "bigint"],
  ["safe_numeric_from_jsonb", "numeric"],
  ["safe_timestamptz_from_jsonb", "timestamp with time zone"],
  ["safe_uuid_from_jsonb", "uuid"],
  ["trim", "text"],
  ["upper", "text"],
]);
