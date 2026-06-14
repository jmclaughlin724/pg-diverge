import type { SchemaModel, SchemaObject } from "./core.js";
import { asRecord, readArray, readString, stringList, typeNameToSql } from "./sql/ast.js";
import { parseSqlAst } from "./sql/parser.js";
import { canonicalColumnType, canonicalTableShape } from "./sql/table-shape.js";
import { collectViewColumns } from "./typegen-views.js";

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
  isOneToOne: boolean;
  referencedColumns: string[];
  referencedRelation: string;
  referencedSchema: string;
}

export interface FunctionShape {
  args: { name: string; optional: boolean; type: string }[];
  name: string;
  returns: { columns?: { name: string; type: string }[]; setof: boolean; type: string } | undefined;
}

export interface TableShape {
  columns: ColumnShape[];
  name: string;
  primaryKey?: string[];
  relationships: RelationshipShape[];
  uniqueColumnSets: string[][];
}

export interface SchemaEntry {
  composites: { columns: ColumnShape[]; name: string }[];
  enums: { name: string; values: string[] }[];
  functions: FunctionShape[];
  tables: TableShape[];
  views: { columns: { name: string; type: string }[]; name: string }[];
}

export interface SchemaShapes {
  compositesByBareName: Map<string, { name: string; schema: string }[]>;
  compositesByQualifiedName: Map<string, { name: string; schema: string }>;
  domains: Map<string, string>;
  enumsByBareName: Map<string, { name: string; schema: string }[]>;
  enumsByQualifiedName: Map<string, { name: string; schema: string }>;
  schemas: Map<string, SchemaEntry>;
}

export interface ResolvedColumnType {
  arrayDepth: number;
  compositeRef?: { name: string; schema: string };
  enumRef?: { name: string; schema: string };
  kind: "boolean" | "composite" | "enum" | "json" | "number" | "string" | "unknown";
}

export async function collectSchemaShapes(model: SchemaModel): Promise<SchemaShapes> {
  const shapes: SchemaShapes = {
    compositesByBareName: new Map(),
    compositesByQualifiedName: new Map(),
    domains: new Map(),
    enumsByBareName: new Map(),
    enumsByQualifiedName: new Map(),
    schemas: new Map(),
  };
  const schemaOf = (object: SchemaObject) => schemaEntry(shapes, object.ref.schema ?? "public");

  for (const object of model.objects) {
    if (object.ref.kind === "enum") {
      const schema = object.ref.schema ?? "public";
      const entry = { name: object.ref.name, schema };
      shapes.enumsByQualifiedName.set(`${schema}.${object.ref.name}`, entry);
      const bare = shapes.enumsByBareName.get(object.ref.name) ?? [];
      bare.push(entry);
      shapes.enumsByBareName.set(object.ref.name, bare);
      const values = Array.isArray(object.metadata.values)
        ? object.metadata.values.map((value) => String(value))
        : [];
      schemaOf(object).enums.push({ name: object.ref.name, values });
    } else if (object.ref.kind === "domain") {
      const base = await domainBaseType(object);
      if (base !== undefined) {
        shapes.domains.set(`${object.ref.schema ?? "public"}.${object.ref.name}`, base);
      }
    }
  }

  const tablesByKey = new Map<string, TableShape>();
  for (const object of model.objects) {
    if (object.ref.kind === "table" || object.ref.kind === "foreign-table") {
      const columns =
        object.ref.kind === "table" ? tableColumns(object) : await foreignTableColumns(object);
      const table: TableShape = {
        columns,
        name: object.ref.name,
        relationships: [],
        uniqueColumnSets: [],
      };
      tablesByKey.set(`${object.ref.schema ?? "public"}.${object.ref.name}`, table);
      schemaOf(object).tables.push(table);
    } else if (object.ref.kind === "function") {
      const shape = await functionShape(object);
      if (shape) {
        schemaOf(object).functions.push(shape);
      }
    }
  }

  for (const object of model.objects) {
    if (object.ref.kind === "constraint") {
      await applyConstraint(object, tablesByKey);
    }
  }
  resolveRelationshipTargets(tablesByKey);

  for (const object of model.objects) {
    if (object.ref.kind === "view" || object.ref.kind === "materialized-view") {
      schemaOf(object).views.push({
        columns: await collectViewColumns(object, tablesByKey),
        name: object.ref.name,
      });
    } else if (object.ref.kind === "type") {
      // CompositeTypeStmt and CreateRangeStmt both extract to kind "type".
      // Only composites have a column list; range types must not emit an
      // (empty) CompositeTypes entry or get registered as a resolvable type.
      const columns = await compositeColumns(object);
      if (columns === undefined) {
        continue;
      }
      const schema = object.ref.schema ?? "public";
      const name = object.ref.name;
      schemaOf(object).composites.push({ columns, name });
      const entry = { name, schema };
      shapes.compositesByQualifiedName.set(`${schema}.${name}`, entry);
      const bare = shapes.compositesByBareName.get(name) ?? [];
      bare.push(entry);
      shapes.compositesByBareName.set(name, bare);
    }
  }

  return shapes;
}

