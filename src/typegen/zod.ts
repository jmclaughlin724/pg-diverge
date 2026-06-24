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
  const enumIdents = buildTypeIdentifiers(sortedSchemas, "enums");
  const compositeIdents = buildTypeIdentifiers(sortedSchemas, "composites");
  const lines = zodHeader();
  emitEnumDefinitions(lines, sortedSchemas, enumIdents);
  emitCompositeDefinitions(lines, sortedSchemas, shapes, enumIdents, compositeIdents);
  lines.push("", "export const schemas = {");
  for (const [schemaName, entry] of sortedSchemas) {
    emitSchemaZod(lines, schemaName, entry, shapes, enumIdents, compositeIdents);
  }
  lines.push("} as const;");
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
    "export type TableRow<",
    "  S extends keyof typeof schemas,",
    '  T extends keyof (typeof schemas)[S]["Tables"],',
    '> = (typeof schemas)[S]["Tables"][T] extends { Row: infer R extends z.ZodType }',
    "  ? z.infer<R>",
    "  : never;",
    "",
    "export type TableInsert<",
    "  S extends keyof typeof schemas,",
    '  T extends keyof (typeof schemas)[S]["Tables"],',
    '> = (typeof schemas)[S]["Tables"][T] extends { Insert: infer R extends z.ZodType }',
    "  ? z.infer<R>",
    "  : never;",
    "",
    "export type TableUpdate<",
    "  S extends keyof typeof schemas,",
    '  T extends keyof (typeof schemas)[S]["Tables"],',
    '> = (typeof schemas)[S]["Tables"][T] extends { Update: infer R extends z.ZodType }',
    "  ? z.infer<R>",
    "  : never;",
    "",
    "export type ViewRow<",
    "  S extends keyof typeof schemas,",
    '  V extends keyof (typeof schemas)[S]["Views"],',
    '> = (typeof schemas)[S]["Views"][V] extends { Row: infer R extends z.ZodType }',
    "  ? z.infer<R>",
    "  : never;",
    "",
    "export type EnumValue<",
    "  S extends keyof typeof schemas,",
    '  E extends keyof (typeof schemas)[S]["Enums"],',
    '> = (typeof schemas)[S]["Enums"][E] extends infer R extends z.ZodType ? z.infer<R> : never;',
    "",
    "export type CompositeValue<",
    "  S extends keyof typeof schemas,",
    '  C extends keyof (typeof schemas)[S]["CompositeTypes"],',
    '> = (typeof schemas)[S]["CompositeTypes"][C] extends infer R extends z.ZodType',
    "  ? z.infer<R>",
    "  : never;"
  );
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
    defer: resolved.kind === "composite",
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

function emitSchemaZod(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  shapes: SchemaShapes,
  enumIdents: Map<string, string>,
  compositeIdents: Map<string, string>
): void {
  const zodFor = (sqlType: string) =>
    zodExpr(shapes, schemaName, enumIdents, compositeIdents, sqlType);
  lines.push(`  ${quoteKey(schemaName)}: {`);
  emitZodEnums(lines, schemaName, entry, enumIdents);
  emitZodComposites(lines, schemaName, entry, compositeIdents);
  emitZodTables(lines, entry, zodFor);
  emitZodViews(lines, entry, zodFor);
  lines.push("  },");
}

function emitZodEnums(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  enumIdents: Map<string, string>
): void {
  lines.push("    Enums: {");
  for (const item of sortedByName(entry.enums)) {
    const ident = enumIdents.get(`${schemaName}.${item.name}`);
    if (ident && item.values.length > 0) {
      lines.push(`      ${quoteKey(item.name)}: ${ident},`);
    }
  }
  lines.push("    },");
}

function emitZodComposites(
  lines: string[],
  schemaName: string,
  entry: SchemaEntry,
  compositeIdents: Map<string, string>
): void {
  lines.push("    CompositeTypes: {");
  for (const item of sortedByName(entry.composites)) {
    const ident = compositeIdents.get(`${schemaName}.${item.name}`);
    if (ident) {
      lines.push(`      ${quoteKey(item.name)}: ${ident},`);
    }
  }
  lines.push("    },");
}

function emitZodTables(
  lines: string[],
  entry: SchemaEntry,
  zodFor: (sqlType: string) => string
): void {
  lines.push("    Tables: {");
  for (const table of sortedByName(entry.tables)) {
    lines.push(`      ${quoteKey(table.name)}: {`);
    emitZodRow(lines, table.columns, zodFor, "        Row");
    emitZodInsert(lines, table.columns, zodFor);
    emitZodUpdate(lines, table.columns, zodFor);
    lines.push("      },");
  }
  lines.push("    },");
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

function emitZodViews(
  lines: string[],
  entry: SchemaEntry,
  zodFor: (sqlType: string) => string
): void {
  lines.push("    Views: {");
  for (const view of sortedByName(entry.views)) {
    lines.push(`      ${quoteKey(view.name)}: {`);
    lines.push("        Row: z.object({");
    for (const column of view.columns) {
      lines.push(`          ${quoteKey(column.name)}: ${zodFor(column.type)}.nullable(),`);
    }
    lines.push("        }),");
    lines.push("      },");
  }
  lines.push("    },");
}

function buildTypeIdentifiers(
  schemas: SortedSchemas,
  kind: "composites" | "enums"
): Map<string, string> {
  const idents = new Map<string, string>();
  const used = new Set<string>();
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
