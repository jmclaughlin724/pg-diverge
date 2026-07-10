import {
  buildGeneratedIdentifiers,
  type GeneratedIdentifiers,
  generatedIdentifier,
} from "./identifiers.js";
import type {
  ColumnShape,
  FunctionShape,
  RelationshipShape,
  SchemaEntry,
  SchemaShapes,
} from "./model.js";
import {
  isNonWritableColumn,
  isOptionalInsertColumn,
  resolveColumnType,
  sortedByName,
} from "./model.js";

export function generateDatabaseTypes(shapes: SchemaShapes): string {
  const identifiers = buildGeneratedIdentifiers(shapes);
  const schemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const lines = [
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
  ];
  for (const [schema, entry] of schemas) {
    emitNamedTypes(lines, schema, entry, shapes, identifiers);
  }
  lines.push("export type Database = {");
  for (const [schema, entry] of schemas) {
    emitDatabaseSchema(lines, schema, entry, identifiers);
  }
  lines.push("};", "");
  return `${lines.join("\n")}\n`;
}

function emitNamedTypes(
  lines: string[],
  schema: string,
  entry: SchemaEntry,
  shapes: SchemaShapes,
  identifiers: GeneratedIdentifiers
): void {
  const typeOf = (sqlType: string) => tsType(shapes, schema, sqlType, identifiers);
  for (const item of sortedByName(entry.enums)) {
    const name = generatedIdentifier(identifiers, schema, "enum", item.name);
    const union = item.values.map((value) => JSON.stringify(value)).join(" | ");
    lines.push(`export type ${name} = ${union.length > 0 ? union : "never"};`, "");
  }
  for (const composite of sortedByName(entry.composites)) {
    const name = generatedIdentifier(identifiers, schema, "composite", composite.name);
    lines.push(`export type ${name} = {`);
    for (const column of composite.columns) {
      lines.push(`  ${quoteKey(column.name)}: ${typeOf(column.type)} | null;`);
    }
    lines.push("};", "");
  }
  for (const table of sortedByName(entry.tables)) {
    emitObjectType(
      lines,
      generatedIdentifier(identifiers, schema, "table", table.name, "Row"),
      table.columns.map((column) => {
        const base = typeOf(column.type);
        return `${quoteKey(column.name)}: ${column.notNull ? base : `${base} | null`};`;
      })
    );
    emitObjectType(
      lines,
      generatedIdentifier(identifiers, schema, "table", table.name, "Insert"),
      table.columns.map((column) => insertField(column, typeOf))
    );
    emitObjectType(
      lines,
      generatedIdentifier(identifiers, schema, "table", table.name, "Update"),
      table.columns.map((column) => updateField(column, typeOf))
    );
  }
  for (const view of sortedByName(entry.views)) {
    emitObjectType(
      lines,
      generatedIdentifier(identifiers, schema, "view", view.name, "Row"),
      view.columns.map((column) => `${quoteKey(column.name)}: ${typeOf(column.type)} | null;`)
    );
  }
  const functions = groupedFunctions(entry.functions);
  for (const [name, overloads] of functions) {
    lines.push(
      `export type ${generatedIdentifier(identifiers, schema, "function", name, "Args")} = ${sortedUnique(overloads.map((fn) => renderFunctionArgs(fn, typeOf))).join(" | ")};`,
      `export type ${generatedIdentifier(identifiers, schema, "function", name, "Returns")} = ${sortedUnique(overloads.map((fn) => renderFunctionReturns(fn, typeOf))).join(" | ")};`,
      ""
    );
  }
}

function emitObjectType(lines: string[], name: string, fields: string[]): void {
  lines.push(`export type ${name} = {`);
  for (const field of fields) {
    lines.push(`  ${field}`);
  }
  lines.push("};", "");
}

