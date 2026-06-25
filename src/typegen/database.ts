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
  const lines: string[] = [
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export type Database = {",
    "  __InternalSupabase: {",
    '    PostgrestVersion: "12";',
    "  };",
  ];
  const sortedSchemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [schemaName, entry] of sortedSchemas) {
    emitDatabaseSchema(lines, schemaName, entry, shapes);
  }
  lines.push("};");
  lines.push("");
  lines.push(...helperBlock());
  lines.push("");
  lines.push(...constantsBlock(sortedSchemas));
  return `${lines.join("\n")}\n`;
}

function emitDatabaseSchema(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  shapes: SchemaShapes
): void {
  const typeOf = (sqlType: string) => tsType(shapes, schemaName, sqlType);
  lines.push(`  ${quoteKey(schemaName)}: {`);
  emitTableTypes(lines, schemaName, entry, shapes, typeOf);
  emitViewTypes(lines, schemaName, entry, shapes, typeOf);
  emitEnumTypes(lines, entry);
  emitCompositeTypes(lines, entry, typeOf);
  lines.push(...functionsBlock(entry.functions, schemaName, shapes, typeOf));
  lines.push("  };");
}

function emitTableTypes(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): void {
  lines.push("    Tables: {");
  if (entry.tables.length === 0) {
    lines.push("      [_ in never]: never;");
  }
  for (const table of sortedByName(entry.tables)) {
    lines.push(`      ${quoteKey(table.name)}: {`);
    emitColumnTypeBlock(lines, "Row", table.columns, (column) => rowField(column, typeOf));
    emitComputedFields(lines, schemaName, table.name, entry, shapes, typeOf);
    emitColumnTypeBlock(lines, "Insert", table.columns, (column) => insertField(column, typeOf));
    emitColumnTypeBlock(lines, "Update", table.columns, (column) => updateField(column, typeOf));
    lines.push(`        Relationships: ${renderRelationships(table.relationships, schemaName)};`);
    lines.push("      };");
  }
  lines.push("    };");
}

function emitViewTypes(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): void {
  lines.push("    Views: {");
  if (entry.views.length === 0) {
    lines.push("      [_ in never]: never;");
  }
  for (const view of sortedByName(entry.views)) {
    lines.push(`      ${quoteKey(view.name)}: {`);
    emitColumnTypeBlock(lines, "Row", view.columns, (column) => rowField(column, typeOf));
    emitComputedFields(lines, schemaName, view.name, entry, shapes, typeOf);
    if (view.updatable && !view.materialized) {
      emitColumnTypeBlock(lines, "Insert", view.columns, (column) =>
        viewWriteField(column, typeOf)
      );
      emitColumnTypeBlock(lines, "Update", view.columns, (column) =>
        viewWriteField(column, typeOf)
      );
    }
    lines.push(`        Relationships: ${renderRelationships(view.relationships, schemaName)};`);
    lines.push("      };");
  }
  lines.push("    };");
}

function emitEnumTypes(lines: string[], entry: SchemaEntry): void {
  lines.push("    Enums: {");
  if (entry.enums.length === 0) {
    lines.push("      [_ in never]: never;");
  }
  for (const item of sortedByName(entry.enums)) {
    const union = item.values.map((value) => JSON.stringify(value)).join(" | ");
    lines.push(`      ${quoteKey(item.name)}: ${union.length > 0 ? union : "never"};`);
  }
  lines.push("    };");
}

function emitCompositeTypes(
  lines: string[],
  entry: SchemaEntry,
  typeOf: (sqlType: string) => string
): void {
  lines.push("    CompositeTypes: {");
  if (entry.composites.length === 0) {
    lines.push("      [_ in never]: never;");
  }
  for (const composite of sortedByName(entry.composites)) {
    lines.push(`      ${quoteKey(composite.name)}: {`);
    for (const column of composite.columns) {
      lines.push(`        ${quoteKey(column.name)}: ${nullableType(typeOf(column.type), true)};`);
    }
    lines.push("      };");
  }
  lines.push("    };");
}

function emitColumnTypeBlock(
  lines: string[],
  name: string,
  columns: ColumnShape[],
  renderColumn: (column: ColumnShape) => string
): void {
  lines.push(`        ${name}: {`);
  for (const column of columns) {
    lines.push(`          ${renderColumn(column)}`);
  }
  lines.push("        };");
}

function tsType(shapes: SchemaShapes, schemaName: string, sqlType: string): string {
  const resolved = resolveColumnType(shapes, schemaName, sqlType);
  let mapped: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    mapped = `Database["${resolved.enumRef.schema}"]["Enums"]["${resolved.enumRef.name}"]`;
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    mapped = `Database["${resolved.compositeRef.schema}"]["CompositeTypes"]["${resolved.compositeRef.name}"]`;
  } else if (resolved.kind === "relation" && resolved.relationRef) {
    mapped = `Database["${resolved.relationRef.schema}"]["${resolved.relationRef.collection}"]["${resolved.relationRef.name}"]["Row"]`;
  } else if (resolved.kind === "json") {
    mapped = "Json";
  } else if (resolved.kind === "record") {
    mapped = "Record<string, unknown>";
  } else if (resolved.kind === "unknown") {
    mapped = "unknown";
  } else if (resolved.kind === "void") {
    mapped = "undefined";
  } else {
    mapped = resolved.kind;
  }
  return arrayType(mapped, resolved.arrayDepth);
}

