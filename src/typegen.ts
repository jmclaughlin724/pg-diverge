import type { SchemaModel } from "./core.js";
import type {
  ColumnShape,
  FunctionShape,
  RelationshipShape,
  SchemaShapes,
} from "./typegen-model.js";
import { collectSchemaShapes, resolveColumnType } from "./typegen-model.js";

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
    const typeOf = (sqlType: string) => tsType(shapes, schemaName, sqlType);
    lines.push(`  ${quoteKey(schemaName)}: {`);
    lines.push("    Tables: {");
    for (const table of [...entry.tables].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`      ${quoteKey(table.name)}: {`);
      lines.push("        Row: {");
      for (const column of table.columns) {
        const base = typeOf(column.type);
        lines.push(
          `          ${quoteKey(column.name)}: ${column.notNull ? base : `${base} | null`};`,
        );
      }
      lines.push("        };");
      lines.push("        Insert: {");
      for (const column of table.columns) {
        lines.push(`          ${insertField(column, typeOf)}`);
      }
      lines.push("        };");
      lines.push("        Update: {");
      for (const column of table.columns) {
        lines.push(`          ${updateField(column, typeOf)}`);
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
        lines.push(`          ${quoteKey(column.name)}: ${typeOf(column.type)} | null;`);
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
        lines.push(`        ${quoteKey(column.name)}: ${typeOf(column.type)} | null;`);
      }
      lines.push("      };");
    }
    lines.push("    };");
    lines.push(...functionsBlock(entry.functions, typeOf));
    lines.push("  };");
  }
  lines.push("};");
  lines.push("");
  lines.push(...helperBlock());
  lines.push("");
  lines.push(...constantsBlock(sortedSchemas));
  return `${lines.join("\n")}\n`;
}

function tsType(shapes: SchemaShapes, schemaName: string, sqlType: string): string {
  const resolved = resolveColumnType(shapes, schemaName, sqlType);
  let mapped: string;
  if (resolved.kind === "enum" && resolved.enumRef) {
    mapped = `Database["${resolved.enumRef.schema}"]["Enums"]["${resolved.enumRef.name}"]`;
  } else if (resolved.kind === "composite" && resolved.compositeRef) {
    mapped = `Database["${resolved.compositeRef.schema}"]["CompositeTypes"]["${resolved.compositeRef.name}"]`;
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
  if (column.generated !== undefined || column.identity === "a") {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  const type = column.notNull ? base : `${base} | null`;
  const optional = !column.notNull || column.default !== undefined || column.identity !== undefined;
  return `${quoteKey(column.name)}${optional ? "?" : ""}: ${type};`;
}

function updateField(column: ColumnShape, typeOf: (sqlType: string) => string): string {
  if (column.generated !== undefined || column.identity === "a") {
    return `${quoteKey(column.name)}?: never;`;
  }
  const base = typeOf(column.type);
  return `${quoteKey(column.name)}?: ${column.notNull ? base : `${base} | null`};`;
}

function functionsBlock(functions: FunctionShape[], typeOf: (sqlType: string) => string): string[] {
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
    left.localeCompare(right),
  )) {
    const argVariants = sortedUnique(overloads.map((fn) => renderFunctionArgs(fn, typeOf)));
    const returnVariants = sortedUnique(overloads.map((fn) => renderFunctionReturns(fn, typeOf)));
    lines.push(
      `      ${quoteKey(name)}: { Args: ${argVariants.join(" | ")}; Returns: ${returnVariants.join(" | ")} };`,
    );
  }
  lines.push("    };");
  return lines;
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
  const items = relationships.map(
    (item) =>
      `{ foreignKeyName: ${JSON.stringify(item.foreignKeyName)}; columns: ${tupleType(item.columns)}; isOneToOne: ${item.isOneToOne}; referencedRelation: ${JSON.stringify(item.referencedRelation)}; referencedColumns: ${tupleType(item.referencedColumns)} }`,
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
