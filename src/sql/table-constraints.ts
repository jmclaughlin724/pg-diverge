import type { AstNode } from "./ast.js";
import { asRecord, rangeVarName, readArray, readNumber, readString, stringList } from "./ast.js";
import { formatQualifiedName, quoteIdent } from "./identifiers.js";
import type { TableElement } from "./statements.js";
import {
  elementText,
  findCharOutsideQuotes,
  findMatchingParen,
  fromByteString,
  tableElements,
  toByteString,
} from "./statements.js";

export interface SynthesizedConstraint {
  name: string;
  sql: string;
}

export function tableConstraintSyntheses(
  createStmt: AstNode,
  sql: string,
  byteOffset = 0,
): SynthesizedConstraint[] {
  const relation = rangeVarName(createStmt.relation);
  if (!relation) {
    return [];
  }
  const qualified = formatQualifiedName(relation.schema, relation.name);
  const bytes = toByteString(sql);
  const syntheses: SynthesizedConstraint[] = [];
  for (const element of tableElements(createStmt, bytes, byteOffset)) {
    if (element.isColumn) {
      syntheses.push(
        ...inlineConstraintSyntheses(element, bytes, byteOffset, relation.name, qualified),
      );
      continue;
    }
    const constraint = element.node;
    const text = fromByteString(elementText(bytes, element));
    const conname = readString(constraint.conname);
    const name = conname ?? defaultConstraintName(relation.name, constraint, []);
    if (!name) {
      continue;
    }
    const fragment = conname ? text : `CONSTRAINT ${quoteIdent(name)} ${text}`;
    syntheses.push({ name, sql: `ALTER TABLE ONLY ${qualified} ADD ${fragment}` });
  }
  return syntheses;
}

/**
 * Rebuilds the CREATE TABLE statement without its declared constraints so the
 * table object's SQL matches the columns-only shape the catalog lane emits.
 * Raw-apply consumers (verify, parity tests) then apply the table once and
 * each constraint once instead of creating hoisted constraints twice. Returns
 * undefined when the statement declares no hoistable constraints.
 */
export function stripDeclaredConstraints(
  createStmt: AstNode,
  sql: string,
  byteOffset = 0,
): string | undefined {
  const relation = asRecord(createStmt.relation);
  const bytes = toByteString(sql);
  const elements = tableElements(createStmt, bytes, byteOffset);
  if (elements.length === 0) {
    return undefined;
  }
  let strippedAny = false;
  const pieces: string[] = [];
  const primaryColumns = primaryKeyColumns(elements);
  for (const element of elements) {
    if (!element.isColumn) {
      strippedAny = true;
      continue;
    }
    const { piece, stripped } = columnPieceWithoutHoisted(element, bytes, byteOffset);
    if (stripped) {
      strippedAny = true;
    }
    if (piece.length === 0) {
      continue;
    }
    // A stripped PRIMARY KEY implied NOT NULL on its columns; spell it
    // explicitly so the rebuilt statement keeps the same column facts. The
    // AST is authoritative: the piece retains a NOT NULL span exactly when a
    // CONSTR_NOTNULL constraint exists, because NOT NULL is never hoisted.
    const columnName = readString(element.node.colname);
    if (columnName && primaryColumns.has(columnName) && !hasExplicitNotNull(element.node)) {
      pieces.push(`${piece} NOT NULL`);
      continue;
    }
    pieces.push(piece);
  }
  if (!strippedAny || pieces.length === 0) {
    return undefined;
  }
  const relationLocation = (readNumber(relation?.location) ?? 0) - byteOffset;
  const open = findCharOutsideQuotes(bytes, "(", Math.max(relationLocation, 0));
  if (open === -1) {
    return undefined;
  }
  const close = findMatchingParen(bytes, open);
  if (close === -1) {
    return undefined;
  }
  const head = bytes.slice(0, open + 1);
  const tail = bytes.slice(close);
  return fromByteString(`${head}\n  ${pieces.join(",\n  ")}\n${tail}`);
}

function primaryKeyColumns(elements: TableElement[]): Set<string> {
  const columns = new Set<string>();
  for (const element of elements) {
    if (element.isColumn) {
      const name = readString(element.node.colname);
      const hasPrimary = readArray(element.node.constraints).some(
        (item) => readString(asRecord(asRecord(item)?.Constraint)?.contype) === "CONSTR_PRIMARY",
      );
      if (name && hasPrimary) {
        columns.add(name);
      }
      continue;
    }
    if (readString(element.node.contype) === "CONSTR_PRIMARY") {
      for (const key of stringList(element.node.keys)) {
        columns.add(key);
      }
    }
  }
  return columns;
}

function hasExplicitNotNull(columnDef: AstNode): boolean {
  return readArray(columnDef.constraints).some(
    (item) => readString(asRecord(asRecord(item)?.Constraint)?.contype) === "CONSTR_NOTNULL",
  );
}

function columnPieceWithoutHoisted(
  element: TableElement,
  bytes: string,
  byteOffset: number,
): { piece: string; stripped: boolean } {
  const located = locatedInlineConstraints(element, byteOffset);
  let piece = "";
  let cursor = element.start;
  let stripped = false;
  for (const [index, item] of located.entries()) {
    const end = located[index + 1]?.location ?? element.end;
    const contype = readString(item.constraint.contype);
    if (contype && inlineConstraintTypes.has(contype)) {
      piece += bytes.slice(cursor, item.location);
      cursor = end;
      stripped = true;
    }
  }
  piece += bytes.slice(cursor, element.end);
  piece = piece.trim();
  if (piece.endsWith(",")) {
    piece = piece.slice(0, -1).trimEnd();
  }
  return { piece: fromByteString(piece), stripped };
}

