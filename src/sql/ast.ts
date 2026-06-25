export type AstNode = Record<string, unknown>;

export interface QualifiedName {
  name: string;
  schema: string;
}

export interface AstStatement {
  byteStart: number;
  node: AstNode;
  tag: string;
  text: string;
}

export function asRecord(value: unknown): AstNode | undefined {
  if (!value || typeof value !== "object") {
    return;
  }
  return Object.fromEntries(Object.entries(value));
}

export function astNodeKind(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const keys = Object.keys(record);
  return keys.length === 1 ? keys[0] : undefined;
}

export function astNodeOf(value: unknown, kind: string): AstNode | undefined {
  return asRecord(asRecord(value)?.[kind]);
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readBoolean(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  const booleanNode = asRecord(asRecord(value)?.Boolean);
  return booleanNode?.boolval === true;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return readString(asRecord(asRecord(value)?.String)?.sval);
}

export function listItems(value: unknown): unknown[] {
  const direct = readArray(value);
  if (direct.length > 0) {
    return direct;
  }
  return readArray(asRecord(asRecord(value)?.List)?.items);
}

export function stringList(value: unknown): string[] {
  return listItems(value)
    .map((item) => stringValue(item))
    .filter((item): item is string => item !== undefined);
}

export function astStatements(ast: unknown, sql: string): AstStatement[] {
  const statements: AstStatement[] = [];

  const bytes = Buffer.from(sql, "utf8");
  for (const raw of readArray(asRecord(ast)?.stmts)) {
    const record = asRecord(raw);
    const node = asRecord(record?.stmt);
    if (!node) {
      continue;
    }
    const tag = Object.keys(node)[0] ?? "";
    const location = readNumber(record?.stmt_location) ?? 0;
    const length = readNumber(record?.stmt_len);
    const end = length === undefined ? bytes.length : location + length;
    let byteStart = location;
    while (byteStart < end && asciiWhitespace.has(bytes[byteStart] ?? -1)) {
      byteStart += 1;
    }
    statements.push({
      byteStart,
      node,
      tag,
      text: bytes.subarray(byteStart, end).toString("utf8").trimEnd(),
    });
  }
  return statements;
}

const asciiWhitespace = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x0b]);

export function rangeVarName(value: unknown): QualifiedName | undefined {
  const relation = asRecord(asRecord(value)?.RangeVar) ?? asRecord(value);
  const relname = readString(relation?.relname);
  if (!relname) {
    return;
  }
  return {
    name: relname,
    schema: readString(relation?.schemaname) ?? "public",
  };
}

export function qualifiedName(value: unknown): QualifiedName | undefined {
  const parts = stringList(value);
  if (parts.length === 0) {
    return;
  }
  if (parts.length === 1) {
    return { name: parts[0] ?? "", schema: "public" };
  }
  return {
    name: parts.at(-1) ?? "",
    schema: parts.at(-2) ?? "public",
  };
}

const internalTypeNames = new Map([
  ["bool", "boolean"],
  ["bpchar", "character"],

  ["char", '"char"'],
  ["float4", "real"],
  ["float8", "double precision"],
  ["int2", "smallint"],
  ["int4", "integer"],
  ["int8", "bigint"],
  ["time", "time without time zone"],
  ["varbit", "bit varying"],
  ["timestamp", "timestamp without time zone"],
  ["timestamptz", "timestamp with time zone"],
  ["timetz", "time with time zone"],
  ["varchar", "character varying"],
]);

export function typeNameToSql(value: unknown): string {
  const typeName = asRecord(asRecord(value)?.TypeName) ?? asRecord(value);
  const names = stringList(typeName?.names).filter((name) => name !== "pg_catalog");
  const base = names.map((name) => internalTypeNames.get(name) ?? name).join(".");
  const arraySuffix = "[]".repeat(readArray(typeName?.arrayBounds).length);
  return `${base}${arraySuffix}`;
}

export function roleSpecName(value: unknown): string | undefined {
  const role = asRecord(asRecord(value)?.RoleSpec) ?? asRecord(value);
  const roletype = readString(role?.roletype);
  if (roletype === "ROLESPEC_PUBLIC") {
    return "PUBLIC";
  }
  return readString(role?.rolename);
}

export interface FunctionIdentity extends QualifiedName {
  signature: string;
}

export function functionIdentity(
  funcname: unknown,
  parameters: unknown
): FunctionIdentity | undefined {
  const name = qualifiedName(funcname);
  if (!name) {
    return;
  }
  const args: string[] = [];
  for (const item of readArray(parameters)) {
    const parameter = asRecord(asRecord(item)?.FunctionParameter);
    if (!parameter) {
      continue;
    }
    const mode = readString(parameter.mode) ?? "FUNC_PARAM_DEFAULT";
    if (mode === "FUNC_PARAM_OUT" || mode === "FUNC_PARAM_TABLE") {
      continue;
    }
    const prefix = mode === "FUNC_PARAM_VARIADIC" ? "VARIADIC " : "";
    args.push(`${prefix}${typeNameToSql(parameter.argType)}`);
  }
  return { ...name, signature: args.join(", ") };
}

