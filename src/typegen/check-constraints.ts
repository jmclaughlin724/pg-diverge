import type { AstNode } from "../sql/ast.js";
import {
  asRecord,
  astNodeOf,
  listItems,
  readArray,
  readNumber,
  readString,
  stringList,
  typeNameToSql,
} from "../sql/ast.js";
import { quoteCodeString } from "./database.js";
import type {
  CheckConstraintShape,
  ResolvedColumnType,
  SchemaShapes,
  TableShape,
} from "./model.js";
import { chaseColumnType } from "./model.js";

export interface ObjectCheckFragment {
  columns: string[];
  fragment: string;
}

export interface TableCheckFragments {
  row: Map<string, string>;
  rowObject: ObjectCheckFragment[];
  write: Map<string, string>;
  writeObject: ObjectCheckFragment[];
}

type TranslatedConjunct =
  | { column: string; fragment: string; kind: "column" }
  | { columns: string[]; fragment: string; kind: "object" };

type Operand =
  | { column: string; kind: "charLength" }
  | { column: string; kind: "column" }
  | { kind: "float"; value: number }
  | { kind: "integer"; value: number }
  | { kind: "text"; value: string };

interface CheckColumnTarget {
  arrayDepth: number;
  baseType: string;
  hasExplicitCollation: boolean;
  kind: ResolvedColumnType["kind"];
  sawTypmod: boolean;
}

interface OperandContext {
  schemaName: string;
  shapes: SchemaShapes;
  table: TableShape;
  valueColumn: string | undefined;
}

export type CheckConstraintTranslator = (
  table: TableShape,
  schemaName: string
) => TableCheckFragments;

export function createCheckConstraintTranslator(shapes: SchemaShapes): CheckConstraintTranslator {
  const domainFragments = new Map<string, string[]>();
  return (table, schemaName) => translateTableChecks(table, shapes, schemaName, domainFragments);
}

function translateTableChecks(
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  domainFragmentCache: Map<string, string[]>
): TableCheckFragments {
  const row = new Map<string, string[]>();
  const write = new Map<string, string[]>();
  const rowObject: ObjectCheckFragment[] = [];
  const writeObject: ObjectCheckFragment[] = [];
  appendConstraints(
    table.checkConstraints,
    table,
    shapes,
    schemaName,
    row,
    rowObject,
    write,
    writeObject
  );
  appendDomainTranslations(row, write, table, shapes, schemaName, domainFragmentCache);
  return {
    row: joinColumnFragments(row),
    rowObject: dedupeObjectFragments(rowObject),
    write: joinColumnFragments(write),
    writeObject: dedupeObjectFragments(writeObject),
  };
}

function appendConstraints(
  checkConstraints: CheckConstraintShape[],
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  row: Map<string, string[]>,
  rowObject: ObjectCheckFragment[],
  write: Map<string, string[]>,
  writeObject: ObjectCheckFragment[],
  valueColumn?: string
): void {
  const constraints = [...checkConstraints].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const constraint of constraints) {
    for (const conjunct of checkConjuncts(constraint.expression)) {
      const translated = translateConjunct(conjunct, table, shapes, schemaName, valueColumn);
      if (!translated) {
        continue;
      }
      appendTranslation(write, writeObject, translated);
      if (!constraint.skipValidation) {
        appendTranslation(row, rowObject, translated);
      }
    }
  }
}

function appendDomainTranslations(
  row: Map<string, string[]>,
  write: Map<string, string[]>,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  cache: Map<string, string[]>
): void {
  for (const column of table.columns) {
    const chase = chaseColumnType(shapes, schemaName, column.type);
    if (chase.arrayDepth !== 0) {
      continue;
    }
    for (const domainKey of chase.domainChain) {
      for (const fragment of domainCheckFragments(domainKey, shapes, cache)) {
        appendColumnFragment(row, column.name, fragment);
        appendColumnFragment(write, column.name, fragment);
      }
    }
  }
}

function domainCheckFragments(
  domainKey: string,
  shapes: SchemaShapes,
  cache: Map<string, string[]>
): string[] {
  const cached = cache.get(domainKey);
  if (cached !== undefined) {
    return cached;
  }
  const domain = shapes.domains.get(domainKey);
  if (!domain) {
    cache.set(domainKey, []);
    return [];
  }
  const valueColumn = "__domain_value__";
  const table: TableShape = {
    checkConstraints: domain.checkConstraints,
    columns: [{ name: valueColumn, notNull: false, type: domainKey }],
    name: domainKey,
    relationships: [],
    uniqueColumnSets: [],
  };
  const row = new Map<string, string[]>();
  appendConstraints(
    domain.checkConstraints,
    table,
    shapes,
    schemaNameForDomain(domainKey),
    row,
    [],
    new Map(),
    [],
    valueColumn
  );
  const fragments = [...(row.get(valueColumn) ?? [])];
  cache.set(domainKey, fragments);
  return fragments;
}