function emitDatabaseSchema(
  lines: string[],
  schema: string,
  entry: SchemaEntry,
  identifiers: GeneratedIdentifiers
): void {
  lines.push(`  ${quoteKey(schema)}: {`, "    Tables: {");
  for (const table of sortedByName(entry.tables)) {
    lines.push(
      `      ${quoteKey(table.name)}: {`,
      `        Row: ${generatedIdentifier(identifiers, schema, "table", table.name, "Row")};`,
      `        Insert: ${generatedIdentifier(identifiers, schema, "table", table.name, "Insert")};`,
      `        Update: ${generatedIdentifier(identifiers, schema, "table", table.name, "Update")};`,
      `        Relationships: ${renderRelationships(table.relationships)};`,
      "      };"
    );
  }
  lines.push("    };", "    Views: {");
  for (const view of sortedByName(entry.views)) {
    lines.push(
      `      ${quoteKey(view.name)}: {`,
      `        Row: ${generatedIdentifier(identifiers, schema, "view", view.name, "Row")};`,
      "        Relationships: [];",
      "      };"
    );
  }
  lines.push("    };", "    Enums: {");
  for (const item of sortedByName(entry.enums)) {
    lines.push(
      `      ${quoteKey(item.name)}: ${generatedIdentifier(identifiers, schema, "enum", item.name)};`
    );
  }
  lines.push("    };", "    CompositeTypes: {");
  for (const composite of sortedByName(entry.composites)) {
    lines.push(
      `      ${quoteKey(composite.name)}: ${generatedIdentifier(identifiers, schema, "composite", composite.name)};`
    );
  }
  lines.push("    };");
  const functions = groupedFunctions(entry.functions);
  if (functions.length === 0) {
    lines.push("    Functions: { [_ in never]: never };");
  } else {
    lines.push("    Functions: {");
    for (const [name] of functions) {
      lines.push(
        `      ${quoteKey(name)}: { Args: ${generatedIdentifier(identifiers, schema, "function", name, "Args")}; Returns: ${generatedIdentifier(identifiers, schema, "function", name, "Returns")} };`
      );
    }
    lines.push("    };");
  }
  lines.push("  };");
}

function tsType(
  shapes: SchemaShapes,
  schema: string,
  sqlType: string,
  identifiers: GeneratedIdentifiers
): string {
  const resolved = resolveColumnType(shapes, schema, sqlType);
  let mapped: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    mapped = generatedIdentifier(
      identifiers,
      resolved.enumRef.schema,
      "enum",
      resolved.enumRef.name
    );
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    mapped = generatedIdentifier(
      identifiers,
      resolved.compositeRef.schema,
      "composite",
      resolved.compositeRef.name
    );
  } else if (resolved.kind === "relation" && resolved.relationRef) {
    mapped = generatedIdentifier(
      identifiers,
      resolved.relationRef.schema,
      resolved.relationRef.collection === "Tables" ? "table" : "view",
      resolved.relationRef.name,
      "Row"
    );
  } else if (resolved.kind === "json") {
    mapped = "Json";
  } else if (resolved.kind === "unknown") {
    mapped = "unknown";
  } else {
    mapped = resolved.kind;
  }
  return mapped + "[]".repeat(resolved.arrayDepth);
}

function insertField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (isNonWritableColumn(column)) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  const type = column.notNull ? base : `${base} | null`;
  return `${quoteKey(column.name)}${isOptionalInsertColumn(column) ? "?" : ""}: ${type};`;
}

function updateField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (isNonWritableColumn(column)) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  return `${quoteKey(column.name)}?: ${column.notNull ? base : `${base} | null`};`;
}

function groupedFunctions(functions: FunctionShape[]): [string, FunctionShape[]][] {
  const grouped = new Map<string, FunctionShape[]>();
  for (const fn of functions) {
    const overloads = grouped.get(fn.name) ?? [];
    overloads.push(fn);
    grouped.set(fn.name, overloads);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function renderFunctionArgs(fn: FunctionShape, typeOf: (sqlType: string) => string): string {
  const args = fn.args
    .map((arg) => `${quoteKey(arg.name)}${arg.optional ? "?" : ""}: ${typeOf(arg.type)}`)
    .join("; ");
  return args.length > 0 ? `{ ${args} }` : "Record<PropertyKey, never>";
}

function renderFunctionReturns(fn: FunctionShape, typeOf: (sqlType: string) => string): string {
  if (fn.returns?.columns && fn.returns.columns.length > 0) {
    const row = fn.returns.columns
      .map((column) => `${quoteKey(column.name)}: ${typeOf(column.type)}`)
      .join("; ");
    const shape = `{ ${row} }`;
    return fn.returns.setof ? `${shape}[]` : shape;
  }
  const base = fn.returns ? typeOf(fn.returns.type) : "unknown";
  return fn.returns?.setof ? `${base}[]` : base;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function renderRelationships(relationships: RelationshipShape[]): string {
  if (relationships.length === 0) {
    return "[]";
  }
  return `[${relationships
    .map(
      (item) =>
        `{ foreignKeyName: ${JSON.stringify(item.foreignKeyName)}; columns: ${tupleType(item.columns)}; isOneToOne: ${item.isOneToOne}; referencedRelation: ${JSON.stringify(item.referencedRelation)}; referencedColumns: ${tupleType(item.referencedColumns)} }`
    )
    .join(", ")}]`;
}

function tupleType(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function quoteKey(name: string): string {
  let simple = name.length > 0;
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index] ?? "";
    const word =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      character === "_" ||
      (index > 0 && character >= "0" && character <= "9");
    if (!word) {
      simple = false;
      break;
    }
  }
  return simple ? name : JSON.stringify(name);
}