export function resolveColumnType(
  shapes: SchemaShapes,
  schemaName: string,
  sqlType: string,
): ResolvedColumnType {
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
  for (let hops = 0; hops < 8; hops += 1) {
    const domainBase =
      shapes.domains.get(base.includes(".") ? base : `${schemaName}.${base}`) ??
      shapes.domains.get(base);
    if (domainBase === undefined) {
      break;
    }
    base = domainBase;
    const innerParen = base.indexOf("(");
    if (innerParen !== -1) {
      base = base.slice(0, innerParen).trim();
    }
    while (base.endsWith("[]")) {
      base = base.slice(0, -2).trim();
      arrayDepth += 1;
    }
  }
  const lowered = base.toLowerCase();
  if (numberTypes.has(lowered)) {
    return { arrayDepth, kind: "number" };
  }
  if (stringTypes.has(lowered)) {
    return { arrayDepth, kind: "string" };
  }
  if (lowered === "boolean" || lowered === "bool") {
    return { arrayDepth, kind: "boolean" };
  }
  if (lowered === "json" || lowered === "jsonb") {
    return { arrayDepth, kind: "json" };
  }
  const userType = resolveUserType(shapes, schemaName, base);
  if (userType?.kind === "enum") {
    return { arrayDepth, enumRef: userType.ref, kind: "enum" };
  }
  if (userType?.kind === "composite") {
    return { arrayDepth, compositeRef: userType.ref, kind: "composite" };
  }
  return { arrayDepth, kind: "unknown" };
}

// Resolve a user-defined type name to a single enum or composite. A schema-local
// match (qualified by the current schema) wins across all kinds before falling
// back to a globally unique bare name — so a local composite is not shadowed by
// a same-named enum in another schema, and vice versa.
function resolveUserType(
  shapes: SchemaShapes,
  schemaName: string,
  base: string,
): { kind: "composite" | "enum"; ref: { name: string; schema: string } } | undefined {
  if (base.includes(".")) {
    const qualifiedEnum = shapes.enumsByQualifiedName.get(base);
    if (qualifiedEnum) {
      return { kind: "enum", ref: qualifiedEnum };
    }
    const qualifiedComposite = shapes.compositesByQualifiedName.get(base);
    return qualifiedComposite ? { kind: "composite", ref: qualifiedComposite } : undefined;
  }
  const localEnum = shapes.enumsByQualifiedName.get(`${schemaName}.${base}`);
  if (localEnum) {
    return { kind: "enum", ref: localEnum };
  }
  const localComposite = shapes.compositesByQualifiedName.get(`${schemaName}.${base}`);
  if (localComposite) {
    return { kind: "composite", ref: localComposite };
  }
  const enumCandidate =
    shapes.enumsByBareName.get(base)?.length === 1
      ? shapes.enumsByBareName.get(base)?.[0]
      : undefined;
  if (enumCandidate) {
    return { kind: "enum", ref: enumCandidate };
  }
  const compositeCandidate =
    shapes.compositesByBareName.get(base)?.length === 1
      ? shapes.compositesByBareName.get(base)?.[0]
      : undefined;
  if (compositeCandidate) {
    return { kind: "composite", ref: compositeCandidate };
  }
  return undefined;
}

function schemaEntry(shapes: SchemaShapes, name: string): SchemaEntry {
  let entry = shapes.schemas.get(name);
  if (!entry) {
    entry = { composites: [], enums: [], functions: [], tables: [], views: [] };
    shapes.schemas.set(name, entry);
  }
  return entry;
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

async function foreignTableColumns(object: SchemaObject): Promise<ColumnShape[]> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const stmt = asRecord(asRecord(statements[0])?.stmt);
  const base = asRecord(asRecord(stmt?.CreateForeignTableStmt)?.base);
  if (!base) {
    return [];
  }
  const shape = canonicalTableShape(base);
  return readArray(shape.columns).flatMap((item) => {
    const column = asRecord(item);
    const name = readString(column?.name);
    const type = readString(column?.type);
    return column && name && type ? [{ name, notNull: column.notNull === true, type }] : [];
  });
}

async function compositeColumns(object: SchemaObject): Promise<ColumnShape[] | undefined> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const composite = asRecord(asRecord(asRecord(statements[0])?.stmt)?.CompositeTypeStmt);
  if (!composite) {
    // Not a composite (e.g. CREATE TYPE ... AS RANGE / AS ENUM handled elsewhere).
    return undefined;
  }
  return readArray(composite?.coldeflist).flatMap((item) => {
    const columnDef = asRecord(asRecord(item)?.ColumnDef);
    const name = readString(columnDef?.colname);
    if (!(columnDef && name)) {
      return [];
    }
    return [{ name, notNull: false, type: canonicalColumnType(columnDef.typeName) }];
  });
}