function arrayType(base: string, depth: number): string {
  let type = base;
  for (let index = 0; index < depth; index += 1) {
    type = `(${type})[]`;
  }
  return type;
}

function nullableType(base: string, nullable: boolean): string {
  return nullable && base !== "unknown" && base !== "any" ? `${base} | null` : base;
}

function rowField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  return `${quoteKey(column.name)}: ${nullableType(typeOf(column.type), !column.notNull)};`;
}

function insertField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (isNonWritableColumn(column)) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  const type = nullableType(base, !column.notNull);
  const optional = isOptionalInsertColumn(column);
  return `${quoteKey(column.name)}${optional ? "?" : ""}: ${type};`;
}

function updateField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (isNonWritableColumn(column)) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  return `${quoteKey(column.name)}?: ${nullableType(base, !column.notNull)};`;
}

function viewWriteField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (column.updatable !== true) {
    return `${quoteKey(column.name)}?: never;`;
  }
  return `${quoteKey(column.name)}?: ${nullableType(typeOf(column.type), true)};`;
}

function emitComputedFields(
  lines: string[],
  schemaName: string,
  relationName: string,
  entry: SchemaEntry,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): void {
  for (const fn of sortedByName(entry.functions)) {
    if (!isComputedFieldFunction(fn, schemaName, relationName, shapes)) {
      continue;
    }
    lines.push(
      `          ${quoteKey(fn.name)}: ${nullableType(renderFunctionReturns(fn, typeOf), true)};`
    );
  }
}

function isComputedFieldFunction(
  fn: FunctionShape,
  schemaName: string,
  relationName: string,
  shapes: SchemaShapes
): boolean {
  if (fn.args.length !== 1 || fn.args[0]?.name !== "") {
    return false;
  }
  const resolved = resolveColumnType(shapes, schemaName, fn.args[0].type);
  return (
    resolved.kind === "relation" &&
    resolved.relationRef?.schema === schemaName &&
    resolved.relationRef.name === relationName
  );
}

function functionsBlock(
  functions: FunctionShape[],
  schemaName: string,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): string[] {
  const grouped = new Map<string, FunctionShape[]>();
  for (const fn of functions) {
    const overloads = grouped.get(fn.name) ?? [];
    overloads.push(fn);
    grouped.set(fn.name, overloads);
  }
  if (grouped.size === 0) {
    return ["    Functions: { [_ in never]: never };"];
  }
  const lines = ["    Functions: {"];
  for (const [name, overloads] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(
      `      ${quoteKey(name)}: ${sortedUnique(
        overloads.map((fn) => renderFunctionSignature(fn, schemaName, shapes, typeOf))
      ).join(" | ")};`
    );
  }
  lines.push("    };");
  return lines;
}

function renderFunctionSignature(
  fn: FunctionShape,
  schemaName: string,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): string {
  const setofOptions = renderSetofOptions(fn, schemaName, shapes);
  return `{ Args: ${renderFunctionArgs(fn, typeOf)}; Returns: ${renderRpcFunctionReturns(
    fn,
    schemaName,
    shapes,
    typeOf
  )}${setofOptions ? `; SetofOptions: ${setofOptions}` : ""} }`;
}

function renderFunctionArgs(fn: FunctionShape, typeOf: (sqlType: string) => string): string {
  const args = fn.args
    .map((arg) => `${quoteKey(arg.name)}${arg.optional ? "?" : ""}: ${typeOf(arg.type)}`)
    .join("; ");
  return args.length > 0 ? `{ ${args} }` : "never";
}

function renderRpcFunctionReturns(
  fn: FunctionShape,
  schemaName: string,
  shapes: SchemaShapes,
  typeOf: (sqlType: string) => string
): string {
  if (hasInvalidTableRowRpcReturn(fn, schemaName, shapes)) {
    return `{ error: true } & ${JSON.stringify(
      `the function ${schemaName}.${fn.name} with a single unnamed table-row parameter cannot be called as a scalar RPC`
    )}`;
  }
  return renderFunctionReturns(fn, typeOf);
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
  return fn.returns?.setof ? arrayType(base, 1) : base;
}

