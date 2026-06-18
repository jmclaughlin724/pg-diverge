import type { AstNode } from "./ast.js";
import { asRecord, readArray, readNumber, readString, stringList, typeNameToSql } from "./ast.js";
import { stripLocations } from "./object-hash.js";

interface CanonicalColumn {
  default?: unknown;
  generated?: unknown;
  identity?: string;
  name: string;
  notNull: boolean;
  type: string;
}

export function canonicalColumnType(typeName: unknown): string {
  const base = typeNameToSql(typeName);
  const node = asRecord(asRecord(typeName)?.TypeName) ?? asRecord(typeName);
  const typmods = readArray(node?.typmods)
    .map((item) => {
      const constant = asRecord(asRecord(item)?.A_Const);
      const integer = asRecord(constant?.ival);
      const value = readNumber(integer?.ival);
      return value === undefined ? undefined : String(value);
    })
    .filter((value): value is string => value !== undefined);
  if (typmods.length === 0) {
    return base;
  }
  const arrayStart = base.indexOf("[]");
  if (arrayStart === -1) {
    return `${base}(${typmods.join(", ")})`;
  }
  return `${base.slice(0, arrayStart)}(${typmods.join(", ")})${base.slice(arrayStart)}`;
}

interface CanonicalConstraint {
  columns: string[];
  payload: Record<string, unknown>;
  type: string;
}

export function canonicalTableShape(node: AstNode): Record<string, unknown> {
  const relation = asRecord(node.relation);
  const columns: CanonicalColumn[] = [];
  const constraints: CanonicalConstraint[] = [];
  for (const item of readArray(node.tableElts)) {
    const columnDef = asRecord(asRecord(item)?.ColumnDef);
    if (columnDef) {
      columns.push(canonicalColumn(columnDef, constraints));
      continue;
    }
    const constraint = asRecord(asRecord(item)?.Constraint);
    if (constraint) {
      constraints.push(canonicalConstraint(constraint, []));
    }
  }
  const primaryColumns = new Set(
    constraints
      .filter((constraint) => constraint.type === "CONSTR_PRIMARY")
      .flatMap((constraint) => constraint.columns)
  );
  for (const column of columns) {
    if (primaryColumns.has(column.name)) {
      column.notNull = true;
    }
  }
  const shape: Record<string, unknown> = {
    columns,
    relation: {
      name: readString(relation?.relname) ?? "",
      persistence: readString(relation?.relpersistence) ?? "p",
      schema: readString(relation?.schemaname) ?? "public",
    },
  };
  for (const semanticKey of ["inhRelations", "oncommit", "options", "partspec", "tablespacename"]) {
    if (node[semanticKey] !== undefined && node[semanticKey] !== null) {
      shape[semanticKey] = stripLocations(node[semanticKey]);
    }
  }
  return shape;
}

function canonicalColumn(columnDef: AstNode, constraints: CanonicalConstraint[]): CanonicalColumn {
  const name = readString(columnDef.colname) ?? "";
  const column: CanonicalColumn = {
    name,
    notNull: false,
    type: canonicalColumnType(columnDef.typeName),
  };
  for (const item of readArray(columnDef.constraints)) {
    const constraint = asRecord(asRecord(item)?.Constraint);
    const contype = readString(constraint?.contype);
    if (!(constraint && contype)) {
      continue;
    }
    switch (contype) {
      case "CONSTR_NOTNULL":
        column.notNull = true;
        break;
      case "CONSTR_NULL":
        break;
      case "CONSTR_DEFAULT":
        column.default = canonicalizeRegclassLiterals(
          stripLocations(unwrapColumnTypeCast(constraint.raw_expr, columnDef.typeName))
        );
        break;
      case "CONSTR_IDENTITY":
        column.identity = readString(constraint.generated_when) ?? "a";
        break;
      case "CONSTR_GENERATED":
        column.generated = stripLocations(constraint.raw_expr);
        break;
      default:
        constraints.push(canonicalConstraint(constraint, [name]));
        break;
    }
  }
  return column;
}

function unwrapColumnTypeCast(expression: unknown, columnTypeName: unknown): unknown {
  const typeCast = asRecord(asRecord(expression)?.TypeCast);
  if (!typeCast) {
    return expression;
  }
  if (typeNameToSql(typeCast.typeName) !== typeNameToSql(columnTypeName)) {
    return expression;
  }
  return typeCast.arg;
}

