import type { SchemaObject } from "../core.js";
import {
  asRecord,
  astNodeKind,
  astNodeOf,
  readArray,
  readNumber,
  readString,
  stringList,
  typeNameToSql,
} from "../sql/ast.js";
import { parseSqlAst } from "../sql/parser.js";
import type { ColumnShape, FunctionShape, TableShape } from "./model.js";

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
  functionsByKey: FunctionShapesByKey;
  outerFromInfo?: SourceInfo;
  tablesByKey: Map<string, TableShape>;
}

export type FunctionShapesByKey = Map<string, FunctionShape[]>;

export async function collectViewColumns(
  object: SchemaObject,
  tablesByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey = new Map()
): Promise<ColumnShape[]> {
  const aliasNames = Array.isArray(object.metadata.viewColumns)
    ? object.metadata.viewColumns.map((value) => String(value))
    : undefined;
  const parsed = await parseSqlAst(object.sql, object.file);
  const select = firstSelect(parsed.ast);
  const expanded = columnsForSelect(
    select,
    object.ref.schema ?? "public",
    tablesByKey,
    functionsByKey
  );
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
  functionsByKey: FunctionShapesByKey,
  inheritedCtes: Map<string, ColumnShape[]> = new Map(),
  outerFromInfo?: SourceInfo
): ColumnShape[] {
  if (!select) {
    return [];
  }
  const ctes = collectCteSources(select, defaultSchema, tablesByKey, functionsByKey, inheritedCtes);
  const fromInfo = collectFromClauseSourceInfo(
    select,
    defaultSchema,
    tablesByKey,
    functionsByKey,
    ctes,
    outerFromInfo
  );
  const targets = readArray(select.targetList).map((target) => parseTarget(target));
  const context: InferenceContext = {
    ctes,
    defaultSchema,
    ...(fromInfo ? { fromInfo } : {}),
    functionsByKey,
    ...(outerFromInfo ? { outerFromInfo } : {}),
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
  if (!fromInfo) {
    return [];
  }
  const columns =
    target.starQualifier === undefined
      ? fromInfo.columns
      : fromInfo.qualifiedColumns.get(target.starQualifier);
  if (!columns) {
    return [];
  }
  return columns.map((column) => ({
    name: column.name,
    notNull: false,
    type: column.type,
  }));
}

function parseTarget(target: unknown): ViewTarget {
  const resTarget = astNodeOf(target, "ResTarget");
  const columnRef = astNodeOf(resTarget?.val, "ColumnRef");
  const fields = readArray(columnRef?.fields);
  const fieldNames = stringList(columnRef?.fields);
  const lastField = fields.at(-1);
  const isStar = astNodeKind(lastField) === "A_Star";
  const lastName = fieldNames.at(-1);
  const alias = readString(resTarget?.name);
  if (isStar) {
    return {
      isStar: true,
      ...(fieldNames.length > 0 ? { starQualifier: fieldNames.join(".") } : {}),
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
  functionsByKey: FunctionShapesByKey,
  ctes: Map<string, ColumnShape[]>,
  outerFromInfo?: SourceInfo
): SourceInfo | undefined {
  const fromClause = readArray(select.fromClause);
  if (fromClause.length === 0) {
    return;
  }
  const info: SourceInfo = { columns: [], qualifiedColumns: new Map() };
  for (const item of fromClause) {
    const source = sourceInfoForFromItem(
      item,
      defaultSchema,
      tablesByKey,
      functionsByKey,
      ctes,
      combinedSourceInfo(outerFromInfo, info)
    );
    if (source) {
      mergeSourceInfo(info, source);
    }
  }
  return info.columns.length > 0 ? info : undefined;
}

function collectCteSources(
  select: Record<string, unknown> | undefined,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey,
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
      columnsForSelect(query, defaultSchema, tablesByKey, functionsByKey, ctes),
      aliasNames
    );
    ctes.set(name, columns);
  }
  return ctes;
}

function sourceInfoForFromItem(
  item: unknown,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey,
  ctes: Map<string, ColumnShape[]>,
  outerFromInfo?: SourceInfo
): SourceInfo | undefined {
  const rangeVar = astNodeOf(item, "RangeVar");
  if (rangeVar) {
    return sourceInfoForRangeVar(rangeVar, defaultSchema, tablesByKey, ctes);
  }

  const rangeSubselect = astNodeOf(item, "RangeSubselect");
  if (rangeSubselect) {
    return sourceInfoForRangeSubselect(
      rangeSubselect,
      defaultSchema,
      tablesByKey,
      functionsByKey,
      ctes,
      outerFromInfo
    );
  }

  const join = astNodeOf(item, "JoinExpr");
  if (join) {
    return sourceInfoForJoin(join, defaultSchema, tablesByKey, functionsByKey, ctes, outerFromInfo);
  }
}

function sourceInfoForRangeVar(
  rangeVar: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  ctes: Map<string, ColumnShape[]>
): SourceInfo | undefined {
  const relname = readString(rangeVar?.relname);
  if (!relname) {
    return;
  }
  const explicitSchemaName = readString(rangeVar?.schemaname);
  const schemaName = explicitSchemaName ?? defaultSchema;
  const columns =
    explicitSchemaName === undefined
      ? (ctes.get(relname) ?? tablesByKey.get(`${schemaName}.${relname}`)?.columns)
      : tablesByKey.get(`${schemaName}.${relname}`)?.columns;
  if (!columns) {
    return;
  }
  const aliasName = readString(asRecord(rangeVar.alias)?.aliasname);
  const qualifiedName = `${schemaName}.${relname}`;
  return sourceInfoFromColumns(
    columns,
    aliasName ? [relname, aliasName, qualifiedName] : [relname, qualifiedName]
  );
}

function sourceInfoForRangeSubselect(
  rangeSubselect: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey,
  ctes: Map<string, ColumnShape[]>,
  outerFromInfo?: SourceInfo
): SourceInfo | undefined {
  const query = selectStatement(rangeSubselect.subquery);
  if (!query) {
    return;
  }
  const alias = asRecord(rangeSubselect.alias);
  const aliasName = readString(alias?.aliasname);
  const columns = applyColumnAliases(
    columnsForSelect(
      query,
      defaultSchema,
      tablesByKey,
      functionsByKey,
      ctes,
      rangeSubselect.lateral === true ? outerFromInfo : undefined
    ),
    stringList(alias?.colnames)
  );
  return sourceInfoFromColumns(columns, aliasName ? [aliasName] : []);
}

function sourceInfoForJoin(
  join: Record<string, unknown>,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey,
  ctes: Map<string, ColumnShape[]>,
  outerFromInfo?: SourceInfo
): SourceInfo | undefined {
  const left = sourceInfoForFromItem(
    join.larg,
    defaultSchema,
    tablesByKey,
    functionsByKey,
    ctes,
    outerFromInfo
  );
  const right = sourceInfoForFromItem(
    join.rarg,
    defaultSchema,
    tablesByKey,
    functionsByKey,
    ctes,
    combinedSourceInfo(outerFromInfo, left)
  );
  const alias = asRecord(join.alias);
  const aliasName = readString(alias?.aliasname);
  if (!left) {
    return aliasName && right
      ? sourceInfoFromColumns(applyColumnAliases(right.columns, stringList(alias?.colnames)), [
          aliasName,
        ])
      : right;
  }
  if (!right) {
    return aliasName
      ? sourceInfoFromColumns(applyColumnAliases(left.columns, stringList(alias?.colnames)), [
          aliasName,
        ])
      : left;
  }
  const usingNames = joinUsingColumnNames(join, left, right);
  const columns = applyColumnAliases(
    usingNames.length > 0
      ? mergedUsingJoinColumns(left.columns, right.columns, usingNames)
      : [...left.columns, ...right.columns],
    stringList(alias?.colnames)
  );
  if (aliasName) {
    return sourceInfoFromColumns(columns, [aliasName]);
  }
  return {
    columns,
    qualifiedColumns: mergedQualifiedColumns(left, right),
  };
}

function joinUsingColumnNames(
  join: Record<string, unknown>,
  left: SourceInfo,
  right: SourceInfo
): string[] {
  const explicit = uniqueStrings(stringList(join.usingClause));
  if (explicit.length > 0) {
    return explicit;
  }
  if (join.isNatural === true) {
    const rightNames = new Set(right.columns.map((column) => column.name));
    return uniqueStrings(
      left.columns.map((column) => column.name).filter((name) => rightNames.has(name))
    );
  }
  return [];
}

function mergedUsingJoinColumns(
  leftColumns: ColumnShape[],
  rightColumns: ColumnShape[],
  usingNames: string[]
): ColumnShape[] {
  const using = new Set(usingNames);
  const leftByName = new Map<string, ColumnShape>();
  const rightByName = new Map<string, ColumnShape>();
  for (const column of leftColumns) {
    leftByName.set(column.name, column);
  }
  for (const column of rightColumns) {
    rightByName.set(column.name, column);
  }
  const merged: ColumnShape[] = [];
  for (const name of usingNames) {
    const column = leftByName.get(name) ?? rightByName.get(name);
    if (column) {
      merged.push(column);
    }
  }
  return [
    ...merged,
    ...leftColumns.filter((column) => !using.has(column.name)),
    ...rightColumns.filter((column) => !using.has(column.name)),
  ];
}

function sourceInfoFromColumns(columns: ColumnShape[], names: string[]): SourceInfo | undefined {
  if (columns.length === 0) {
    return;
  }
  const qualifiedColumns = new Map<string, ColumnShape[]>();
  for (const name of names) {
    setQualifiedColumns(qualifiedColumns, name, columns);
  }
  return { columns: [...columns], qualifiedColumns };
}

function mergeSourceInfo(target: SourceInfo, source: SourceInfo): void {
  target.columns.push(...source.columns);
  for (const [name, columns] of source.qualifiedColumns) {
    setQualifiedColumns(target.qualifiedColumns, name, columns);
  }
}

function mergedQualifiedColumns(...sources: SourceInfo[]): Map<string, ColumnShape[]> {
  const qualifiedColumns = new Map<string, ColumnShape[]>();
  for (const source of sources) {
    for (const [name, columns] of source.qualifiedColumns) {
      setQualifiedColumns(qualifiedColumns, name, columns);
    }
  }
  return qualifiedColumns;
}

function combinedSourceInfo(...sources: (SourceInfo | undefined)[]): SourceInfo | undefined {
  const info: SourceInfo = { columns: [], qualifiedColumns: new Map() };
  for (const source of sources) {
    if (source) {
      mergeSourceInfo(info, source);
    }
  }
  return info.columns.length > 0 ? info : undefined;
}

function setQualifiedColumns(
  qualifiedColumns: Map<string, ColumnShape[]>,
  name: string,
  columns: ColumnShape[]
): void {
  const existing = qualifiedColumns.get(name);
  if (existing === undefined) {
    qualifiedColumns.set(name, columns);
    return;
  }
  if (existing !== columns) {
    qualifiedColumns.set(name, []);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function applyColumnAliases(columns: ColumnShape[], aliasNames: string[]): ColumnShape[] {
  if (aliasNames.length === 0) {
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
    case "A_Const": {
      const constant = astNodeOf(expression, "A_Const");
      return constantType(constant);
    }
    case "FuncCall": {
      const func = astNodeOf(expression, "FuncCall");
      return func ? functionReturnType(func, context) : undefined;
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
  const fields = stringList(columnRef.fields);
  const columnName = fields.at(-1);
  if (!columnName) {
    return;
  }
  if (fields.length > 1) {
    const qualifier = fields.slice(0, -1).join(".");
    const localColumns = fromInfo?.qualifiedColumns.get(String(qualifier));
    if (localColumns) {
      return localColumns.find((column) => column.name === columnName)?.type;
    }
    return context.outerFromInfo?.qualifiedColumns
      .get(String(qualifier))
      ?.find((column) => column.name === columnName)?.type;
  }
  const localMatches = fromInfo?.columns.filter((column) => column.name === columnName);
  if (localMatches && localMatches.length > 0) {
    return localMatches.length === 1 ? localMatches[0]?.type : undefined;
  }
  const outerMatches = context.outerFromInfo?.columns.filter(
    (column) => column.name === columnName
  );
  return outerMatches?.length === 1 ? outerMatches[0]?.type : undefined;
}

function firstKnownType(expressions: unknown[], context: InferenceContext): string | undefined {
  for (const expression of expressions) {
    const type = inferExpressionType(expression, context);
    if (type && type !== "unknown") {
      return type;
    }
  }
}

function constantType(constant: Record<string, unknown> | undefined): string | undefined {
  if (!constant) {
    return;
  }
  if (asRecord(constant.boolval) !== undefined) {
    return "boolean";
  }
  if (readNumber(asRecord(constant.ival)?.ival) !== undefined) {
    return "integer";
  }
  if (asRecord(constant.fval) !== undefined) {
    return "numeric";
  }
  if (asRecord(constant.sval) !== undefined) {
    return "text";
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
  if (booleanSubLinkTypes.has(kind)) {
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
    context.functionsByKey,
    context.ctes,
    combinedSourceInfo(context.outerFromInfo, context.fromInfo)
  ).at(0);
  if (!(firstColumn?.type && firstColumn.type !== "unknown")) {
    return;
  }
  if (kind === "ARRAY_SUBLINK") {
    return `${firstColumn.type}[]`;
  }
  return kind === "EXPR_SUBLINK" ? firstColumn.type : undefined;
}

function functionReturnType(
  func: Record<string, unknown>,
  context: InferenceContext
): string | undefined {
  const parts = stringList(func.funcname);
  if (parts.length === 0) {
    return;
  }
  const name = parts.join(".");
  const argTypes = readArray(func.args).map((arg) => inferExpressionType(arg, context));
  const visibleFunctions =
    parts.length === 1
      ? (context.functionsByKey.get(`${context.defaultSchema}.${name}`) ?? [])
      : (context.functionsByKey.get(name) ?? []);
  const modeledReturn = matchingFunctionReturnType(visibleFunctions, argTypes);
  if (modeledReturn) {
    return modeledReturn;
  }
  if (parts.length > 1 || visibleFunctions.length > 0) {
    return;
  }
  return functionTypeMap.get(name);
}

function matchingFunctionReturnType(
  functions: FunctionShape[],
  argTypes: (string | undefined)[]
): string | undefined {
  for (const fn of functions) {
    if (!fn.returns || fn.returns.columns !== undefined) {
      continue;
    }
    if (functionArgsMatch(fn.args, argTypes)) {
      return fn.returns.type;
    }
  }
}

function functionArgsMatch(args: FunctionShape["args"], argTypes: (string | undefined)[]): boolean {
  const requiredArgs = args.filter((arg) => !arg.optional).length;
  if (argTypes.length < requiredArgs || argTypes.length > args.length) {
    return false;
  }
  return argTypes.every((argType, index) => {
    const expected = args[index]?.type;
    return (
      argType !== undefined &&
      argType !== "unknown" &&
      expected !== undefined &&
      normalizeSqlType(argType) === normalizeSqlType(expected)
    );
  });
}

function normalizeSqlType(type: string): string {
  return type.toLowerCase();
}

function selectStatement(value: unknown): Record<string, unknown> | undefined {
  return astNodeOf(value, "SelectStmt");
}

const booleanSubLinkTypes = new Set([
  "ALL_SUBLINK",
  "ANY_SUBLINK",
  "EXISTS_SUBLINK",
  "ROWCOMPARE_SUBLINK",
]);

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