function hasInvalidTableRowRpcReturn(
  fn: FunctionShape,
  schemaName: string,
  shapes: SchemaShapes
): boolean {
  if (fn.args.length !== 1 || fn.args[0]?.name !== "") {
    return false;
  }
  const arg = resolveColumnType(shapes, schemaName, fn.args[0].type);
  if (arg.kind !== "relation") {
    return false;
  }
  if (!fn.returns) {
    return true;
  }
  const returns = resolveColumnType(shapes, schemaName, fn.returns.type);
  return returns.kind !== "relation";
}

function renderSetofOptions(
  fn: FunctionShape,
  schemaName: string,
  shapes: SchemaShapes
): string | undefined {
  if (!fn.returns) {
    return;
  }
  const target = resolveColumnType(shapes, schemaName, fn.returns.type);
  if (target.kind !== "relation" || !target.relationRef) {
    return;
  }
  const from = relationFunctionSource(fn, schemaName, shapes) ?? "*";
  const isOneToOne = !fn.returns.setof;
  return `{ from: ${JSON.stringify(from)}; to: ${JSON.stringify(
    target.relationRef.name
  )}; isOneToOne: ${isOneToOne}; isSetofReturn: ${fn.returns.setof} }`;
}

function relationFunctionSource(
  fn: FunctionShape,
  schemaName: string,
  shapes: SchemaShapes
): string | undefined {
  if (fn.args.length !== 1 || fn.args[0]?.name !== "") {
    return;
  }
  const source = resolveColumnType(shapes, schemaName, fn.args[0].type);
  return source.kind === "relation" ? source.relationRef?.name : undefined;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function renderRelationships(relationships: RelationshipShape[], schemaName: string): string {
  const sameSchema = relationships.filter((item) => item.referencedSchema === schemaName);
  if (sameSchema.length === 0) {
    return "[]";
  }
  const items = sameSchema.map(
    (item) =>
      `{ foreignKeyName: ${JSON.stringify(item.foreignKeyName)}; columns: ${tupleType(item.columns)}; isOneToOne: ${item.isOneToOne}; referencedRelation: ${JSON.stringify(item.referencedRelation)}; referencedColumns: ${tupleType(item.referencedColumns)} }`
  );
  return `[${items.join(", ")}]`;
}

function tupleType(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function quoteKey(name: string): string {
  let simple = name.length > 0;
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index] ?? "";
    const isWord =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      char === "_" ||
      (index > 0 && char >= "0" && char <= "9");
    if (!isWord) {
      simple = false;
      break;
    }
  }
  return simple ? name : JSON.stringify(name);
}

function helperBlock(): string[] {
  return [
    'type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;',
    'type DefaultSchema = DatabaseWithoutInternals[Extract<keyof DatabaseWithoutInternals, "public">];',
    "",
    ...tablesHelperBlock(),
    "",
    ...tableWriteHelperBlock("TablesInsert", "Insert", "I"),
    "",
    ...tableWriteHelperBlock("TablesUpdate", "Update", "U"),
    "",
    ...schemaValueHelperBlock("Enums", "PublicEnumNameOrOptions", "EnumName"),
    "",
    ...schemaValueHelperBlock(
      "CompositeTypes",
      "PublicCompositeTypeNameOrOptions",
      "CompositeTypeName"
    ),
  ];
}

function tablesHelperBlock(): string[] {
  return [
    "export type Tables<",
    '  DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },',
    '  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never,',
    '> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never : never;',
  ];
}

function tableWriteHelperBlock(
  name: "TablesInsert" | "TablesUpdate",
  property: "Insert" | "Update",
  inferred: "I" | "U"
): string[] {
  return [
    `export type ${name}<`,
    '  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },',
    '  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never,',
    `> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { ${property}: infer ${inferred} } ? ${inferred} : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { ${property}: infer ${inferred} } ? ${inferred} : never : never;`,
  ];
}

function schemaValueHelperBlock(
  name: "Enums" | "CompositeTypes",
  optionsName: string,
  itemName: string
): string[] {
  return [
    `export type ${name}<`,
    `  ${optionsName} extends keyof DefaultSchema["${name}"] | { schema: keyof DatabaseWithoutInternals },`,
    `  ${itemName} extends ${optionsName} extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[${optionsName}["schema"]]["${name}"] : never = never,`,
    `> = ${optionsName} extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[${optionsName}["schema"]]["${name}"][${itemName}] : ${optionsName} extends keyof DefaultSchema["${name}"] ? DefaultSchema["${name}"][${optionsName}] : never;`,
  ];
}

function constantsBlock(
  schemas: [string, { enums: { name: string; values: string[] }[] }][]
): string[] {
  const lines = ["export const Constants = {"];
  for (const [schemaName, entry] of schemas) {
    lines.push(`  ${quoteKey(schemaName)}: {`);
    lines.push("    Enums: {");
    for (const item of [...entry.enums].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `      ${quoteKey(item.name)}: [${item.values.map((value) => JSON.stringify(value)).join(", ")}],`
      );
    }
    lines.push("    },");
    lines.push("  },");
  }
  lines.push("} as const;");
  return lines;
}
