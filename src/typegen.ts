import type { SchemaModel, SchemaObject } from "./core.js";
import { asRecord, readArray, readString, stringList } from "./sql/ast.js";
import { parseSqlAst } from "./sql/parser.js";
import { canonicalColumnType } from "./sql/table-shape.js";

interface ColumnShape {
  default?: unknown;
  generated?: unknown;
  identity?: string;
  name: string;
  notNull: boolean;
  type: string;
}

interface RelationshipShape {
  columns: string[];
  foreignKeyName: string;
  referencedColumns: string[];
  referencedRelation: string;
}

const numberTypes = new Set([
  "smallint",
  "int2",
  "integer",
  "int",
  "int4",
  "bigint",
  "int8",
  "real",
  "float4",
  "double precision",
  "float8",
  "numeric",
  "decimal",
  "oid",
]);

const stringTypes = new Set([
  "text",
  "character varying",
  "varchar",
  "character",
  "char",
  "bpchar",
  "uuid",
  "citext",
  "name",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "interval",
  "date",
  "time",
  "timetz",
  "time with time zone",
  "time without time zone",
  "timestamp",
  "timestamptz",
  "timestamp with time zone",
  "timestamp without time zone",
  "xml",
]);

export async function generateDatabaseTypes(model: SchemaModel): Promise<string> {
  const schemas = new Map<
    string,
    {
      composites: { columns: ColumnShape[]; name: string }[];
      enums: { name: string; values: string[] }[];
      tables: { columns: ColumnShape[]; name: string; relationships: RelationshipShape[] }[];
      views: { columns: { name: string; type: string }[]; name: string }[];
    }
  >();
  const schemaOf = (object: SchemaObject) => {
    const name = object.ref.schema ?? "public";
    let entry = schemas.get(name);
    if (!entry) {
      entry = { composites: [], enums: [], tables: [], views: [] };
      schemas.set(name, entry);
    }
    return entry;
  };

  const enumKeys = new Map<string, { name: string; schema: string }>();
  for (const object of model.objects) {
    if (object.ref.kind === "enum") {
      const schema = object.ref.schema ?? "public";
      enumKeys.set(`${schema}.${object.ref.name}`, { name: object.ref.name, schema });
      enumKeys.set(object.ref.name, { name: object.ref.name, schema });
    }
  }

  const tablesByKey = new Map<string, ColumnShape[]>();
  for (const object of model.objects) {
    if (object.ref.kind === "table") {
      const columns = tableColumns(object);
      tablesByKey.set(`${object.ref.schema ?? "public"}.${object.ref.name}`, columns);
      schemaOf(object).tables.push({ columns, name: object.ref.name, relationships: [] });
    } else if (object.ref.kind === "enum") {
      const values = Array.isArray(object.metadata.values)
        ? object.metadata.values.map((value) => String(value))
        : [];
      schemaOf(object).enums.push({ name: object.ref.name, values });
    }
  }

  for (const object of model.objects) {
    if (object.ref.kind === "view" || object.ref.kind === "materialized-view") {
      schemaOf(object).views.push({
        columns: await viewColumns(object, tablesByKey),
        name: object.ref.name,
      });
    } else if (object.ref.kind === "type") {
      schemaOf(object).composites.push({
        columns: await compositeColumns(object),
        name: object.ref.name,
      });
    } else if (object.ref.kind === "constraint") {
      await collectRelationship(object, schemas);
    }
  }

  const lines: string[] = [
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export type Database = {",
  ];
  const sortedSchemas = [...schemas.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [schemaName, entry] of sortedSchemas) {
    const enumRef = (key: string) => {
      const found = enumKeys.get(key) ?? enumKeys.get(`${schemaName}.${key}`);
      return found ? `Database["${found.schema}"]["Enums"]["${found.name}"]` : undefined;
    };
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

function tableColumns(object: SchemaObject): ColumnShape[] {
  const shape = asRecord(object.metadata.canonicalShape);
  return readArray(shape?.columns).flatMap((item) => {
    const column = asRecord(item);
    const name = readString(column?.name);
    const type = readString(column?.type);
    if (!(column && name && type)) {
      return [];
    }
    return [
      {
        name,
        notNull: column.notNull === true,
        type,
        ...(column.default !== undefined ? { default: column.default } : {}),
        ...(column.generated !== undefined ? { generated: column.generated } : {}),
        ...(typeof column.identity === "string" ? { identity: column.identity } : {}),
      },
    ];
  });
}

async function viewColumns(
  object: SchemaObject,
  tablesByKey: Map<string, ColumnShape[]>,
): Promise<{ name: string; type: string }[]> {
  const names = Array.isArray(object.metadata.viewColumns)
    ? object.metadata.viewColumns.map((value) => String(value))
    : undefined;
  const parsed = await parseSqlAst(object.sql, object.file);
  const select = firstSelect(parsed.ast);
  const fromTable = soleFromTableColumns(select, object.ref.schema ?? "public", tablesByKey);
  const resolved = new Map<string, string>();
  for (const target of readArray(select?.targetList)) {
    const resTarget = asRecord(asRecord(target)?.ResTarget);
    const columnRef = asRecord(asRecord(resTarget?.val)?.ColumnRef);
    const fields = stringList(columnRef?.fields);
    const sourceColumn = fields.at(-1);
    const outputName = readString(resTarget?.name) ?? sourceColumn;
    const match = fromTable?.find((column) => column.name === sourceColumn);
    if (outputName && match) {
      resolved.set(outputName, match.type);
    }
  }
  if (names) {
    return names.map((name) => ({ name, type: resolved.get(name) ?? "unknown" }));
  }
  if (fromTable && isStarSelect(select)) {
    return fromTable.map((column) => ({ name: column.name, type: column.type }));
  }
  return [...resolved.entries()].map(([name, type]) => ({ name, type }));
}

async function compositeColumns(object: SchemaObject): Promise<ColumnShape[]> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const composite = asRecord(asRecord(asRecord(statements[0])?.stmt)?.CompositeTypeStmt);
  return readArray(composite?.coldeflist).flatMap((item) => {
    const columnDef = asRecord(asRecord(item)?.ColumnDef);
    const name = readString(columnDef?.colname);
    if (!(columnDef && name)) {
      return [];
    }
    return [{ name, notNull: false, type: canonicalColumnType(columnDef.typeName) }];
  });
}

async function collectRelationship(
  object: SchemaObject,
  schemas: Map<string, { tables: { name: string; relationships: RelationshipShape[] }[] }>,
): Promise<void> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const alter = asRecord(asRecord(asRecord(statements[0])?.stmt)?.AlterTableStmt);
  for (const command of readArray(alter?.cmds)) {
    const constraint = asRecord(
      asRecord(asRecord(asRecord(command)?.AlterTableCmd)?.def)?.Constraint,
    );
    if (!constraint || readString(constraint.contype) !== "CONSTR_FOREIGN") {
      continue;
    }
    const schemaName = object.ref.schema ?? "public";
    const table = schemas.get(schemaName)?.tables.find((entry) => entry.name === object.ref.table);
    const pkTable = asRecord(constraint.pktable);
    if (!(table && pkTable)) {
      continue;
    }
    table.relationships.push({
      columns: stringList(constraint.fk_attrs),
      foreignKeyName: readString(constraint.conname) ?? object.ref.name,
      referencedColumns: stringList(constraint.pk_attrs),
      referencedRelation: readString(pkTable.relname) ?? "",
    });
  }
}

function firstSelect(ast: unknown): Record<string, unknown> | undefined {
  const statements = readArray(asRecord(ast)?.stmts);
  const stmt = asRecord(asRecord(statements[0])?.stmt);
  const view = asRecord(stmt?.ViewStmt);
  const tableAs = asRecord(stmt?.CreateTableAsStmt);
  return asRecord(asRecord(view?.query ?? tableAs?.query)?.SelectStmt);
}

function soleFromTableColumns(
  select: Record<string, unknown> | undefined,
  defaultSchema: string,
  tablesByKey: Map<string, ColumnShape[]>,
): ColumnShape[] | undefined {
  const fromClause = readArray(select?.fromClause);
  if (fromClause.length !== 1) {
    return undefined;
  }
  const rangeVar = asRecord(asRecord(fromClause[0])?.RangeVar);
  const relname = readString(rangeVar?.relname);
  if (!relname) {
    return undefined;
  }
  const schemaName = readString(rangeVar?.schemaname) ?? defaultSchema;
  return tablesByKey.get(`${schemaName}.${relname}`);
}

function isStarSelect(select: Record<string, unknown> | undefined): boolean {
  const targets = readArray(select?.targetList);
  if (targets.length !== 1) {
    return false;
  }
  const resTarget = asRecord(asRecord(targets[0])?.ResTarget);
  const columnRef = asRecord(asRecord(resTarget?.val)?.ColumnRef);
  const fields = readArray(columnRef?.fields);
  return fields.length === 1 && asRecord(fields[0])?.A_Star !== undefined;
}

function tsType(sqlType: string, enumRef: (key: string) => string | undefined): string {
  let base = sqlType.trim();
  let arrayDepth = 0;
  while (base.endsWith("[]")) {
    base = base.slice(0, -2).trim();
    arrayDepth += 1;
  }
  const parenStart = base.indexOf("(");
  if (parenStart !== -1) {
    base = base.slice(0, parenStart).trim();
  }
  const lowered = base.toLowerCase();
  let mapped: string;
  if (numberTypes.has(lowered)) {
    mapped = "number";
  } else if (stringTypes.has(lowered)) {
    mapped = "string";
  } else if (lowered === "boolean" || lowered === "bool") {
    mapped = "boolean";
  } else if (lowered === "json" || lowered === "jsonb") {
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

function quoteKey(name: string): string {
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