async function domainBaseType(object: SchemaObject): Promise<string | undefined> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const domain = asRecord(asRecord(asRecord(statements[0])?.stmt)?.CreateDomainStmt);
  return domain ? canonicalColumnType(domain.typeName) : undefined;
}

async function functionShape(object: SchemaObject): Promise<FunctionShape | undefined> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const fn = asRecord(asRecord(asRecord(statements[0])?.stmt)?.CreateFunctionStmt);
  if (!fn) {
    return undefined;
  }
  const args: FunctionShape["args"] = [];
  const returnColumns: { name: string; type: string }[] = [];
  let hasTableParam = false;
  for (const item of readArray(fn.parameters)) {
    const parameter = asRecord(asRecord(item)?.FunctionParameter);
    if (!parameter) {
      continue;
    }
    const mode = readString(parameter.mode) ?? "FUNC_PARAM_DEFAULT";
    // OUT/INOUT/TABLE params define the returned row shape; TABLE additionally
    // means the function is set-returning.
    if (mode === "FUNC_PARAM_OUT" || mode === "FUNC_PARAM_INOUT" || mode === "FUNC_PARAM_TABLE") {
      const columnName = readString(parameter.name);
      if (columnName) {
        returnColumns.push({ name: columnName, type: typeNameToSql(parameter.argType) });
      }
      if (mode === "FUNC_PARAM_TABLE") {
        hasTableParam = true;
      }
    }
    if (mode !== "FUNC_PARAM_DEFAULT" && mode !== "FUNC_PARAM_IN" && mode !== "FUNC_PARAM_INOUT") {
      continue;
    }
    const name = readString(parameter.name);
    if (!name) {
      return undefined;
    }
    args.push({
      name,
      optional: parameter.defexpr !== undefined,
      type: typeNameToSql(parameter.argType),
    });
  }
  const returns = asRecord(object.metadata.returns);
  const scalarType = typeof returns?.type === "string" ? returns.type : undefined;
  const setof = returns?.setof === true || hasTableParam;
  if (returnColumns.length > 0) {
    // OUT/INOUT/TABLE params define the row; an OUT-only function reports no
    // explicit RETURNS type, so default to "record".
    return {
      args,
      name: object.ref.name,
      returns: { columns: returnColumns, setof, type: scalarType ?? "record" },
    };
  }
  return {
    args,
    name: object.ref.name,
    returns: scalarType !== undefined ? { setof, type: scalarType } : undefined,
  };
}

async function applyConstraint(
  object: SchemaObject,
  tablesByKey: Map<string, TableShape>,
): Promise<void> {
  const parsed = await parseSqlAst(object.sql, object.file);
  const statements = readArray(asRecord(parsed.ast)?.stmts);
  const alter = asRecord(asRecord(asRecord(statements[0])?.stmt)?.AlterTableStmt);
  const schemaName = object.ref.schema ?? "public";
  const table = tablesByKey.get(`${schemaName}.${object.ref.table ?? ""}`);
  if (!table) {
    return;
  }
  for (const command of readArray(alter?.cmds)) {
    const constraint = asRecord(
      asRecord(asRecord(asRecord(command)?.AlterTableCmd)?.def)?.Constraint,
    );
    const contype = readString(constraint?.contype);
    if (!constraint || !contype) {
      continue;
    }
    if (contype === "CONSTR_PRIMARY") {
      const keys = stringList(constraint.keys);
      for (const column of table.columns) {
        if (keys.includes(column.name)) {
          column.notNull = true;
        }
      }
      table.primaryKey = keys;
      table.uniqueColumnSets.push(keys);
    } else if (contype === "CONSTR_UNIQUE") {
      table.uniqueColumnSets.push(stringList(constraint.keys));
    } else if (contype === "CONSTR_FOREIGN") {
      const pkTable = asRecord(constraint.pktable);
      if (!pkTable) {
        continue;
      }
      table.relationships.push({
        columns: stringList(constraint.fk_attrs),
        foreignKeyName: readString(constraint.conname) ?? object.ref.name,
        isOneToOne: false,
        referencedColumns: stringList(constraint.pk_attrs),
        referencedRelation: readString(pkTable.relname) ?? "",
        referencedSchema: readString(pkTable.schemaname) ?? schemaName,
      });
    }
  }
}

function resolveRelationshipTargets(tablesByKey: Map<string, TableShape>): void {
  const primaryKeys = new Map<string, string[]>();
  for (const [key, table] of tablesByKey) {
    if (table.primaryKey) {
      primaryKeys.set(key, table.primaryKey);
    }
  }
  for (const table of tablesByKey.values()) {
    for (const relationship of table.relationships) {
      if (relationship.referencedColumns.length === 0) {
        const target = primaryKeys.get(
          `${relationship.referencedSchema}.${relationship.referencedRelation}`,
        );
        if (target) {
          relationship.referencedColumns = [...target];
        }
      }
      relationship.isOneToOne = table.uniqueColumnSets.some(
        (set) =>
          set.length === relationship.columns.length &&
          relationship.columns.every((column) => set.includes(column)),
      );
    }
  }
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
  '"char"',
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
