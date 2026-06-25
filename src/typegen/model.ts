import type { SchemaModel, SchemaObject } from "../core.js";
import type { AstNode } from "../sql/ast.js";
import { asRecord, readArray, readString, stringList, typeNameToSql } from "../sql/ast.js";
import { parseSqlAst } from "../sql/parser.js";
import { canonicalColumnType, canonicalTableShape } from "../sql/table-shape.js";
import { collectViewColumns, type FunctionShapesByKey } from "./views.js";

export interface ColumnShape {
  default?: unknown;
  generated?: unknown;
  identity?: string;
  name: string;
  notNull: boolean;
  type: string;
}

export function sortedByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

export function isNonWritableColumn(column: ColumnShape): boolean {
  return column.generated !== undefined || column.identity === "a";
}

export function isOptionalInsertColumn(column: ColumnShape): boolean {
  return !column.notNull || column.default !== undefined || column.identity !== undefined;
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
  views: { columns: ColumnShape[]; name: string }[];
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
  kind:
    | "boolean"
    | "composite"
    | "enum"
    | "json"
    | "number"
    | "relation"
    | "string"
    | "unknown"
    | "void";
  relationRef?: { collection: "Tables" | "Views"; name: string; schema: string };
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
  await collectEnumAndDomainShapes(model, shapes);
  const relationsByKey = new Map<string, TableShape>();
  await collectRelationAndFunctionShapes(model, shapes, relationsByKey);
  await applyModelConstraints(model, relationsByKey);
  resolveRelationshipTargets(relationsByKey);
  await collectViewAndCompositeShapes(model, shapes, relationsByKey, functionShapesByKey(shapes));
  return shapes;
}

async function collectEnumAndDomainShapes(model: SchemaModel, shapes: SchemaShapes): Promise<void> {
  for (const object of model.objects) {
    if (object.ref.kind === "enum") {
      registerEnumShape(shapes, object);
      continue;
    }
    if (object.ref.kind === "domain") {
      const base = await domainBaseType(object);
      if (base !== undefined) {
        shapes.domains.set(`${object.ref.schema ?? "public"}.${object.ref.name}`, base);
      }
    }
  }
}

function registerEnumShape(shapes: SchemaShapes, object: SchemaObject): void {
  const schema = object.ref.schema ?? "public";
  const entry = { name: object.ref.name, schema };
  shapes.enumsByQualifiedName.set(`${schema}.${object.ref.name}`, entry);
  const bare = shapes.enumsByBareName.get(object.ref.name) ?? [];
  bare.push(entry);
  shapes.enumsByBareName.set(object.ref.name, bare);
  const values = Array.isArray(object.metadata.values)
    ? object.metadata.values.map((value) => String(value))
    : [];
  schemaEntry(shapes, schema).enums.push({ name: object.ref.name, values });
}

async function collectRelationAndFunctionShapes(
  model: SchemaModel,
  shapes: SchemaShapes,
  tablesByKey: Map<string, TableShape>
): Promise<void> {
  for (const object of model.objects) {
    if (object.ref.kind === "table" || object.ref.kind === "foreign-table") {
      await registerTableShape(shapes, tablesByKey, object);
      continue;
    }
    if (object.ref.kind === "function") {
      const shape = await functionShape(object);
      if (shape) {
        schemaEntry(shapes, object.ref.schema ?? "public").functions.push(shape);
      }
    }
  }
}

async function registerTableShape(
  shapes: SchemaShapes,
  tablesByKey: Map<string, TableShape>,
  object: SchemaObject
): Promise<void> {
  const columns =
    object.ref.kind === "table" ? tableColumns(object) : await foreignTableColumns(object);
  const table: TableShape = {
    columns,
    name: object.ref.name,
    relationships: [],
    uniqueColumnSets: [],
  };
  const schema = object.ref.schema ?? "public";
  tablesByKey.set(`${schema}.${object.ref.name}`, table);
  schemaEntry(shapes, schema).tables.push(table);
}

