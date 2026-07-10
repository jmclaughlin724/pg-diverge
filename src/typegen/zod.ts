import { quoteKey } from "./database.js";
import {
  buildGeneratedIdentifiers,
  type GeneratedIdentifiers,
  generatedIdentifier,
} from "./identifiers.js";
import type { ColumnShape, SchemaEntry, SchemaShapes } from "./model.js";
import {
  isNonWritableColumn,
  isOptionalInsertColumn,
  resolveColumnType,
  sortedByName,
} from "./model.js";

export function generateZodSchemas(shapes: SchemaShapes, typesImportPath?: string): string {
  const schemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const identifiers = buildGeneratedIdentifiers(shapes);
  const lines = [
    ...(typesImportPath ? [`import type { Json } from ${JSON.stringify(typesImportPath)};`] : []),
    'import { z } from "zod";',
    "",
    ...(typesImportPath
      ? []
      : [
          "export type Json =",
          "  | string",
          "  | number",
          "  | boolean",
          "  | null",
          "  | { [key: string]: Json | undefined }",
          "  | Json[];",
          "",
        ]),
    "export const JsonSchema: z.ZodType<Json> = z.lazy(() =>",
    "  z.union([",
    "    z.string(),",
    "    z.number(),",
    "    z.boolean(),",
    "    z.null(),",
    "    z.record(z.string(), z.union([JsonSchema, z.undefined()])),",
    "    z.array(JsonSchema),",
    "  ])",
    ");",
    "",
  ];
  emitEnumSchemas(lines, schemas, identifiers);
  emitCompositeSchemas(lines, schemas, shapes, identifiers);
  emitRelationSchemas(lines, schemas, shapes, identifiers);
  return `${lines.join("\n")}\n`;
}

type SortedSchemas = [string, SchemaEntry][];

function emitEnumSchemas(
  lines: string[],
  schemas: SortedSchemas,
  identifiers: GeneratedIdentifiers
): void {
  for (const [schema, entry] of schemas) {
    for (const item of sortedByName(entry.enums)) {
      if (item.values.length === 0) {
        continue;
      }
      const name = schemaIdentifier(identifiers, schema, "enum", item.name);
      lines.push(
        `export const ${name} = z.enum([${item.values.map((value) => JSON.stringify(value)).join(", ")}]);`,
        ""
      );
    }
  }
}

function emitCompositeSchemas(
  lines: string[],
  schemas: SortedSchemas,
  shapes: SchemaShapes,
  identifiers: GeneratedIdentifiers
): void {
  for (const [schema, entry] of schemas) {
    for (const composite of sortedByName(entry.composites)) {
      const name = schemaIdentifier(identifiers, schema, "composite", composite.name);
      lines.push(`export const ${name} = z.object({`);
      for (const column of composite.columns) {
        const base = zodExpression(shapes, schema, identifiers, column.type);
        lines.push(`  ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`},`);
      }
      lines.push("});", "");
    }
  }
}

function emitRelationSchemas(
  lines: string[],
  schemas: SortedSchemas,
  shapes: SchemaShapes,
  identifiers: GeneratedIdentifiers
): void {
  for (const [schema, entry] of schemas) {
    const zodFor = (sqlType: string) => zodExpression(shapes, schema, identifiers, sqlType);
    for (const table of sortedByName(entry.tables)) {
      emitRowSchema(
        lines,
        schemaIdentifier(identifiers, schema, "table", table.name, "Row"),
        table.columns,
        zodFor
      );
      emitInsertSchema(
        lines,
        schemaIdentifier(identifiers, schema, "table", table.name, "Insert"),
        table.columns,
        zodFor
      );
      emitUpdateSchema(
        lines,
        schemaIdentifier(identifiers, schema, "table", table.name, "Update"),
        table.columns,
        zodFor
      );
    }
    for (const view of sortedByName(entry.views)) {
      emitRowSchema(
        lines,
        schemaIdentifier(identifiers, schema, "view", view.name, "Row"),
        view.columns,
        zodFor,
        true
      );
    }
  }
}

function emitRowSchema(
  lines: string[],
  name: string,
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string,
  forceNullable = false
): void {
  lines.push(`export const ${name} = z.object({`);
  for (const column of columns) {
    const base = zodFor(column.type);
    lines.push(
      `  ${quoteKey(column.name)}: ${forceNullable || !column.notNull ? `${base}.nullable()` : base},`
    );
  }
  lines.push("});", "");
}

function emitInsertSchema(
  lines: string[],
  name: string,
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push(`export const ${name} = z.object({`);
  for (const column of columns) {
    if (isNonWritableColumn(column)) {
      continue;
    }
    const base = zodFor(column.type);
    const nullable = column.notNull ? base : `${base}.nullable()`;
    lines.push(
      `  ${quoteKey(column.name)}: ${isOptionalInsertColumn(column) ? `${nullable}.optional()` : nullable},`
    );
  }
  lines.push("});", "");
}

function emitUpdateSchema(
  lines: string[],
  name: string,
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push(`export const ${name} = z.object({`);
  for (const column of columns) {
    if (isNonWritableColumn(column)) {
      continue;
    }
    const base = zodFor(column.type);
    lines.push(
      `  ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`}.optional(),`
    );
  }
  lines.push("});", "");
}

function zodExpression(
  shapes: SchemaShapes,
  schema: string,
  identifiers: GeneratedIdentifiers,
  sqlType: string
): string {
  const resolved = resolveColumnType(shapes, schema, sqlType);
  let expression: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    expression = schemaIdentifier(
      identifiers,
      resolved.enumRef.schema,
      "enum",
      resolved.enumRef.name
    );
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    expression = `z.lazy(() => ${schemaIdentifier(
      identifiers,
      resolved.compositeRef.schema,
      "composite",
      resolved.compositeRef.name
    )})`;
  } else if (resolved.kind === "relation" && resolved.relationRef) {
    expression = `z.lazy(() => ${schemaIdentifier(
      identifiers,
      resolved.relationRef.schema,
      resolved.relationRef.collection === "Tables" ? "table" : "view",
      resolved.relationRef.name,
      "Row"
    )})`;
  } else if (resolved.kind === "json") {
    expression = "JsonSchema";
  } else if (resolved.kind === "unknown") {
    expression = "z.unknown()";
  } else if (resolved.kind === "number") {
    expression = "z.number()";
  } else if (resolved.kind === "boolean") {
    expression = "z.boolean()";
  } else if (resolved.kind === "void") {
    expression = "z.void()";
  } else {
    expression = "z.string()";
  }
  for (let depth = 0; depth < resolved.arrayDepth; depth += 1) {
    expression = `z.array(${expression})`;
  }
  return expression;
}

function schemaIdentifier(
  identifiers: GeneratedIdentifiers,
  schema: string,
  kind: "composite" | "enum" | "table" | "view",
  name: string,
  shape?: "Insert" | "Row" | "Update"
): string {
  return `${generatedIdentifier(identifiers, schema, kind, name, shape)}Schema`;
}
