import { quoteKey } from "./database.js";
import type { ColumnShape, SchemaEntry, SchemaShapes } from "./model.js";
import {
  isNonWritableColumn,
  isOptionalInsertColumn,
  resolveColumnType,
  sortedByName,
} from "./model.js";

export function generateZodSchemas(shapes: SchemaShapes): string {
  const sortedSchemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const typeIdentifiers = new Set<string>();
  const enumIdents = buildTypeIdentifiers(sortedSchemas, "enums", typeIdentifiers);
  const compositeIdents = buildTypeIdentifiers(sortedSchemas, "composites", typeIdentifiers);
  const lines = zodHeader();
  emitEnumDefinitions(lines, sortedSchemas, enumIdents);
  emitCompositeDefinitions(lines, sortedSchemas, shapes, enumIdents, compositeIdents);
  emitZodEnumsRoot(lines, sortedSchemas, enumIdents);
  emitZodCompositeRoot(lines, sortedSchemas, compositeIdents);
  emitZodTablesRoot(lines, sortedSchemas, shapes, enumIdents, compositeIdents);
  emitZodWriteRoot(lines, sortedSchemas, "TablesInsert", "Insert");
  emitZodWriteRoot(lines, sortedSchemas, "TablesUpdate", "Update");
  emitValidatedTypeHelpers(lines);
  return `${lines.join("\n")}\n`;
}

type SortedSchemas = [string, SchemaEntry][];