async function applyModelConstraints(
  model: SchemaModel,
  tablesByKey: Map<string, TableShape>
): Promise<void> {
  for (const object of model.objects) {
    if (object.ref.kind === "constraint") {
      await applyConstraint(object, tablesByKey);
    }
  }
}

async function collectViewAndCompositeShapes(
  model: SchemaModel,
  shapes: SchemaShapes,
  relationsByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey
): Promise<void> {
  const views: SchemaObject[] = [];
  const composites: SchemaObject[] = [];
  for (const object of model.objects) {
    if (object.ref.kind === "view" || object.ref.kind === "materialized-view") {
      views.push(object);
      continue;
    }
    if (object.ref.kind === "type") {
      composites.push(object);
    }
  }
  for (const object of composites) {
    await registerCompositeShape(shapes, object);
  }
  await registerViewShapes(shapes, relationsByKey, functionsByKey, views);
}

async function registerViewShapes(
  shapes: SchemaShapes,
  relationsByKey: Map<string, TableShape>,
  functionsByKey: FunctionShapesByKey,
  objects: SchemaObject[]
): Promise<void> {
  const columnsByKey = new Map<string, ColumnShape[]>();
  for (let pass = 0; pass <= objects.length; pass += 1) {
    let changed = false;
    for (const object of objects) {
      const key = relationKey(object);
      const columns = await collectViewColumns(object, relationsByKey, functionsByKey);
      if (!sameColumns(columnsByKey.get(key), columns)) {
        columnsByKey.set(key, columns);
        relationsByKey.set(key, relationShape(object.ref.name, columns));
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  for (const object of objects) {
    schemaEntry(shapes, object.ref.schema ?? "public").views.push({
      columns: columnsByKey.get(relationKey(object)) ?? [],
      name: object.ref.name,
    });
  }
}

function relationKey(object: SchemaObject): string {
  return `${object.ref.schema ?? "public"}.${object.ref.name}`;
}

function relationShape(name: string, columns: ColumnShape[]): TableShape {
  return {
    columns,
    name,
    relationships: [],
    uniqueColumnSets: [],
  };
}

function sameColumns(left: ColumnShape[] | undefined, right: ColumnShape[]): boolean {
  if (left === undefined || left.length !== right.length) {
    return false;
  }
  return left.every((column, index) => {
    const other = right[index];
    return other !== undefined && column.name === other.name && column.type === other.type;
  });
}

function functionShapesByKey(shapes: SchemaShapes): FunctionShapesByKey {
  const byKey: FunctionShapesByKey = new Map();
  for (const [schemaName, entry] of shapes.schemas) {
    for (const fn of entry.functions) {
      const key = `${schemaName}.${fn.name}`;
      const functions = byKey.get(key) ?? [];
      functions.push(fn);
      byKey.set(key, functions);
    }
  }
  return byKey;
}

async function registerCompositeShape(shapes: SchemaShapes, object: SchemaObject): Promise<void> {
  const columns = await compositeColumns(object);
  if (columns === undefined) {
    return;
  }
  const schema = object.ref.schema ?? "public";
  const name = object.ref.name;
  schemaEntry(shapes, schema).composites.push({ columns, name });
  const entry = { name, schema };
  shapes.compositesByQualifiedName.set(`${schema}.${name}`, entry);
  const bare = shapes.compositesByBareName.get(name) ?? [];
  bare.push(entry);
  shapes.compositesByBareName.set(name, bare);
}

export function resolveColumnType(
  shapes: SchemaShapes,
  schemaName: string,
  sqlType: string
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
  const scalar = resolveScalarType(base, arrayDepth);
  if (scalar) {
    return scalar;
  }
  const userType = resolveUserType(shapes, schemaName, base);
  if (userType?.kind === "enum") {
    return { arrayDepth, enumRef: userType.ref, kind: "enum" };
  }
  if (userType?.kind === "composite") {
    return { arrayDepth, compositeRef: userType.ref, kind: "composite" };
  }
  const relationType = resolveRelationType(shapes, schemaName, base);
  if (relationType) {
    return { arrayDepth, kind: "relation", relationRef: relationType };
  }
  const unqualifiedScalar = resolveScalarType(unqualifiedTypeName(base), arrayDepth);
  if (unqualifiedScalar) {
    return unqualifiedScalar;
  }
  return { arrayDepth, kind: "unknown" };
}

function resolveScalarType(base: string, arrayDepth: number): ResolvedColumnType | undefined {
  const lowered = base.toLowerCase();
  if (numberTypes.has(lowered)) {
    return { arrayDepth, kind: "number" };
  }
  if (vectorTypes.has(lowered)) {
    return { arrayDepth: arrayDepth + 1, kind: "number" };
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
  if (lowered === "void") {
    return { arrayDepth, kind: "void" };
  }
}

function unqualifiedTypeName(base: string): string {
  return base.includes(".") ? (base.split(".").at(-1) ?? base) : base;
}

function resolveUserType(
  shapes: SchemaShapes,
  schemaName: string,
  base: string
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

  const enumMatches = shapes.enumsByBareName.get(base) ?? [];
  const compositeMatches = shapes.compositesByBareName.get(base) ?? [];
  if (enumMatches.length + compositeMatches.length !== 1) {
    return;
  }
  const enumMatch = enumMatches[0];
  if (enumMatch) {
    return { kind: "enum", ref: enumMatch };
  }
  const compositeMatch = compositeMatches[0];
  return compositeMatch ? { kind: "composite", ref: compositeMatch } : undefined;
}

function resolveRelationType(
  shapes: SchemaShapes,
  schemaName: string,
  base: string
): { collection: "Tables" | "Views"; name: string; schema: string } | undefined {
  if (base.includes(".")) {
    const [schema, ...rest] = base.split(".");
    const name = rest.join(".");
    return schema && name ? relationTypeInSchema(shapes, schema, name) : undefined;
  }
  const localRelation = relationTypeInSchema(shapes, schemaName, base);
  if (localRelation) {
    return localRelation;
  }

  const matches: { collection: "Tables" | "Views"; name: string; schema: string }[] = [];
  for (const [schema, entry] of shapes.schemas) {
    const relation = relationTypeInEntry(entry, schema, base);
    if (relation) {
      matches.push(relation);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function relationTypeInSchema(
  shapes: SchemaShapes,
  schema: string,
  name: string
): { collection: "Tables" | "Views"; name: string; schema: string } | undefined {
  const entry = shapes.schemas.get(schema);
  return entry ? relationTypeInEntry(entry, schema, name) : undefined;
}

function relationTypeInEntry(
  entry: SchemaEntry,
  schema: string,
  name: string
): { collection: "Tables" | "Views"; name: string; schema: string } | undefined {
  if (entry.tables.some((table) => table.name === name)) {
    return { collection: "Tables", name, schema };
  }
  if (entry.views.some((view) => view.name === name)) {
    return { collection: "Views", name, schema };
  }
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
        ...(column.default === undefined ? {} : { default: column.default }),
        ...(column.generated === undefined ? {} : { generated: column.generated }),
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
    return;
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
    return;
  }
  const args: FunctionShape["args"] = [];
  const returnColumns: { name: string; type: string }[] = [];
  let hasTableParam = false;
  for (const item of readArray(fn.parameters)) {
    const parameter = asRecord(asRecord(item)?.FunctionParameter);
    const result = applyFunctionParameter(parameter, args, returnColumns);
    if (result === "skip") {
      continue;
    }
    if (result === "abort") {
      return;
    }
    hasTableParam ||= result === "table";
  }
  const returns = asRecord(object.metadata.returns);
  const scalarType = typeof returns?.type === "string" ? returns.type : undefined;
  const setof = returns?.setof === true || hasTableParam;

  const isRowShape = hasTableParam || returnColumns.length > 1;
  if (returnColumns.length > 0 && isRowShape) {
    return {
      args,
      name: object.ref.name,
      returns: { columns: returnColumns, setof, type: scalarType ?? "record" },
    };
  }
  const singleOut = !hasTableParam && returnColumns.length === 1 ? returnColumns[0] : undefined;
  const effectiveType = singleOut?.type ?? scalarType;
  return {
    args,
    name: object.ref.name,
    returns: effectiveType === undefined ? undefined : { setof, type: effectiveType },
  };
}

type FunctionParameterResult = "abort" | "skip" | "table" | "value";

function applyFunctionParameter(
  parameter: AstNode | undefined,
  args: FunctionShape["args"],
  returnColumns: { name: string; type: string }[]
): FunctionParameterResult {
  if (!parameter) {
    return "skip";
  }
  const mode = readString(parameter.mode) ?? "FUNC_PARAM_DEFAULT";
  recordReturnParameter(parameter, mode, returnColumns);
  if (!isInputParameter(mode)) {
    return mode === "FUNC_PARAM_TABLE" ? "table" : "skip";
  }
  const name = readString(parameter.name);
  if (!name) {
    return "abort";
  }
  args.push({
    name,
    optional: parameter.defexpr !== undefined,
    type: typeNameToSql(parameter.argType),
  });
  return mode === "FUNC_PARAM_TABLE" ? "table" : "value";
}

function recordReturnParameter(
  parameter: AstNode,
  mode: string,
  returnColumns: { name: string; type: string }[]
): void {
  if (!isOutputParameter(mode)) {
    return;
  }
  const columnName = readString(parameter.name);
  if (columnName) {
    returnColumns.push({ name: columnName, type: typeNameToSql(parameter.argType) });
  }
}

function isOutputParameter(mode: string): boolean {
  return mode === "FUNC_PARAM_OUT" || mode === "FUNC_PARAM_INOUT" || mode === "FUNC_PARAM_TABLE";
}

function isInputParameter(mode: string): boolean {
  return mode === "FUNC_PARAM_DEFAULT" || mode === "FUNC_PARAM_IN" || mode === "FUNC_PARAM_INOUT";
}

async function applyConstraint(
  object: SchemaObject,
  tablesByKey: Map<string, TableShape>
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
    applyConstraintCommand(command, table, object, schemaName);
  }
}

function applyConstraintCommand(
  command: unknown,
  table: TableShape,
  object: SchemaObject,
  schemaName: string
): void {
  const constraint = asRecord(
    asRecord(asRecord(asRecord(command)?.AlterTableCmd)?.def)?.Constraint
  );
  const contype = readString(constraint?.contype);
  if (!(constraint && contype)) {
    return;
  }
  if (contype === "CONSTR_PRIMARY") {
    applyPrimaryKeyConstraint(table, constraint);
    return;
  }
  if (contype === "CONSTR_UNIQUE") {
    table.uniqueColumnSets.push(stringList(constraint.keys));
    return;
  }
  if (contype === "CONSTR_FOREIGN") {
    applyForeignKeyConstraint(table, constraint, object, schemaName);
  }
}

function applyPrimaryKeyConstraint(table: TableShape, constraint: AstNode): void {
  const keys = stringList(constraint.keys);
  for (const column of table.columns) {
    if (keys.includes(column.name)) {
      column.notNull = true;
    }
  }
  table.primaryKey = keys;
  table.uniqueColumnSets.push(keys);
}

function applyForeignKeyConstraint(
  table: TableShape,
  constraint: AstNode,
  object: SchemaObject,
  schemaName: string
): void {
  const pkTable = asRecord(constraint.pktable);
  if (!pkTable) {
    return;
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
          `${relationship.referencedSchema}.${relationship.referencedRelation}`
        );
        if (target) {
          relationship.referencedColumns = [...target];
        }
      }
      relationship.isOneToOne = table.uniqueColumnSets.some(
        (set) =>
          set.length === relationship.columns.length &&
          relationship.columns.every((column) => set.includes(column))
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

const vectorTypes = new Set(["vector", "halfvec"]);

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