export function canonicalizeRegclassLiterals(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => canonicalizeRegclassLiterals(item));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }
  const record = node as Record<string, unknown>;
  const typeCast = asRecord(record.TypeCast);
  if (typeCast && typeNameToSql(typeCast.typeName) === "regclass") {
    const constant = asRecord(asRecord(typeCast.arg)?.A_Const);
    const sval = asRecord(constant?.sval);
    const literal = readString(sval?.sval);
    if (literal !== undefined) {
      return { A_Const: { ...constant, sval: { sval: unquoteQualifiedName(literal) } } };
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = canonicalizeRegclassLiterals(value);
  }
  return result;
}

function unquoteQualifiedName(literal: string): string {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index];
    if (char === '"') {
      if (quoted && literal[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === "." && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.join(".");
}

const sequenceTypeMax = new Map([
  ["bigint", "9223372036854775807"],
  ["integer", "2147483647"],
  ["smallint", "32767"],
]);

export function canonicalSequenceShape(node: AstNode): Record<string, unknown> {
  const sequence = asRecord(node.sequence);
  const shape: Record<string, unknown> = {
    relation: {
      name: readString(sequence?.relname) ?? "",
      persistence: readString(sequence?.relpersistence) ?? "p",
      schema: readString(sequence?.schemaname) ?? "public",
    },
  };
  let dataType = "bigint";
  const options = new Map<string, unknown>();
  for (const item of readArray(node.options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    const name = readString(defElem?.defname);
    if (!name) {
      continue;
    }
    options.set(name, defElem?.arg);
  }
  const asType = options.get("as");
  if (asType !== undefined) {
    dataType = typeNameToSql(asType);
  }
  if (dataType !== "bigint") {
    shape.as = dataType;
  }
  const defaults = new Map([
    ["cache", "1"],
    ["increment", "1"],
    ["maxvalue", sequenceTypeMax.get(dataType) ?? ""],
    ["minvalue", "1"],
    ["start", "1"],
  ]);
  for (const [name, fallback] of defaults) {
    const value = sequenceOptionValue(options.get(name));
    if (value !== undefined && value !== fallback) {
      shape[name] = value;
    }
  }
  if (sequenceOptionValue(options.get("cycle")) === "true") {
    shape.cycle = true;
  }
  const ownedBy = options.get("owned_by");
  if (ownedBy !== undefined) {
    const path = stringList(ownedBy);
    if (path.length > 0 && path.at(-1) !== "none") {
      shape.ownedBy = path.join(".");
    }
  }
  return shape;
}

function sequenceOptionValue(arg: unknown): string | undefined {
  if (arg === undefined || arg === null) {
    return;
  }
  const integer = asRecord(asRecord(arg)?.Integer);
  if (integer) {
    return String(readNumber(integer.ival) ?? 0);
  }
  const float = asRecord(asRecord(arg)?.Float);
  if (float) {
    return readString(float.fval);
  }
  const boolean = asRecord(asRecord(arg)?.Boolean);
  if (boolean) {
    return boolean.boolval === true ? "true" : "false";
  }
  return readString(asRecord(asRecord(arg)?.String)?.sval);
}

const constraintIdentityKeys = new Set(["conname", "contype", "fk_attrs", "keys", "location"]);

export function canonicalConstraintShape(
  constraint: AstNode,
  table: { name: string; schema: string },
  impliedColumns: string[] = []
): Record<string, unknown> {
  return {
    constraint: canonicalConstraint(constraint, impliedColumns),
    table,
  };
}

function canonicalConstraint(constraint: AstNode, impliedColumns: string[]): CanonicalConstraint {
  const keys = stringList(constraint.keys);
  const fkAttrs = stringList(constraint.fk_attrs);
  const columns = constraintColumns(fkAttrs, keys, impliedColumns);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(constraint)) {
    if (constraintIdentityKeys.has(key)) {
      continue;
    }
    payload[key] = stripLocations(value);
  }
  return {
    columns: [...columns],
    payload,
    type: readString(constraint.contype) ?? "",
  };
}

function constraintColumns(fkAttrs: string[], keys: string[], impliedColumns: string[]): string[] {
  if (fkAttrs.length > 0) {
    return fkAttrs;
  }
  if (keys.length > 0) {
    return keys;
  }
  return impliedColumns;
}
