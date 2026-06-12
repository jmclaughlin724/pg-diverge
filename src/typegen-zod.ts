import type { SchemaModel } from "./core.js";
import { quoteKey } from "./typegen.js";
import type { ColumnShape, SchemaShapes } from "./typegen-model.js";
import { collectSchemaShapes, resolveColumnType } from "./typegen-model.js";

export async function generateZodSchemas(model: SchemaModel): Promise<string> {
  const shapes = await collectSchemaShapes(model);
  const sortedSchemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const enumIdents = buildEnumIdentifiers(sortedSchemas);
  const lines: string[] = [
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
  for (const [schemaName, entry] of sortedSchemas) {
    for (const item of [...entry.enums].sort((a, b) => a.name.localeCompare(b.name))) {
      const ident = enumIdents.get(`${schemaName}.${item.name}`);
      if (ident && item.values.length > 0) {
        lines.push(
          `const ${ident} = z.enum([${item.values.map((value) => JSON.stringify(value)).join(", ")}]);`,
        );
      }
    }
  }
  lines.push("");
  lines.push("export const schemas = {");
  for (const [schemaName, entry] of sortedSchemas) {
    const zodFor = (sqlType: string) => zodExpr(shapes, schemaName, enumIdents, sqlType);
    lines.push(`  ${quoteKey(schemaName)}: {`);
    lines.push("    Enums: {");
    for (const item of [...entry.enums].sort((a, b) => a.name.localeCompare(b.name))) {
      const ident = enumIdents.get(`${schemaName}.${item.name}`);
      if (ident && item.values.length > 0) {
        lines.push(`      ${quoteKey(item.name)}: ${ident},`);
      }
    }
    lines.push("    },");
    lines.push("    Tables: {");
    for (const table of [...entry.tables].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(table.name)}: {`);
      lines.push("        Row: z.object({");
      for (const column of table.columns) {
        const base = zodFor(column.type);
        lines.push(
          `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base}.nullable()`},`,
        );
      }
      lines.push("        }),");
      lines.push("        Insert: z.object({");
      for (const column of table.columns) {
        const field = zodInsertField(column, zodFor);
        if (field) {
          lines.push(`          ${field}`);
        }
      }
      lines.push("        }),");
      lines.push("        Update: z.object({");
      for (const column of table.columns) {
        if (column.generated !== undefined || column.identity === "a") {
          continue;
        }
        const base = zodFor(column.type);
        const value = column.notNull ? base : `${base}.nullable()`;
        lines.push(`          ${quoteKey(column.name)}: ${value}.optional(),`);
      }
      lines.push("        }),");
      lines.push("      },");
    }
    lines.push("    },");
    lines.push("    Views: {");
    for (const view of [...entry.views].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(view.name)}: {`);
      lines.push("        Row: z.object({");
      for (const column of view.columns) {
        lines.push(`          ${quoteKey(column.name)}: ${zodFor(column.type)}.nullable(),`);
      }
      lines.push("        }),");
      lines.push("      },");
    }
    lines.push("    },");
    lines.push("  },");
  }
  lines.push("} as const;");
  return `${lines.join("\n")}\n`;
}

function buildEnumIdentifiers(
  schemas: [string, { enums: { name: string }[] }][],
): Map<string, string> {
  const idents = new Map<string, string>();
  const used = new Set<string>();
  for (const [schemaName, entry] of schemas) {
    for (const item of entry.enums) {
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
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
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
  sqlType: string,
): string {
  const resolved = resolveColumnType(shapes, schemaName, sqlType);
  let mapped: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    mapped = enumIdents.get(`${resolved.enumRef.schema}.${resolved.enumRef.name}`) ?? "z.unknown()";
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
  zodFor: (sqlType: string) => string,
): string | undefined {
  if (column.generated !== undefined || column.identity === "a") {
    return undefined;
  }
  const base = zodFor(column.type);
  const value = column.notNull ? base : `${base}.nullable()`;
  const optional = !column.notNull || column.default !== undefined || column.identity !== undefined;
  return `${quoteKey(column.name)}: ${optional ? `${value}.optional()` : value},`;
}
