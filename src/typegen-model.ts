import type { SchemaModel, SchemaObject } from "./core.js";
import { asRecord, readArray, readString, stringList } from "./sql/ast.js";
import { parseSqlAst } from "./sql/parser.js";
import { canonicalColumnType } from "./sql/table-shape.js";

export interface ColumnShape {
  default?: unknown;
  generated?: unknown;
  identity?: string;
  name: string;
  notNull: boolean;
  type: string;
}

export interface RelationshipShape {
  columns: string[];
  foreignKeyName: string;
  referencedColumns: string[];
  referencedRelation: string;
}

export interface SchemaEntry {
  composites: { columns: ColumnShape[]; name: string }[];
  enums: { name: string; values: string[] }[];
  tables: { columns: ColumnShape[]; name: string; relationships: RelationshipShape[] }[];
  views: { columns: { name: string; type: string }[]; name: string }[];
}

export interface SchemaShapes {
  enumKeys: Map<string, { name: string; schema: string }>;
  schemas: Map<string, SchemaEntry>;
}

export async function collectSchemaShapes(model: SchemaModel): Promise<SchemaShapes> {
  const schemas = new Map<string, SchemaEntry>();
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

  return { enumKeys, schemas };
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

export function scalarTypeCategory(sqlType: string): {
  arrayDepth: number;
  base: string;
  category: "boolean" | "json" | "number" | "other" | "string";
} {
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
  if (numberTypes.has(lowered)) {
    return { arrayDepth, base, category: "number" };
  }
  if (stringTypes.has(lowered)) {
    return { arrayDepth, base, category: "string" };
  }
  if (lowered === "boolean" || lowered === "bool") {
    return { arrayDepth, base, category: "boolean" };
  }
  if (lowered === "json" || lowered === "jsonb") {
    return { arrayDepth, base, category: "json" };
  }
  return { arrayDepth, base, category: "other" };
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