function schemaNameForDomain(domainKey: string): string {
  const separator = domainKey.lastIndexOf(".");
  return separator === -1 ? "public" : domainKey.slice(0, separator);
}

function appendTranslation(
  columns: Map<string, string[]>,
  objects: ObjectCheckFragment[],
  translated: TranslatedConjunct
): void {
  if (translated.kind === "column") {
    appendColumnFragment(columns, translated.column, translated.fragment);
    return;
  }
  objects.push({ columns: translated.columns, fragment: translated.fragment });
}

function appendColumnFragment(
  columns: Map<string, string[]>,
  column: string,
  fragment: string
): void {
  const fragments = columns.get(column) ?? [];
  fragments.push(fragment);
  columns.set(column, fragments);
}

function joinColumnFragments(columns: Map<string, string[]>): Map<string, string> {
  return new Map(
    [...columns].map(([column, fragments]) => [column, [...new Set(fragments)].join("")])
  );
}

function dedupeObjectFragments(objects: ObjectCheckFragment[]): ObjectCheckFragment[] {
  const seen = new Set<string>();
  const deduped: ObjectCheckFragment[] = [];
  for (const object of objects) {
    if (seen.has(object.fragment)) {
      continue;
    }
    seen.add(object.fragment);
    deduped.push(object);
  }
  return deduped;
}

function checkConjuncts(node: AstNode): AstNode[] {
  const bool = astNodeOf(node, "BoolExpr");
  if (bool && readString(bool.boolop) === "AND_EXPR") {
    const conjuncts: AstNode[] = [];
    for (const arg of readArray(bool.args)) {
      const record = asRecord(arg);
      if (record) {
        conjuncts.push(...checkConjuncts(record));
      }
    }
    return conjuncts;
  }
  return [node];
}

function translateConjunct(
  node: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const aExpr = astNodeOf(node, "A_Expr");
  if (aExpr) {
    return translateComparison(aExpr, table, shapes, schemaName, valueColumn);
  }
  const columnRef = astNodeOf(node, "ColumnRef");
  if (columnRef) {
    return translateBooleanColumn(columnRef, table, shapes, schemaName, valueColumn);
  }
}

function translateComparison(
  aExpr: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const kind = readString(aExpr.kind);
  if (kind === "AEXPR_OP") {
    return translateOperator(aExpr, table, shapes, schemaName, valueColumn);
  }
  if (kind === "AEXPR_IN") {
    return translateInList(aExpr, table, shapes, schemaName, valueColumn);
  }
  if (kind === "AEXPR_BETWEEN") {
    return translateBetween(aExpr, table, shapes, schemaName, valueColumn);
  }
}

function translateOperator(
  aExpr: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const operator = operatorName(aExpr);
  if (operator === undefined) {
    return;
  }
  const context = { schemaName, shapes, table, valueColumn };
  let left = classifyOperand(aExpr.lexpr, context);
  let right = classifyOperand(aExpr.rexpr, context);
  let oriented = operator;
  if (!(left && right)) {
    return;
  }
  if (left.kind === "column" && right.kind === "column") {
    return translateColumnPair(left.column, operator, right.column, table, shapes, schemaName);
  }
  if (isValueOperand(left) && !isValueOperand(right)) {
    const mirrored = mirrorOperators.get(operator);
    if (mirrored === undefined) {
      return;
    }
    [left, right] = [right, left];
    oriented = mirrored;
  }
  if (left.kind === "column" && (right.kind === "integer" || right.kind === "float")) {
    return translateNumericBound(left.column, oriented, right, table, shapes, schemaName);
  }
  if (left.kind === "charLength" && right.kind === "integer") {
    return translateLengthBound(left.column, oriented, right.value, table, shapes, schemaName);
  }
}