function zodHeader(): string[] {
  return [
    'import { z } from "zod";',
    "",
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export const jsonSchema: z.ZodType<Json> = z.lazy(() =>",
    "  z.union([",
    "    z.string(),",
    "    z.number(),",
    "    z.boolean(),",
    "    z.null(),",
    "    z.record(z.string(), z.union([jsonSchema, z.undefined()])),",
    "    z.array(jsonSchema),",
    "  ]),",
    ");",
    "",
  ];
}

function emitValidatedTypeHelpers(lines: string[]): void {
  lines.push(
    "",
    'type PublicSchema<T extends object> = Extract<keyof T, "public"> extends never',
    "  ? Record<never, never>",
    '  : T[Extract<keyof T, "public">];',
    "",
    "type PublicTables = PublicSchema<typeof Tables>;",
    "type PublicTableInserts = PublicSchema<typeof TablesInsert>;",
    "type PublicTableUpdates = PublicSchema<typeof TablesUpdate>;",
    "type PublicEnums = PublicSchema<typeof Enums>;",
    "type PublicCompositeTypes = PublicSchema<typeof CompositeTypes>;",
    "",
    "type InferZod<T> = T extends z.ZodType ? z.infer<T> : never;",
    "type InferTableRow<T> = T extends { Row: infer R extends z.ZodType } ? z.infer<R> : never;",
    "",
    ...zodHelperTypeBlock("Tables", "PublicTables", "PublicTableNameOrOptions", "TableName", {
      infer: "InferTableRow",
      root: "Tables",
    }),
    "",
    ...zodHelperTypeBlock(
      "TablesInsert",
      "PublicTableInserts",
      "PublicTableNameOrOptions",
      "TableName",
      { infer: "InferZod", root: "TablesInsert" }
    ),
    "",
    ...zodHelperTypeBlock(
      "TablesUpdate",
      "PublicTableUpdates",
      "PublicTableNameOrOptions",
      "TableName",
      { infer: "InferZod", root: "TablesUpdate" }
    ),
    "",
    ...zodHelperTypeBlock("Enums", "PublicEnums", "PublicEnumNameOrOptions", "EnumName", {
      infer: "InferZod",
      root: "Enums",
    }),
    "",
    ...zodHelperTypeBlock(
      "CompositeTypes",
      "PublicCompositeTypes",
      "PublicCompositeTypeNameOrOptions",
      "CompositeTypeName",
      { infer: "InferZod", root: "CompositeTypes" }
    )
  );
}

function zodHelperTypeBlock(
  exportName: string,
  publicAlias: string,
  optionsName: string,
  itemName: string,
  root: { infer: "InferTableRow" | "InferZod"; root: string }
): string[] {
  return [
    `export type ${exportName}<`,
    `  ${optionsName} extends keyof ${publicAlias} | { schema: keyof typeof ${root.root} },`,
    `  ${itemName} extends ${optionsName} extends { schema: keyof typeof ${root.root} }`,
    `    ? keyof (typeof ${root.root})[${optionsName}["schema"]]`,
    "    : never = never,",
    `> = ${optionsName} extends { schema: keyof typeof ${root.root} }`,
    `  ? ${root.infer}<(typeof ${root.root})[${optionsName}["schema"]][${itemName}]>`,
    `  : ${optionsName} extends keyof ${publicAlias}`,
    `    ? ${root.infer}<${publicAlias}[${optionsName}]>`,
    "    : never;",
  ];
}

function emitZodEnumsRoot(
  lines: string[],
  sortedSchemas: SortedSchemas,
  enumIdents: Map<string, string>
): void {
  lines.push("", "export const Enums = {");
  for (const [schemaName, entry] of sortedSchemas) {
    lines.push(`  ${quoteKey(schemaName)}: {`);
    for (const item of sortedByName(entry.enums)) {
      const ident = enumIdents.get(`${schemaName}.${item.name}`);
      if (ident && item.values.length > 0) {
        lines.push(`    ${quoteKey(item.name)}: ${ident},`);
      }
    }
    lines.push("  },");
  }
  lines.push("} as const;");
}

function emitZodCompositeRoot(
  lines: string[],
  sortedSchemas: SortedSchemas,
  compositeIdents: Map<string, string>
): void {
  lines.push("", "export const CompositeTypes = {");
  for (const [schemaName, entry] of sortedSchemas) {
    lines.push(`  ${quoteKey(schemaName)}: {`);
    for (const item of sortedByName(entry.composites)) {
      const ident = compositeIdents.get(`${schemaName}.${item.name}`);
      if (ident) {
        lines.push(`    ${quoteKey(item.name)}: ${ident},`);
      }
    }
    lines.push("  },");
  }
  lines.push("} as const;");
}

function emitZodTablesRoot(
  lines: string[],
  sortedSchemas: SortedSchemas,
  shapes: SchemaShapes,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>
): void {
  lines.push("", "export const Tables = {");
  for (const [schemaName, entry] of sortedSchemas) {
    const zodFor = (sqlType: string) =>
      zodExpr(shapes, schemaName, enumIdents, compositeIdents, sqlType);
    lines.push(`  ${quoteKey(schemaName)}: {`);
    for (const table of sortedByName(entry.tables)) {
      lines.push(`    ${quoteKey(table.name)}: {`);
      emitZodRow(lines, table.columns, zodFor, "      Row");
      emitZodInsert(lines, table.columns, zodFor);
      emitZodUpdate(lines, table.columns, zodFor);
      lines.push("    },");
    }
    for (const view of sortedByName(entry.views)) {
      lines.push(`    ${quoteKey(view.name)}: {`);
      emitZodRow(lines, view.columns, zodFor, "      Row");
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("} as const;");
}

function emitZodWriteRoot(
  lines: string[],
  sortedSchemas: SortedSchemas,
  name: "TablesInsert" | "TablesUpdate",
  property: "Insert" | "Update"
): void {
  lines.push("", `export const ${name} = {`);
  for (const [schemaName, entry] of sortedSchemas) {
    lines.push(`  ${quoteKey(schemaName)}: {`);
    for (const table of sortedByName(entry.tables)) {
      lines.push(
        `    ${quoteKey(table.name)}: Tables[${JSON.stringify(schemaName)}][${JSON.stringify(table.name)}].${property},`
      );
    }
    lines.push("  },");
  }
  lines.push("} as const;");
}

function emitEnumDefinitions(
  lines: string[],
  sortedSchemas: SortedSchemas,
  enumIdents: Map<string, string>
): void {
  for (const [schemaName, entry] of sortedSchemas) {
    for (const item of sortedByName(entry.enums)) {
      const ident = enumIdents.get(`${schemaName}.${item.name}`);
      if (ident && item.values.length > 0) {
        lines.push(
          `const ${ident} = z.enum([${item.values.map((value) => JSON.stringify(value)).join(", ")}]);`
        );
      }
    }
  }
}

function emitCompositeDefinitions(
  lines: string[],
  sortedSchemas: SortedSchemas,
  shapes: SchemaShapes,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>
): void {
  for (const [schemaName, entry] of sortedSchemas) {
    for (const item of sortedByName(entry.composites)) {
      const ident = compositeIdents.get(`${schemaName}.${item.name}`);
      if (!ident) {
        continue;
      }
      lines.push(`const ${ident} = z.object({`);
      for (const column of item.columns) {
        const field = zodCompositeFieldExpr(
          shapes,
          schemaName,
          enumIdents,
          compositeIdents,
          column.type
        );
        const value = column.notNull ? field.expression : `${field.expression}.nullable()`;
        if (field.defer) {
          lines.push(`  get ${getterKey(column.name)}() {`);
          lines.push(`    return ${value};`);
          lines.push("  },");
        } else {
          lines.push(`  ${quoteKey(column.name)}: ${value},`);
        }
      }
      lines.push("});");
    }
  }
}

function zodCompositeFieldExpr(
  shapes: SchemaShapes,
  schemaName: string,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>,
  sqlType: string
): { defer: boolean; expression: string } {
  const resolved = resolveColumnType(shapes, schemaName, sqlType);
  return {
    defer: resolved.kind === "composite" || resolved.kind === "relation",
    expression: zodExprFromResolved(resolved, enumIdents, compositeIdents),
  };
}

function getterKey(value: string): string {
  return isIdentifierKey(value) ? value : `[${JSON.stringify(value)}]`;
}

function isIdentifierKey(value: string): boolean {
  const first = value[0];
  if (!isIdentifierStart(first)) {
    return false;
  }
  for (let index = 1; index < value.length; index += 1) {
    if (!isIdentifierContinue(value[index])) {
      return false;
    }
  }
  return true;
}

function isIdentifierStart(char: string | undefined): boolean {
  return char === "_" || char === "$" || isAsciiLetter(char);
}

function isIdentifierContinue(char: string | undefined): boolean {
  return isIdentifierStart(char) || isAsciiDigit(char);
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));
}

function isAsciiDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function emitZodRow(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string,
  label: string
): void {
  lines.push(`${label}: z.object({`);
  for (const column of columns) {
    const base = zodFor(column.type);
    lines.push(
      `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`},`
    );
  }
  lines.push("        }),");
}

function emitZodInsert(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push("        Insert: z.object({");
  for (const column of columns) {
    const field = zodInsertField(column, zodFor);
    if (field) {
      lines.push(`          ${field}`);
    }
  }
  lines.push("        }),");
}

function emitZodUpdate(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push("        Update: z.object({");
  for (const column of columns) {
    if (isNonWritableColumn(column)) {
      continue;
    }
    const base = zodFor(column.type);
    const value = column.notNull ? base : `${base}.nullable()`;
    lines.push(`          ${quoteKey(column.name)}: ${value}.optional(),`);
  }
  lines.push("        }),");
}

function buildTypeIdentifiers(
  schemas: SortedSchemas,
  kind: "composites" | "enums",
  used: Set<string>
): Map<string, string> {
  const idents = new Map<string, string>();
  for (const [schemaName, entry] of schemas) {
    for (const item of entry[kind]) {
      let ident = `${sanitizeIdent(schemaName)}_${sanitizeIdent(item.name)}`;
      let suffix = 1;
      while (used.has(ident)) {
        suffix += 1;
        ident = `${sanitizeIdent(schemaName)}_${sanitizeIdent(item.name)}_${suffix}`;
      }
      used.add(ident);
      idents.set(`${schemaName}.${item.name}`, ident);
    }
  }
  return idents;
}

function sanitizeIdent(value: string): string {
  let result = "";
  for (const char of value) {
    const isWord =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9") ||
      char === "_";
    result += isWord ? char : "_";
  }
  const first = result[0] ?? "";
  return first >= "0" && first <= "9" ? `_${result}` : result;
}

function zodExpr(
  shapes: SchemaShapes,
  schemaName: string,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>,
  sqlType: string
): string {
  const resolved = resolveColumnType(shapes, schemaName, sqlType);
  return zodExprFromResolved(resolved, enumIdents, compositeIdents);
}

function zodExprFromResolved(
  resolved: ReturnType<typeof resolveColumnType>,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>
): string {
  let mapped: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    mapped = enumIdents.get(`${resolved.enumRef.schema}.${resolved.enumRef.name}`) ?? "z.unknown()";
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    mapped =
      compositeIdents.get(`${resolved.compositeRef.schema}.${resolved.compositeRef.name}`) ??
      "z.unknown()";
  } else if (resolved.kind === "relation" && resolved.relationRef) {
    mapped = `Tables[${JSON.stringify(resolved.relationRef.schema)}][${JSON.stringify(resolved.relationRef.name)}].Row`;
  } else if (resolved.kind === "json") {
    mapped = "jsonSchema";
  } else if (resolved.kind === "unknown") {
    mapped = "z.unknown()";
  } else {
    mapped = `z.${resolved.kind}()`;
  }
  for (let depth = 0; depth < resolved.arrayDepth; depth += 1) {
    mapped = `z.array(${mapped})`;
  }
  return mapped;
}

function zodInsertField(
  column: ColumnShape,
  zodFor: (sqlType: string) => string
): string | undefined {
  if (isNonWritableColumn(column)) {
    return;
  }
  const base = zodFor(column.type);
  const value = column.notNull ? base : `${base}.nullable()`;
  const optional = isOptionalInsertColumn(column);
  return `${quoteKey(column.name)}: ${optional ? `${value}.optional()` : value},`;
}
