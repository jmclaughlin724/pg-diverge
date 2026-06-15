import type { ObjectRef, SchemaObject, TableColumn } from "../core.js";
import { sha256, stableJson } from "../hash.js";
import type { AstNode } from "./ast.js";
import { asRecord, columnFacts, readArray, readNumber, readString } from "./ast.js";
import { normalizeSql, objectKey } from "./identifiers.js";

export function makeObject(
  ref: ObjectRef,
  statement: string,
  ordinal: number,
  file?: string,
  metadata: Record<string, unknown> = {}
): SchemaObject {
  const normalizedSql = normalizeSql(statement);
  const key = objectKey(ref);
  const object: SchemaObject = {
    dependencies: [],
    hash: sha256(stableJson({ key, normalizedSql, ref })),
    key,
    metadata,
    normalizedSql,
    ordinal,
    ref,
    sql: normalizedSql,
  };
  if (file) {
    object.file = file;
  }
  return object;
}

export interface TableElement {
  end: number;
  isColumn: boolean;
  node: AstNode;
  start: number;
}

export function toByteString(sql: string): string {
  return Buffer.from(sql, "utf8").toString("latin1");
}

export function fromByteString(bytes: string): string {
  return Buffer.from(bytes, "latin1").toString("utf8");
}

export function tableMetadataFromAst(
  createStmt: AstNode,
  sql: string,
  byteOffset = 0
): Record<string, unknown> {
  const bytes = toByteString(sql);
  const elements = tableElements(createStmt, bytes, byteOffset);
  const columns: TableColumn[] = [];
  const constraintFragments: string[] = [];
  for (const element of elements) {
    const text = fromByteString(elementText(bytes, element));
    if (!element.isColumn) {
      constraintFragments.push(normalizeSql(text));
      continue;
    }
    const facts = columnFacts({ ColumnDef: element.node });
    if (!facts) {
      continue;
    }
    const column: TableColumn = {
      definition: normalizeSql(stripLeadingIdentifier(text)),
      generated: facts.generated,
      hasDefault: facts.hasDefault,
      hasInlineConstraint: facts.hasInlineConstraint,
      identity: facts.identity,
      name: facts.name,
      notNull: facts.notNull,
      type: facts.type,
    };
    const defaultExpression = columnDefaultExpression(element, bytes, byteOffset);
    if (defaultExpression !== undefined) {
      column.defaultExpression = fromByteString(defaultExpression);
    }
    columns.push(column);
  }
  return {
    columns,
    constraintFragments: constraintFragments.sort((left, right) => left.localeCompare(right)),
  };
}

export function tableElements(createStmt: AstNode, sql: string, byteOffset = 0): TableElement[] {
  const relationLocation = (readNumber(asRecord(createStmt.relation)?.location) ?? 0) - byteOffset;
  const open = findCharOutsideQuotes(sql, "(", Math.max(relationLocation, 0));
  if (open === -1) {
    return [];
  }
  const close = findMatchingParen(sql, open);
  if (close === -1) {
    return [];
  }
  const located: { isColumn: boolean; location: number; node: AstNode }[] = [];
  for (const item of readArray(createStmt.tableElts)) {
    const columnDef = asRecord(asRecord(item)?.ColumnDef);
    if (columnDef) {
      const location = readNumber(columnDef.location);
      if (location !== undefined) {
        located.push({ isColumn: true, location: location - byteOffset, node: columnDef });
      }
      continue;
    }
    const constraint = asRecord(asRecord(item)?.Constraint);
    if (constraint) {
      const location = readNumber(constraint.location);
      if (location !== undefined) {
        located.push({ isColumn: false, location: location - byteOffset, node: constraint });
      }
    }
  }
  located.sort((left, right) => left.location - right.location);
  return located.map((element, index) => ({
    end: located[index + 1]?.location ?? close,
    isColumn: element.isColumn,
    node: element.node,
    start: element.location,
  }));
}

function columnDefaultExpression(
  element: TableElement,
  sql: string,
  byteOffset = 0
): string | undefined {
  const constraints = readArray(element.node.constraints)
    .map((item) => asRecord(asRecord(item)?.Constraint))
    .filter((item): item is AstNode => item !== undefined);
  const located = constraints
    .map((constraint) => ({
      constraint,
      location: (readNumber(constraint.location) ?? -1) - byteOffset,
    }))
    .filter((item) => item.location >= 0)
    .sort((left, right) => left.location - right.location);
  for (const [index, item] of located.entries()) {
    if (readString(item.constraint.contype) !== "CONSTR_DEFAULT") {
      continue;
    }
    const expressionStart = expressionLocation(item.constraint.raw_expr);
    if (expressionStart === undefined) {
      return;
    }
    const end = located[index + 1]?.location ?? element.end;
    let text = sql.slice(expressionStart - byteOffset, end).trim();
    if (text.endsWith(",")) {
      text = text.slice(0, -1).trimEnd();
    }
    return text.length > 0 ? text : undefined;
  }
  return;
}

function expressionLocation(expression: unknown): number | undefined {
  const record = asRecord(expression);
  if (!record) {
    return;
  }
  let earliest: number | undefined;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    const node = asRecord(value);
    if (!node) {
      return;
    }
    const location = readNumber(node.location);
    if (
      location !== undefined &&
      location >= 0 &&
      (earliest === undefined || location < earliest)
    ) {
      earliest = location;
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  };
  visit(record);
  return earliest;
}

export function elementText(sql: string, element: TableElement): string {
  let text = sql.slice(element.start, element.end).trim();
  if (text.endsWith(",")) {
    text = text.slice(0, -1).trimEnd();
  }
  return text;
}

function stripLeadingIdentifier(text: string): string {
  if (text.startsWith('"')) {
    let index = 1;
    while (index < text.length) {
      if (text[index] === '"' && text[index + 1] === '"') {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        break;
      }
      index += 1;
    }
    return text.slice(index).trim();
  }
  let length = 0;
  while (length < text.length) {
    const char = text[length] ?? "";
    const isWordChar =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9" && length > 0) ||
      char === "_" ||
      (char === "$" && length > 0);
    if (!isWordChar) {
      break;
    }
    length += 1;
  }
  return length > 0 ? text.slice(length).trim() : text;
}

export function findCharOutsideQuotes(input: string, target: string, from: number): number {
  let index = from;
  while (index < input.length) {
    const char = input[index] ?? "";
    if (isSqlQuote(char)) {
      index = skipSqlQuoted(input, index, char);
      continue;
    }
    if (char === target) {
      return index;
    }
    index += 1;
  }
  return -1;
}

export function findMatchingParen(input: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < input.length) {
    const char = input[index] ?? "";
    if (isSqlQuote(char)) {
      index = skipSqlQuoted(input, index, char);
      continue;
    }
    if (char === "(") {
      depth += 1;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return -1;
}

function isSqlQuote(char: string): char is "'" | '"' {
  return char === "'" || char === '"';
}

function skipSqlQuoted(input: string, start: number, quote: "'" | '"'): number {
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];
    if (char === quote && next === quote) {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }
  return input.length;
}