export function objectWithArgsIdentity(value: unknown): FunctionIdentity | undefined {
  const object = asRecord(asRecord(value)?.ObjectWithArgs) ?? asRecord(value);
  const name = qualifiedName(object?.objname);
  if (!name) {
    return;
  }
  const args = readArray(object?.objargs).map((item) => typeNameToSql(item));
  return { ...name, signature: args.join(", ") };
}

export interface ColumnFacts {
  generated?: "stored" | "virtual";
  hasDefault: boolean;
  hasInlineConstraint: boolean;
  identity?: "always" | "by-default";
  location: number;
  name: string;
  notNull: boolean;
  type: string;
}

export function collectReferences(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, into);
    }
    return into;
  }
  const record = asRecord(value);
  if (!record) {
    return into;
  }
  const rangeVar = asRecord(record.RangeVar) ?? rawRangeVarRecord(record);
  if (rangeVar) {
    const name = rangeVarName(rangeVar);
    if (name) {
      into.add(`${name.schema}.${name.name}`);
    }
  }
  const funcCall = asRecord(record.FuncCall);
  if (funcCall) {
    const name = qualifiedNameWhenQualified(funcCall.funcname);
    if (name) {
      into.add(`${name.schema}.${name.name}`);
    }
  }
  const typeName =
    asRecord(record.TypeName) ?? asRecord(record.typeName) ?? rawTypeNameRecord(record);
  if (typeName) {
    const name = qualifiedNameWhenQualified(typeName.names);
    if (name && name.schema !== "pg_catalog") {
      into.add(`${name.schema}.${name.name}`);
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectReferences(child, into);
    }
  }
  return into;
}

function rawTypeNameRecord(record: AstNode): AstNode | undefined {
  if (record.names === undefined || !("typemod" in record || "typmods" in record)) {
    return;
  }
  return record;
}

function rawRangeVarRecord(record: AstNode): AstNode | undefined {
  if (
    typeof record.relname !== "string" ||
    !("schemaname" in record || "inh" in record || "relpersistence" in record)
  ) {
    return;
  }
  return record;
}

export function collectColumnReferences(
  value: unknown,
  into: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectColumnReferences(item, into);
    }
    return into;
  }
  const record = asRecord(value);
  if (!record) {
    return into;
  }
  const columnRef = asRecord(record.ColumnRef);
  if (columnRef) {
    const names = stringList(columnRef.fields);
    const column = names.at(-1);
    if (column !== undefined && column !== "*") {
      into.add(column);
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectColumnReferences(child, into);
    }
  }
  return into;
}

function qualifiedNameWhenQualified(value: unknown): QualifiedName | undefined {
  const parts = stringList(value);
  if (parts.length < 2) {
    return;
  }
  return {
    name: parts.at(-1) ?? "",
    schema: parts.at(-2) ?? "",
  };
}

export function columnFacts(value: unknown): ColumnFacts | undefined {
  const column = asRecord(asRecord(value)?.ColumnDef);
  const name = readString(column?.colname);
  if (!(column && name)) {
    return;
  }
  let notNull = false;
  let hasDefault = false;
  let identity: "always" | "by-default" | undefined;
  let generated: "stored" | "virtual" | undefined;
  let hasInlineConstraint = false;
  for (const item of readArray(column.constraints)) {
    const constraint = asRecord(asRecord(item)?.Constraint);
    const contype = readString(constraint?.contype);
    switch (contype) {
      case "CONSTR_NOTNULL":
        notNull = true;
        break;
      case "CONSTR_DEFAULT":
        hasDefault = true;
        break;
      case "CONSTR_IDENTITY":
        identity = identityMode(readString(constraint?.generated_when));
        break;
      case "CONSTR_GENERATED":
        generated = generatedColumnKind(readString(constraint?.generated_when));
        break;
      case "CONSTR_NULL":
        break;
      default:
        if (contype !== undefined) {
          hasInlineConstraint = true;
        }
        break;
    }
  }
  return {
    ...(generated === undefined ? {} : { generated }),
    hasDefault,
    hasInlineConstraint,
    ...(identity === undefined ? {} : { identity }),
    location: readNumber(column.location) ?? -1,
    name,
    notNull,
    type: typeNameToSql(column.typeName),
  };
}

function identityMode(value: string | undefined): "always" | "by-default" {
  return value === "d" ? "by-default" : "always";
}

function generatedColumnKind(value: string | undefined): "stored" | "virtual" {
  return value === "v" ? "virtual" : "stored";
}