function inlineConstraintSyntheses(
  element: TableElement,
  bytes: string,
  byteOffset: number,
  table: string,
  qualified: string,
): SynthesizedConstraint[] {
  const column = readString(element.node.colname);
  if (!column) {
    return [];
  }
  const located = locatedInlineConstraints(element, byteOffset);
  const syntheses: SynthesizedConstraint[] = [];
  for (const [index, item] of located.entries()) {
    const contype = readString(item.constraint.contype);
    if (!contype || !inlineConstraintTypes.has(contype)) {
      continue;
    }
    const end = located[index + 1]?.location ?? element.end;
    let text = fromByteString(bytes.slice(item.location, end)).trim();
    if (text.endsWith(",")) {
      text = text.slice(0, -1).trimEnd();
    }
    const conname = readString(item.constraint.conname);
    if (conname) {
      // The AST already classified this as a named constraint; scanning only
      // locates where the `CONSTRAINT <name>` prefix ends so the remainder
      // fits the table-level template for its type.
      text = skipConstraintNamePrefix(text);
    }
    const name = conname ?? defaultConstraintName(table, item.constraint, [column]);
    if (!name) {
      continue;
    }
    const body = inlineConstraintBody(contype, column, text);
    if (!body) {
      continue;
    }
    syntheses.push({
      name,
      sql: `ALTER TABLE ONLY ${qualified} ADD CONSTRAINT ${quoteIdent(name)} ${body}`,
    });
  }
  return syntheses;
}

/**
 * Skips a leading `CONSTRAINT <name>` token pair and returns the remainder.
 * Character scanning only — whether the constraint is named comes from the
 * AST (`conname`); this mirrors the render-guard keyword scanner in facts.ts.
 */
function skipConstraintNamePrefix(text: string): string {
  let index = skipSqlWhitespace(text, 0);
  const keywordEnd = index + "CONSTRAINT".length;
  if (text.slice(index, keywordEnd).toUpperCase() !== "CONSTRAINT") {
    return text;
  }
  index = skipSqlWhitespace(text, keywordEnd);
  if (text[index] === '"') {
    index += 1;
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
  } else {
    while (index < text.length && isIdentifierChar(text[index] ?? "")) {
      index += 1;
    }
  }
  return text.slice(skipSqlWhitespace(text, index));
}

function isIdentifierChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "$"
  );
}

function skipSqlWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function locatedInlineConstraints(
  element: TableElement,
  byteOffset: number,
): { constraint: AstNode; location: number }[] {
  return readArray(element.node.constraints)
    .map((item) => asRecord(asRecord(item)?.Constraint))
    .filter((item): item is AstNode => item !== undefined)
    .map((constraint) => ({
      constraint,
      location: (readNumber(constraint.location) ?? -1) - byteOffset,
    }))
    .filter((item) => item.location >= 0)
    .sort((left, right) => left.location - right.location);
}

const inlineConstraintTypes = new Set([
  "CONSTR_CHECK",
  "CONSTR_FOREIGN",
  "CONSTR_PRIMARY",
  "CONSTR_UNIQUE",
]);

function inlineConstraintBody(contype: string, column: string, text: string): string | undefined {
  switch (contype) {
    case "CONSTR_PRIMARY":
      return `PRIMARY KEY (${quoteIdent(column)})`;
    case "CONSTR_UNIQUE":
      return `UNIQUE (${quoteIdent(column)})`;
    case "CONSTR_CHECK":
      return text;
    case "CONSTR_FOREIGN":
      return `FOREIGN KEY (${quoteIdent(column)}) ${text}`;
    default:
      return undefined;
  }
}

function defaultConstraintName(
  table: string,
  constraint: AstNode,
  impliedColumns: string[],
): string | undefined {
  const contype = readString(constraint.contype);
  const keys = stringList(constraint.keys);
  const fkAttrs = stringList(constraint.fk_attrs);
  const columns = fkAttrs.length > 0 ? fkAttrs : keys.length > 0 ? keys : impliedColumns;
  const joined = columns.join("_");
  switch (contype) {
    case "CONSTR_PRIMARY":
      return `${table}_pkey`;
    case "CONSTR_UNIQUE":
      return joined ? `${table}_${joined}_key` : undefined;
    case "CONSTR_FOREIGN":
      return joined ? `${table}_${joined}_fkey` : undefined;
    case "CONSTR_CHECK": {
      // PostgreSQL names a check after its column only when the expression
      // references exactly one column; otherwise the bare `<table>_check`.
      const referenced = columns.length > 0 ? columns : expressionColumns(constraint.raw_expr);
      return referenced.length === 1 ? `${table}_${referenced[0]}_check` : `${table}_check`;
    }
    case "CONSTR_EXCLUSION":
      return joined ? `${table}_${joined}_excl` : undefined;
    default:
      return undefined;
  }
}

function expressionColumns(expression: unknown): string[] {
  const columns = new Set<string>();
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
    const columnRef = asRecord(node.ColumnRef);
    if (columnRef) {
      const fields = stringList(columnRef.fields);
      const name = fields.at(-1);
      if (name) {
        columns.add(name);
      }
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  };
  visit(expression);
  return [...columns];
}