function translateNumericBound(
  column: string,
  operator: string,
  literal: { kind: "float" | "integer"; value: number },
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string
): TranslatedConjunct | undefined {
  const target = checkColumnTarget(table, shapes, schemaName, column);
  if (!(target && soundNumericTarget(target))) {
    return;
  }
  const rendered = String(literal.value);
  if (literal.kind === "integer") {
    if (!Number.isSafeInteger(literal.value)) {
      return;
    }
    const nonStrictMethod = nonStrictNumericMethods.get(operator);
    if (nonStrictMethod !== undefined) {
      return { column, fragment: `.${nonStrictMethod}(${rendered})`, kind: "column" };
    }
    const strictMethod = strictNumericMethods.get(operator);
    if (strictMethod !== undefined && scalarExactNumericTarget(target)) {
      return { column, fragment: `.${strictMethod}(${rendered})`, kind: "column" };
    }
    if (operator === "<>" && scalarExactNumericTarget(target)) {
      return { column, fragment: `.refine((value) => value !== ${rendered})`, kind: "column" };
    }
    if (operator === "=" && exactIntegerTypes.has(target.baseType)) {
      return { column, fragment: `.refine((value) => value === ${rendered})`, kind: "column" };
    }
    return;
  }
  const method = nonStrictNumericMethods.get(operator);
  if (method !== undefined && Number.isFinite(literal.value)) {
    return { column, fragment: `.${method}(${rendered})`, kind: "column" };
  }
}

function translateLengthBound(
  column: string,
  operator: string,
  length: number,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string
): TranslatedConjunct | undefined {
  const target = checkColumnTarget(table, shapes, schemaName, column);
  if (
    !(
      target &&
      target.arrayDepth === 0 &&
      !target.sawTypmod &&
      charLengthTypes.has(target.baseType)
    )
  ) {
    return;
  }
  if (!Number.isSafeInteger(length)) {
    return;
  }
  if (operator === ">=") {
    return { column, fragment: `.min(${String(Math.max(length, 0))})`, kind: "column" };
  }
  if (operator === ">") {
    return { column, fragment: `.min(${String(Math.max(length + 1, 0))})`, kind: "column" };
  }
  if (operator === "<=") {
    return {
      column,
      fragment: `.refine((value) => [...value].length <= ${String(length)})`,
      kind: "column",
    };
  }
  if (operator === "<") {
    return {
      column,
      fragment: `.refine((value) => [...value].length < ${String(length)})`,
      kind: "column",
    };
  }
}

function translateInList(
  aExpr: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const operator = operatorName(aExpr);
  if (!(operator === "=" || operator === "<>")) {
    return;
  }
  const context = { schemaName, shapes, table, valueColumn };
  const left = classifyOperand(aExpr.lexpr, context);
  if (left?.kind !== "column") {
    return;
  }
  const target = checkColumnTarget(table, shapes, schemaName, left.column);
  if (
    !(
      target &&
      target.arrayDepth === 0 &&
      !target.hasExplicitCollation &&
      !target.sawTypmod &&
      inListTypes.has(target.baseType)
    )
  ) {
    return;
  }
  const items = listItems(aExpr.rexpr);
  if (items.length === 0) {
    return;
  }
  const values: string[] = [];
  for (const item of items) {
    const operand = classifyOperand(item, context);
    if (operand?.kind !== "text") {
      return;
    }
    values.push(operand.value);
  }
  const list = `[${values.map(quoteCodeString).join(", ")}]`;
  const test = operator === "=" ? `${list}.includes(value)` : `!${list}.includes(value)`;
  return { column: left.column, fragment: `.refine((value) => ${test})`, kind: "column" };
}

function translateBetween(
  aExpr: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const context = { schemaName, shapes, table, valueColumn };
  const left = classifyOperand(aExpr.lexpr, context);
  if (left?.kind !== "column") {
    return;
  }
  const bounds = listItems(aExpr.rexpr);
  if (bounds.length !== 2) {
    return;
  }
  const lower = classifyNumericLiteral(bounds[0], context);
  const upper = classifyNumericLiteral(bounds[1], context);
  if (!(lower && upper)) {
    return;
  }
  const target = checkColumnTarget(table, shapes, schemaName, left.column);
  if (!(target && soundNumericTarget(target))) {
    return;
  }
  return {
    column: left.column,
    fragment: `.gte(${String(lower.value)}).lte(${String(upper.value)})`,
    kind: "column",
  };
}

