import type { SchemaModel } from "./core.js";
import type { ColumnShape, RelationshipShape, SchemaShapes } from "./typegen-model.js";
import { collectSchemaShapes, scalarTypeCategory } from "./typegen-model.js";

export async function generateDatabaseTypes(model: SchemaModel): Promise<string> {
  const shapes = await collectSchemaShapes(model);
  const lines: string[] = [
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export type Database = {",
  ];
  const sortedSchemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [schemaName, entry] of sortedSchemas) {
    const enumRef = makeEnumRef(shapes, schemaName);
    lines.push(`  ${quoteKey(schemaName)}: {`);
    lines.push("    Tables: {");
    for (const table of [...entry.tables].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(table.name)}: {`);
      lines.push("        Row: {");
      for (const column of table.columns) {
        const base = tsType(column.type, enumRef);
        lines.push(
          `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base} | null`};`,
        );
      }
      lines.push("        };");
      lines.push("        Insert: {");
      for (const column of table.columns) {
        lines.push(`          ${insertField(column, enumRef)}`);
      }
      lines.push("        };");
      lines.push("        Update: {");
      for (const column of table.columns) {
        lines.push(`          ${updateField(column, enumRef)}`);
      }
      lines.push("        };");
      lines.push(`        Relationships: ${renderRelationships(table.relationships)};`);
      lines.push("      };");
    }
    lines.push("    };");
    lines.push("    Views: {");
    for (const view of [...entry.views].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(view.name)}: {`);
      lines.push("        Row: {");
      for (const column of view.columns) {
        lines.push(`          ${quoteKey(column.name)}: ${tsType(column.type, enumRef)} | null;`);
      }
      lines.push("        };");
      lines.push("      };");
    }
    lines.push("    };");
    lines.push("    Enums: {");
    for (const item of [...entry.enums].sort((a, b) => a.name.localeCompare(b.name))) {
      const union = item.values.map((value) => JSON.stringify(value)).join(" | ");
      lines.push(`      ${quoteKey(item.name)}: ${union.length > 0 ? union : "never"};`);
    }
    lines.push("    };");
    lines.push("    CompositeTypes: {");
    for (const composite of [...entry.composites].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(composite.name)}: {`);
      for (const column of composite.columns) {
        lines.push(`        ${quoteKey(column.name)}: ${tsType(column.type, enumRef)} | null;`);
      }
      lines.push("      };");
    }
    lines.push("    };");
    lines.push("    Functions: { [_ in never]: never };");
    lines.push("  };");
  }
  lines.push("};");
  lines.push("");
  lines.push(...helperBlock());
  lines.push("");
  lines.push(...constantsBlock(sortedSchemas));
  return `${lines.join("\n")}\n`;
}

function makeEnumRef(
  shapes: SchemaShapes,
  schemaName: string,
): (key: string) => string | undefined {
  return (key: string) => {
    const found = shapes.enumKeys.get(key) ?? shapes.enumKeys.get(`${schemaName}.${key}`);
    return found ? `Database["${found.schema}"]["Enums"]["${found.name}"]` : undefined;
  };
}

function tsType(sqlType: string, enumRef: (key: string) => string | undefined): string {
  const { arrayDepth, base, category } = scalarTypeCategory(sqlType);
  let mapped: string;
  if (category === "number") {
    mapped = "number";
  } else if (category === "string") {
    mapped = "string";
  } else if (category === "boolean") {
    mapped = "boolean";
  } else if (category === "json") {
    mapped = "Json";
  } else {
    mapped = enumRef(base) ?? "unknown";
  }
  return mapped + "[]".repeat(arrayDepth);
}

function insertField(column: ColumnShape, enumRef: (key: string) => string | undefined): string {
  if (column.generated !== undefined) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = tsType(column.type, enumRef);
  const type = column.notNull ? base : `${base} | null`;
  const optional = !column.notNull || column.default !== undefined || column.identity !== undefined;
  return `${quoteKey(column.name)}${optional ? "?" : ""}: ${type};`;
}

function updateField(column: ColumnShape, enumRef: (key: string) => string | undefined): string {
  if (column.generated !== undefined) {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = tsType(column.type, enumRef);
  return `${quoteKey(column.name)}?: ${column.notNull ? base : `${base} | null`};`;
}

function renderRelationships(relationships: RelationshipShape[]): string {
  if (relationships.length === 0) {
    return "[]";
  }
  const items = relationships.map(
    (item) =>
      `{ foreignKeyName: ${JSON.stringify(item.foreignKeyName)}; columns: ${tupleType(item.columns)}; isOneToOne: false; referencedRelation: ${JSON.stringify(item.referencedRelation)}; referencedColumns: ${tupleType(item.referencedColumns)} }`,
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
    'export type Tables<S extends keyof Database, T extends keyof Database[S]["Tables"]> = Database[S]["Tables"][T] extends { Row: infer R } ? R : never;',
    'export type TablesInsert<S extends keyof Database, T extends keyof Database[S]["Tables"]> = Database[S]["Tables"][T] extends { Insert: infer I } ? I : never;',
    'export type TablesUpdate<S extends keyof Database, T extends keyof Database[S]["Tables"]> = Database[S]["Tables"][T] extends { Update: infer U } ? U : never;',
    'export type Views<S extends keyof Database, V extends keyof Database[S]["Views"]> = Database[S]["Views"][V] extends { Row: infer R } ? R : never;',
    'export type Enums<S extends keyof Database, E extends keyof Database[S]["Enums"]> = Database[S]["Enums"][E];',
  ];
}

function constantsBlock(
  schemas: [string, { enums: { name: string; values: string[] }[] }][],
): string[] {
  const lines = ["export const Constants = {"];
  for (const [schemaName, entry] of schemas) {
    lines.push(`  ${quoteKey(schemaName)}: {`);
    lines.push("    Enums: {");
    for (const item of [...entry.enums].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `      ${quoteKey(item.name)}: [${item.values.map((value) => JSON.stringify(value)).join(", ")}],`,
      );
    }
    lines.push("    },");
    lines.push("  },");
  }
  lines.push("} as const;");
  return lines;
}
