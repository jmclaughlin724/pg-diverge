export interface SchemaContractColumn {
  default?: unknown;
  generated?: unknown;
  identity?: string;
  name: string;
  notNull: boolean;
  type: string;
}

export interface SchemaContractEnum {
  name: string;
  values: string[];
}

export interface SchemaContractRelationship {
  columns: string[];
  foreignKeyName: string;
  isOneToOne: boolean;
  referencedColumns: string[];
  referencedRelation: string;
  referencedSchema: string;
}

export interface SchemaContractTable {
  columns: SchemaContractColumn[];
  name: string;
  primaryKey?: string[];
  relationships: SchemaContractRelationship[];
  uniqueColumnSets: string[][];
}

export interface SchemaContract {
  schemas: Record<string, { enums: SchemaContractEnum[]; tables: SchemaContractTable[] }>;
}

export function isSchemaContract(value: unknown): value is SchemaContract {
  const root = asObject(value);
  if (root === null || Object.keys(root).length !== 1) {
    return false;
  }
  const schemas = asObject(property(root, "schemas"));
  return schemas !== null && Object.values(schemas).every(isSchemaContractEntry);
}

function asObject(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isSchemaContractEntry(value: unknown): boolean {
  const entry = asObject(value);
  const enums = entry === null ? undefined : property(entry, "enums");
  const tables = entry === null ? undefined : property(entry, "tables");
  return (
    entry !== null &&
    Object.keys(entry).length === 2 &&
    Array.isArray(enums) &&
    Array.isArray(tables) &&
    enums.every(isSchemaContractEnum) &&
    tables.every(isSchemaContractTable)
  );
}

function isSchemaContractEnum(value: unknown): boolean {
  const entry = asObject(value);
  const name = entry === null ? undefined : property(entry, "name");
  const values = entry === null ? undefined : property(entry, "values");
  return (
    entry !== null &&
    Object.keys(entry).length === 2 &&
    typeof name === "string" &&
    Array.isArray(values) &&
    values.every((item) => typeof item === "string")
  );
}

function isSchemaContractTable(value: unknown): boolean {
  const entry = asObject(value);
  const name = entry === null ? undefined : property(entry, "name");
  const columns = entry === null ? undefined : property(entry, "columns");
  const primaryKey = entry === null ? undefined : property(entry, "primaryKey");
  const relationships = entry === null ? undefined : property(entry, "relationships");
  const uniqueColumnSets = entry === null ? undefined : property(entry, "uniqueColumnSets");
  return (
    entry !== null &&
    typeof name === "string" &&
    Array.isArray(columns) &&
    columns.every(isSchemaContractColumn) &&
    (primaryKey === undefined || isStringArray(primaryKey)) &&
    Array.isArray(relationships) &&
    relationships.every(isSchemaContractRelationship) &&
    Array.isArray(uniqueColumnSets) &&
    uniqueColumnSets.every(isStringArray)
  );
}

function isSchemaContractColumn(value: unknown): boolean {
  const entry = asObject(value);
  const identity = entry === null ? undefined : property(entry, "identity");
  return (
    entry !== null &&
    typeof property(entry, "name") === "string" &&
    typeof property(entry, "notNull") === "boolean" &&
    typeof property(entry, "type") === "string" &&
    (identity === undefined || typeof identity === "string")
  );
}

function isSchemaContractRelationship(value: unknown): boolean {
  const entry = asObject(value);
  return (
    entry !== null &&
    isStringArray(property(entry, "columns")) &&
    typeof property(entry, "foreignKeyName") === "string" &&
    typeof property(entry, "isOneToOne") === "boolean" &&
    isStringArray(property(entry, "referencedColumns")) &&
    typeof property(entry, "referencedRelation") === "string" &&
    typeof property(entry, "referencedSchema") === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