function classifyNumericLiteral(
  node: unknown,
  context: OperandContext
): { value: number } | undefined {
  const operand = classifyOperand(node, context);
  if (!operand) {
    return;
  }
  if (operand.kind === "integer") {
    return Number.isSafeInteger(operand.value) ? { value: operand.value } : undefined;
  }
  if (operand.kind === "float") {
    return Number.isFinite(operand.value) ? { value: operand.value } : undefined;
  }
}

function translateColumnPair(
  leftColumn: string,
  operator: string,
  rightColumn: string,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string
): TranslatedConjunct | undefined {
  const jsOperator = pairOperators.get(operator);
  if (jsOperator === undefined) {
    return;
  }
  const left = checkColumnTarget(table, shapes, schemaName, leftColumn);
  const right = checkColumnTarget(table, shapes, schemaName, rightColumn);
  if (!(left && right)) {
    return;
  }
  if (!(soundNumericTarget(left) && soundNumericTarget(right))) {
    return;
  }
  if (
    precisionSensitivePairOperators.has(operator) &&
    !(losslessPairTarget(left) && losslessPairTarget(right))
  ) {
    return;
  }
  const leftAccess = `value[${quoteCodeString(leftColumn)}]`;
  const rightAccess = `value[${quoteCodeString(rightColumn)}]`;
  const fragment = `.refine((value) => ${leftAccess} == null || ${rightAccess} == null || ${leftAccess} ${jsOperator} ${rightAccess})`;
  const columns = leftColumn === rightColumn ? [leftColumn] : [leftColumn, rightColumn];
  return { columns, fragment, kind: "object" };
}

function translateBooleanColumn(
  columnRef: AstNode,
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  valueColumn?: string
): TranslatedConjunct | undefined {
  const column = bareColumnName(columnRef, valueColumn);
  if (column === undefined) {
    return;
  }
  const target = checkColumnTarget(table, shapes, schemaName, column);
  if (!(target && target.arrayDepth === 0 && target.kind === "boolean")) {
    return;
  }
  return { column, fragment: ".refine((value) => value === true)", kind: "column" };
}

function operatorName(aExpr: AstNode): string | undefined {
  const names = stringList(aExpr.name);
  return names.length === 1 ? names[0] : undefined;
}

function isValueOperand(operand: Operand): boolean {
  return operand.kind === "float" || operand.kind === "integer" || operand.kind === "text";
}

function classifyOperand(node: unknown, context: OperandContext): Operand | undefined {
  const wrapper = asRecord(node);
  if (!wrapper) {
    return;
  }
  const columnRef = asRecord(wrapper.ColumnRef);
  if (columnRef) {
    const column = bareColumnName(columnRef, context.valueColumn);
    return column === undefined ? undefined : { column, kind: "column" };
  }
  const constant = asRecord(wrapper.A_Const);
  if (constant) {
    return classifyConstant(constant);
  }
  const funcCall = asRecord(wrapper.FuncCall);
  if (funcCall) {
    return classifyCharLength(funcCall, context);
  }
  const typeCast = asRecord(wrapper.TypeCast);
  if (typeCast) {
    return classifyTypeCast(typeCast, context);
  }
  const aExpr = asRecord(wrapper.A_Expr);
  if (aExpr) {
    return classifyNegatedConstant(aExpr, context);
  }
}

function bareColumnName(columnRef: AstNode, valueColumn?: string): string | undefined {
  if (readArray(columnRef.fields).length !== 1) {
    return;
  }
  const names = stringList(columnRef.fields);
  const name = names.length === 1 ? names[0] : undefined;
  return valueColumn !== undefined && name === "value" ? valueColumn : name;
}

function classifyConstant(constant: AstNode): Operand | undefined {
  if (constant.isnull === true) {
    return;
  }
  if ("ival" in constant) {
    return { kind: "integer", value: readNumber(asRecord(constant.ival)?.ival) ?? 0 };
  }
  if ("fval" in constant) {
    const raw = readString(asRecord(constant.fval)?.fval);
    const value = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? { kind: "float", value } : undefined;
  }
  if ("sval" in constant) {
    const value = readString(asRecord(constant.sval)?.sval);
    return value === undefined ? undefined : { kind: "text", value };
  }
}

function classifyNegatedConstant(aExpr: AstNode, context: OperandContext): Operand | undefined {
  if (readString(aExpr.kind) !== "AEXPR_OP" || aExpr.lexpr !== undefined) {
    return;
  }
  if (operatorName(aExpr) !== "-") {
    return;
  }
  const operand = classifyOperand(aExpr.rexpr, context);
  if (operand?.kind === "integer" || operand?.kind === "float") {
    return { kind: operand.kind, value: -operand.value };
  }
}

