import { quoteCodeString, quoteKey } from "./database.js";
import type { ColumnShape, SchemaEntry, SchemaShapes } from "./model.js";
import {
  computedRelationshipFunctions,
  isNonWritableColumn,
  isOptionalInsertColumn,
  resolveColumnType,
  sortedByName,
} from "./model.js";

export function generateZodSchemas(shapes: SchemaShapes, typesImportPath?: string): string {
  const hasDatabaseContract = typesImportPath !== undefined;
  const schemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const lines = [
    'import { z } from "zod";',
    "",
    ...(hasDatabaseContract
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
  if (hasDatabaseContract) {
    emitSupaschemaZodShape(lines, schemas);
  } else {
    lines.push(
      "type SupaschemaZodShape = {",
      "  [schema: string]: {",
      "    Tables: Record<string, { Row: z.ZodTypeAny; Insert: z.ZodTypeAny; Update: z.ZodTypeAny }>;",
      "    Views: Record<string, { Row: z.ZodTypeAny; Insert?: z.ZodTypeAny; Update?: z.ZodTypeAny }>;",
      "    Enums: Record<string, z.ZodTypeAny>;",
      "    CompositeTypes: Record<string, z.ZodTypeAny>;",
      "  };",
      "};",
      ""
    );
  }
  lines.push(
    hasDatabaseContract
      ? "export const SupaschemaZod = {"
      : "export const SupaschemaZod: SupaschemaZodShape = {"
  );
  for (const [schema, entry] of schemas) {
    emitSchema(lines, shapes, schema, entry, hasDatabaseContract);
  }
  lines.push(hasDatabaseContract ? "} as const satisfies SupaschemaZodShape;" : "} as const;");
  if (hasDatabaseContract) {
    const importedTypes = lines.some((line) => line.includes("Database["))
      ? "Database, Json"
      : "Json";
    lines.unshift(`import type { ${importedTypes} } from ${quoteCodeString(typesImportPath)};`);
  }
  return `${lines.join("\n")}\n`;
}

function emitSupaschemaZodShape(lines: string[], schemas: [string, SchemaEntry][]): void {
  lines.push("type SupaschemaZodShape = {");
  for (const [schema, entry] of schemas) {
    lines.push(`  ${quoteKey(schema)}: {`, "    Tables: {");
    for (const table of sortedByName(entry.tables)) {
      lines.push(`      ${quoteKey(table.name)}: {`);
      emitZodContractShape(lines, ["Row", "Insert", "Update"]);
      lines.push("      };");
    }
    lines.push("    };", "    Views: {");
    for (const view of sortedByName(entry.views)) {
      lines.push(`      ${quoteKey(view.name)}: {`);
      emitZodContractShape(lines, view.updatable ? ["Row", "Insert", "Update"] : ["Row"]);
      lines.push("      };");
    }
    lines.push("    };", "    Enums: {");
    for (const item of sortedByName(entry.enums)) {
      lines.push(`      ${quoteKey(item.name)}: z.ZodTypeAny;`);
    }
    lines.push("    };", "    CompositeTypes: {");
    for (const composite of sortedByName(entry.composites)) {
      lines.push(`      ${quoteKey(composite.name)}: z.ZodTypeAny;`);
    }
    lines.push("    };", "  };");
  }
  lines.push("};", "");
}

function emitZodContractShape(lines: string[], shapes: ("Insert" | "Row" | "Update")[]): void {
  for (const shape of shapes) {
    lines.push(`        ${shape}: z.ZodTypeAny;`);
  }
}

function databaseTypePath(schema: string, collection: string, name: string): string {
  return `Database[${quoteCodeString(schema)}][${quoteCodeString(collection)}][${quoteCodeString(name)}]`;
}

function emitSchema(
  lines: string[],
  shapes: SchemaShapes,
  schema: string,
  entry: SchemaEntry,
  hasDatabaseContract: boolean
): void {
  lines.push(`  ${quoteKey(schema)}: {`);
  emitTableSchemas(lines, shapes, schema, entry, hasDatabaseContract);
  emitViewSchemas(lines, shapes, schema, entry, hasDatabaseContract);
  emitEnumSchemas(lines, entry);
  emitCompositeSchemas(lines, shapes, schema, entry, hasDatabaseContract);
  lines.push("  },");
}

function emitTableSchemas(
  lines: string[],
  shapes: SchemaShapes,
  schema: string,
  entry: SchemaEntry,
  hasDatabaseContract: boolean
): void {
  const zodFor = (sqlType: string) => zodExpression(shapes, schema, sqlType, hasDatabaseContract);
  lines.push("    Tables: {");
  for (const table of sortedByName(entry.tables)) {
    lines.push(`      ${quoteKey(table.name)}: {`);
    emitRowSchema(
      lines,
      "Row",
      table.columns,
      zodFor,
      shapes,
      schema,
      entry,
      table.name,
      hasDatabaseContract
    );
    emitInsertSchema(lines, table.columns, zodFor);
    emitUpdateSchema(lines, table.columns, zodFor);
    lines.push("      },");
  }
  lines.push("    },");
}

function emitViewSchemas(
  lines: string[],
  shapes: SchemaShapes,
  schema: string,
  entry: SchemaEntry,
  hasDatabaseContract: boolean
): void {
  const zodFor = (sqlType: string) => zodExpression(shapes, schema, sqlType, hasDatabaseContract);
  lines.push("    Views: {");
  for (const view of sortedByName(entry.views)) {
    lines.push(`      ${quoteKey(view.name)}: {`);
    emitRowSchema(
      lines,
      "Row",
      view.columns,
      zodFor,
      shapes,
      schema,
      entry,
      view.name,
      hasDatabaseContract
    );
    if (view.updatable) {
      emitViewInsertSchema(lines, view.columns, zodFor);
      emitViewUpdateSchema(lines, view.columns, zodFor);
    }
    lines.push("      },");
  }
  lines.push("    },");
}

function emitEnumSchemas(lines: string[], entry: SchemaEntry): void {
  lines.push("    Enums: {");
  for (const item of sortedByName(entry.enums)) {
    if (item.values.length === 0) {
      lines.push(`      ${quoteKey(item.name)}: z.never(),`);
      continue;
    }
    lines.push(
      `      ${quoteKey(item.name)}: z.enum([${item.values.map(quoteCodeString).join(", ")}]),`
    );
  }
  lines.push("    },");
}

function emitCompositeSchemas(
  lines: string[],
  shapes: SchemaShapes,
  schema: string,
  entry: SchemaEntry,
  hasDatabaseContract: boolean
): void {
  const zodFor = (sqlType: string) => zodExpression(shapes, schema, sqlType, hasDatabaseContract);
  lines.push("    CompositeTypes: {");
  for (const composite of sortedByName(entry.composites)) {
    lines.push(`      ${quoteKey(composite.name)}: z.object({`);
    for (const column of composite.columns) {
      const base = zodFor(column.type);
      lines.push(`        ${quoteKey(column.name)}: ${base}.nullable(),`);
    }
    lines.push("      }),");
  }
  lines.push("    },");
}

function emitRowSchema(
  lines: string[],
  name: string,
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string,
  shapes: SchemaShapes,
  schema: string,
  entry: SchemaEntry,
  relationName: string,
  hasDatabaseContract: boolean
): void {
  lines.push(`        ${name}: z.object({`);
  for (const column of columns) {
    const base = zodFor(column.type);
    lines.push(
      `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`},`
    );
  }
  for (const fn of computedRelationshipFunctions(shapes, schema, entry, relationName)) {
    lines.push(
      `          ${quoteKey(fn.name)}: ${zodFunctionReturnExpression(shapes, schema, fn, hasDatabaseContract)}.nullable(),`
    );
  }
  lines.push("        }),");
}

function zodFunctionReturnExpression(
  shapes: SchemaShapes,
  schema: string,
  fn: SchemaEntry["functions"][number],
  hasDatabaseContract: boolean
): string {
  const returns = fn.returns;
  let expression: string;
  if (returns?.columns && returns.columns.length > 0) {
    const fields = returns.columns
      .map(
        (column) =>
          `${quoteKey(column.name)}: ${zodExpression(shapes, schema, column.type, hasDatabaseContract)}`
      )
      .join(", ");
    expression = `z.object({ ${fields} })`;
  } else {
    expression = returns
      ? zodExpression(shapes, schema, returns.type, hasDatabaseContract)
      : "z.unknown()";
  }
  return expression;
}

function emitInsertSchema(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push("        Insert: z.object({");
  for (const column of columns) {
    if (isNonWritableColumn(column)) {
      continue;
    }
    const base = zodFor(column.type);
    const nullable = column.notNull ? base : `${base}.nullable()`;
    lines.push(
      `          ${quoteKey(column.name)}: ${isOptionalInsertColumn(column) ? `${nullable}.optional()` : nullable},`
    );
  }
  lines.push("        }),");
}

function emitUpdateSchema(
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
    lines.push(
      `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`}.optional(),`
    );
  }
  lines.push("        }),");
}

function emitViewInsertSchema(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push("        Insert: z.object({");
  for (const column of columns) {
    if (!column.updatable) {
      continue;
    }
    lines.push(`          ${quoteKey(column.name)}: ${zodFor(column.type)}.nullable().optional(),`);
  }
  lines.push("        }),");
}

function emitViewUpdateSchema(
  lines: string[],
  columns: ColumnShape[],
  zodFor: (sqlType: string) => string
): void {
  lines.push("        Update: z.object({");
  for (const column of columns) {
    if (!column.updatable) {
      continue;
    }
    lines.push(`          ${quoteKey(column.name)}: ${zodFor(column.type)}.nullable().optional(),`);
  }
  lines.push("        }),");
}

function zodExpression(
  shapes: SchemaShapes,
  schema: string,
  sqlType: string,
  hasDatabaseContract: boolean
): string {
  const resolved = resolveColumnType(shapes, schema, sqlType);
  let expression: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    expression = lazyZodPath(
      resolved.enumRef.schema,
      "Enums",
      resolved.enumRef.name,
      hasDatabaseContract
    );
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    expression = lazyZodPath(
      resolved.compositeRef.schema,
      "CompositeTypes",
      resolved.compositeRef.name,
      hasDatabaseContract
    );
  } else if (resolved.kind === "relation" && resolved.relationRef) {
    expression = lazyZodRelationRow(
      resolved.relationRef.schema,
      resolved.relationRef.collection,
      resolved.relationRef.name,
      hasDatabaseContract
    );
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
  } else if (resolved.kind === "record") {
    expression = "z.record(z.string(), z.unknown())";
  } else {
    expression = "z.string()";
  }
  for (let depth = 0; depth < resolved.arrayDepth; depth += 1) {
    expression = `z.array(${expression})`;
  }
  return expression;
}

function lazyZodPath(
  schema: string,
  collection: string,
  name: string,
  hasDatabaseContract: boolean
): string {
  const target = `SupaschemaZod[${quoteCodeString(schema)}][${quoteCodeString(collection)}][${quoteCodeString(name)}]`;
  return hasDatabaseContract
    ? `z.lazy((): z.ZodType<${databaseTypePath(schema, collection, name)}> => ${target})`
    : `z.lazy(() => ${target})`;
}

function lazyZodRelationRow(
  schema: string,
  collection: string,
  name: string,
  hasDatabaseContract: boolean
): string {
  const target = `SupaschemaZod[${quoteCodeString(schema)}][${quoteCodeString(collection)}][${quoteCodeString(name)}].Row`;
  return hasDatabaseContract
    ? `z.lazy((): z.ZodType<${databaseTypePath(schema, collection, name)}["Row"]> => ${target})`
    : `z.lazy(() => ${target})`;
}