function classifyCharLength(funcCall: AstNode, context: OperandContext): Operand | undefined {
  const names = stringList(funcCall.funcname).filter((part) => part !== "pg_catalog");
  const name = names.length === 1 ? names[0] : undefined;
  if (!(name === "char_length" || name === "length")) {
    return;
  }
  if (
    funcCall.agg_distinct === true ||
    funcCall.agg_star === true ||
    funcCall.agg_order !== undefined ||
    funcCall.agg_filter !== undefined ||
    funcCall.over !== undefined
  ) {
    return;
  }
  const args = readArray(funcCall.args);
  if (args.length !== 1) {
    return;
  }
  const operand = classifyOperand(args[0], context);
  return operand?.kind === "column" ? { column: operand.column, kind: "charLength" } : undefined;
}

function classifyTypeCast(typeCast: AstNode, context: OperandContext): Operand | undefined {
  const typeName = asRecord(asRecord(typeCast.typeName)?.TypeName) ?? asRecord(typeCast.typeName);
  if (!typeName || typeName.typmods !== undefined) {
    return;
  }
  const operand = classifyOperand(typeCast.arg, context);
  if (operand?.kind !== "column") {
    return;
  }
  const source = checkColumnTarget(
    context.table,
    context.shapes,
    context.schemaName,
    operand.column
  );
  const targetBaseType = typeNameToSql(typeName).toLowerCase();
  if (
    source?.arrayDepth !== 0 ||
    source.sawTypmod ||
    source.baseType !== targetBaseType ||
    !castUnwrapTypes.has(targetBaseType)
  ) {
    return;
  }
  return operand;
}

function checkColumnTarget(
  table: TableShape,
  shapes: SchemaShapes,
  schemaName: string,
  column: string
): CheckColumnTarget | undefined {
  const declared = table.columns.find((item) => item.name === column);
  if (declared === undefined) {
    return;
  }
  const chase = chaseColumnType(shapes, schemaName, declared.type);
  return {
    arrayDepth: chase.arrayDepth,
    baseType: chase.baseTypeName.toLowerCase(),
    hasExplicitCollation:
      declared.collation !== undefined ||
      chase.domainChain.some((domainKey) => shapes.domains.get(domainKey)?.collation !== undefined),
    kind: chase.kind,
    sawTypmod: chase.sawTypmod,
  };
}

function soundNumericTarget(target: CheckColumnTarget): boolean {
  if (target.arrayDepth !== 0 || target.kind !== "number") {
    return false;
  }
  if (exactIntegerTypes.has(target.baseType) || exactFloatTypes.has(target.baseType)) {
    return true;
  }
  return bareExactNumericTypes.has(target.baseType) && !target.sawTypmod;
}

function scalarExactNumericTarget(target: CheckColumnTarget): boolean {
  return exactIntegerTypes.has(target.baseType) || exactFloatTypes.has(target.baseType);
}

function losslessPairTarget(target: CheckColumnTarget): boolean {
  return pairExactIntegerTypes.has(target.baseType) || exactFloatTypes.has(target.baseType);
}

const mirrorOperators = new Map([
  ["<", ">"],
  ["<=", ">="],
  ["<>", "<>"],
  ["=", "="],
  [">", "<"],
  [">=", "<="],
]);

const nonStrictNumericMethods = new Map([
  ["<=", "lte"],
  [">=", "gte"],
]);

const strictNumericMethods = new Map([
  ["<", "lt"],
  [">", "gt"],
]);

const pairOperators = new Map([
  ["<", "<"],
  ["<=", "<="],
  ["<>", "!=="],
  ["=", "==="],
  [">", ">"],
  [">=", ">="],
]);

const precisionSensitivePairOperators = new Set(["<", "<=", "<>", "=", ">", ">="]);

const exactIntegerTypes = new Set(["bigint", "int", "int2", "int4", "int8", "integer", "smallint"]);

const pairExactIntegerTypes = new Set(["int", "int2", "int4", "integer", "smallint"]);

const exactFloatTypes = new Set(["double precision", "float8"]);

const bareExactNumericTypes = new Set(["decimal", "numeric"]);

const charLengthTypes = new Set(["character varying", "citext", "text", "varchar"]);

const inListTypes = new Set(["character varying", "text", "varchar"]);

const castUnwrapTypes = new Set(["character varying", "citext", "text", "varchar"]);
