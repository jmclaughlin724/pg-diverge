import { readFile } from "node:fs/promises";
import type {
  Diagnostic,
  ObjectKind,
  ObjectRef,
  SchemaModel,
  SchemaObject,
  SupaschemaConfig,
  TableColumn,
} from "../core.js";
import { diagnostic, hasErrors } from "../diagnostics.js";
import { fingerprintObjects, MODEL_FORMAT_VERSION } from "../hash.js";
import { migrationFiles } from "../migrations/files.js";
import type { AstNode, AstStatement, ColumnFacts, QualifiedName } from "../sql/ast.js";
import {
  asRecord,
  astStatements,
  columnFacts,
  objectWithArgsIdentity,
  qualifiedName,
  rangeVarName,
  readArray,
  readBoolean,
  readString,
} from "../sql/ast.js";
import { extractObjectsFromSql } from "../sql/extract.js";
import { alterTableObjects } from "../sql/extract-helpers.js";
import { finalizeObjects } from "../sql/facts.js";
import { objectKey } from "../sql/identifiers.js";
import { shapeHash, stripLocations } from "../sql/object-hash.js";
import { parseSqlAst } from "../sql/parser.js";
import { expressionSql, makeObject } from "../sql/statements.js";
import { ignoredStatementTags, sourceIntentStatementTags } from "../sql/support.js";
import { canonicalColumnType, canonicalizeRegclassLiterals } from "../sql/table-shape.js";
import { normalizeSourceObjects } from "./normalize.js";

interface ReplayResult {
  diagnostics: Diagnostic[];
  hardFail: boolean;
  nextOrdinal: number | undefined;
}

interface ReplayContext {
  config: SupaschemaConfig;
  idempotentCreate?: boolean;
  normalize: boolean;
}

interface ColumnShape extends Record<string, unknown> {
  name: string;
  notNull: boolean;
  type: string;
}

interface DropTarget {
  display: string;
  refs: ObjectRef[];
}

interface DoBlockDdlFragment {
  idempotentCreate: boolean;
  sql: string;
}

const extractedStatementTags = new Set([
  "AlterDefaultPrivilegesStmt",
  "AlterSeqStmt",
  "CommentStmt",
  "CompositeTypeStmt",
  "CreateDomainStmt",
  "CreateEnumStmt",
  "CreateExtensionStmt",
  "CreateFdwStmt",
  "CreateForeignServerStmt",
  "CreateForeignTableStmt",
  "CreateFunctionStmt",
  "CreatePolicyStmt",
  "CreateRangeStmt",
  "CreateSchemaStmt",
  "CreateSeqStmt",
  "CreateStmt",
  "CreateTableAsStmt",
  "CreateTrigStmt",
  "GrantStmt",
  "IndexStmt",
  "ViewStmt",
]);

const createDuplicateGapTags = new Set([
  "CompositeTypeStmt",
  "CreateDomainStmt",
  "CreateEnumStmt",
  "CreateExtensionStmt",
  "CreateFdwStmt",
  "CreateForeignServerStmt",
  "CreateForeignTableStmt",
  "CreateFunctionStmt",
  "CreatePolicyStmt",
  "CreateRangeStmt",
  "CreateSchemaStmt",
  "CreateSeqStmt",
  "CreateStmt",
  "CreateTableAsStmt",
  "CreateTrigStmt",
  "IndexStmt",
  "ViewStmt",
]);

const normalizedAmendmentKeys = new Set([
  "columnDefaultAmendment",
  "columnGeneratedAmendment",
  "columnIdentityAmendment",
  "sequenceOwnedByAmendment",
  "tablePartitionAmendment",
]);

const supportedColumnConstraintTypes = new Set([
  "CONSTR_DEFAULT",
  "CONSTR_GENERATED",
  "CONSTR_IDENTITY",
  "CONSTR_NOTNULL",
  "CONSTR_NULL",
]);

const typegenNeutralStatementTags = new Set([
  "AlterPolicyStmt",
  "AlterRoleStmt",
  "CreateRoleStmt",
  "DropRoleStmt",
  "VariableSetStmt",
]);

const digitStart = "0".charCodeAt(0);
const digitEnd = "9".charCodeAt(0);
const uppercaseStart = "A".charCodeAt(0);
const uppercaseEnd = "Z".charCodeAt(0);
const underscore = "_".charCodeAt(0);
const lowercaseStart = "a".charCodeAt(0);
const lowercaseEnd = "z".charCodeAt(0);
const dollarSign = "$".charCodeAt(0);

export async function reconstructModelFromMigrations(
  directory: string,
  source: string,
  config: SupaschemaConfig
): Promise<SchemaModel> {
  const diagnostics: Diagnostic[] = [];
  const files = await migrationFiles(directory);
  if (files.length === 0) {
    diagnostics.push(
      replayDiagnostic(
        "SUPA_REPLAY_ORDER_GAP",
        "error",
        `no migration files found under ${directory}`
      )
    );
    return replayModel(diagnostics, [], source);
  }

  const objects = new Map<string, SchemaObject>();
  const context: ReplayContext = { config, normalize: config.normalize === "deparse" };
  let ordinal = 0;
  for (const file of files) {
    const result = await replayMigrationFile(file, objects, context, ordinal);
    diagnostics.push(...result.diagnostics);
    if (result.nextOrdinal !== undefined) {
      ordinal = result.nextOrdinal;
    }
    if (result.hardFail) {
      return replayModel(diagnostics, [], source);
    }
  }

  const normalized = await normalizeSourceObjects([...objects.values()], diagnostics, {
    normalize: context.normalize,
  });
  return replayModel(diagnostics, hasErrors(diagnostics) ? [] : normalized, source);
}

function replayModel(
  diagnostics: Diagnostic[],
  objects: SchemaObject[],
  source: string
): SchemaModel {
  const sorted = objects.sort((left, right) => left.ordinal - right.ordinal);
  return {
    diagnostics,
    fingerprint: fingerprintObjects(sorted),
    formatVersion: MODEL_FORMAT_VERSION,
    objects: sorted,
    source,
  };
}

async function replayMigrationFile(
  file: string,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  ordinal: number
): Promise<ReplayResult> {
  const sql = await readFile(file, "utf8");
  const parsed = await parseSqlAst(sql, file);
  if (parsed.ast === undefined) {
    return {
      diagnostics: parsed.diagnostics,
      hardFail: hasErrors(parsed.diagnostics),
      nextOrdinal: ordinal,
    };
  }

  const diagnostics = [...parsed.diagnostics];
  let nextOrdinal = ordinal;
  for (const statement of astStatements(parsed.ast, sql)) {
    const result = await applyReplayStatement(statement, objects, context, file, nextOrdinal);
    diagnostics.push(...result.diagnostics);
    if (result.nextOrdinal !== undefined) {
      nextOrdinal = result.nextOrdinal;
    }
    if (result.hardFail) {
      return { diagnostics, hardFail: true, nextOrdinal };
    }
  }
  return { diagnostics, hardFail: false, nextOrdinal };
}

async function applyReplayStatement(
  statement: AstStatement,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string,
  ordinal: number
): Promise<ReplayResult> {
  if (statement.text.length === 0 || ignoredStatementTags.has(statement.tag)) {
    return emptyResult();
  }
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return emptyResult();
  }
  return await applyStatement(statement, node, objects, context, file, ordinal);
}

async function applyStatement(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string,
  ordinal: number
): Promise<ReplayResult> {
  if (statement.tag === "DoStmt") {
    return await applyDoBlock(statement, node, objects, context, file, ordinal);
  }
  if (sourceIntentStatementTags.has(statement.tag)) {
    return emptyResult();
  }
  if (typegenNeutralStatementTags.has(statement.tag)) {
    return emptyResult();
  }
  if (extractedStatementTags.has(statement.tag)) {
    return await applyExtractedStatement(statement, objects, context, file, ordinal);
  }
  if (statement.tag === "AlterTableStmt") {
    return await applyAlterTable(statement, node, objects, context, file, ordinal);
  }
  if (statement.tag === "AlterEnumStmt") {
    return applyAlterEnum(statement, node, objects, file);
  }
  if (statement.tag === "RenameStmt") {
    return applyRename(statement, node, objects, file);
  }
  if (statement.tag === "DropStmt") {
    return applyDrop(statement, node, objects, file);
  }
  return unsupportedStatement(
    statement,
    file,
    `unsupported ${statement.tag} statement during migration replay`
  );
}

async function applyDoBlock(
  _statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string,
  ordinal: number
): Promise<ReplayResult> {
  const body = doBlockBody(node);
  if (body === undefined) {
    return emptyResult();
  }

  const diagnostics: Diagnostic[] = [];
  let nextOrdinal = ordinal;
  for (const fragment of doBlockDdlFragments(body)) {
    const parsed = await parseSqlAst(fragment.sql, file);
    if (parsed.ast === undefined) {
      diagnostics.push(
        replayDiagnostic(
          "SUPA_REPLAY_UNSUPPORTED",
          "error",
          "embedded DO statement could not be parsed during migration replay",
          { file, statement: fragment.sql }
        )
      );
      return { diagnostics, hardFail: true, nextOrdinal };
    }
    const nestedContext = fragment.idempotentCreate
      ? { ...context, idempotentCreate: true }
      : context;
    for (const nestedStatement of astStatements(parsed.ast, fragment.sql)) {
      const nestedNode = asRecord(nestedStatement.node[nestedStatement.tag]);
      if (!nestedNode) {
        continue;
      }
      const result = await applyStatement(
        nestedStatement,
        nestedNode,
        objects,
        nestedContext,
        file,
        nextOrdinal
      );
      diagnostics.push(...result.diagnostics);
      if (result.nextOrdinal !== undefined) {
        nextOrdinal = result.nextOrdinal;
      }
      if (result.hardFail) {
        return { diagnostics, hardFail: true, nextOrdinal };
      }
    }
  }
  return { diagnostics, hardFail: false, nextOrdinal };
}

async function applyExtractedStatement(
  statement: AstStatement,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string,
  ordinal: number
): Promise<ReplayResult> {
  const extracted = await extractObjectsFromSql(statement.text, {
    config: context.config,
    file,
    startOrdinal: ordinal,
  });
  const diagnostics = replayExtractionDiagnostics(extracted.diagnostics);
  if (hasErrors(diagnostics)) {
    return { diagnostics, hardFail: true, nextOrdinal: extracted.nextOrdinal };
  }

  const nextOrdinal = extracted.nextOrdinal;
  for (const object of extracted.objects) {
    const result = await applyExtractedObject(statement, object, objects, context, file);
    diagnostics.push(...result.diagnostics);
    if (result.hardFail) {
      return { diagnostics, hardFail: true, nextOrdinal };
    }
  }
  return { diagnostics, hardFail: false, nextOrdinal };
}

async function applyExtractedObject(
  statement: AstStatement,
  object: SchemaObject,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string
): Promise<ReplayResult> {
  if (isNormalizedAmendmentMarker(object)) {
    return await applyNormalizedAmendment(object, objects, context);
  }
  if (objects.has(object.key) && createDuplicateGapTags.has(statement.tag)) {
    if (isReplaceStatement(statement)) {
      objects.set(object.key, object);
      return emptyResult();
    }
    if (context.idempotentCreate === true || isIfNotExistsStatement(statement)) {
      return emptyResult();
    }
    return orderGap(
      `CREATE duplicates ${object.key} while replaying migration history`,
      file,
      statement.text,
      object.ref
    );
  }
  objects.set(object.key, object);
  return emptyResult();
}

function isReplaceStatement(statement: AstStatement): boolean {
  const node = asRecord(statement.node[statement.tag]);
  return (
    (statement.tag === "CreateFunctionStmt" ||
      statement.tag === "CreateTrigStmt" ||
      statement.tag === "ViewStmt") &&
    readBoolean(node?.replace) === true
  );
}

function isIfNotExistsStatement(statement: AstStatement): boolean {
  const node = asRecord(statement.node[statement.tag]);
  return readBoolean(node?.if_not_exists) === true;
}

async function applyAlterTable(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  context: ReplayContext,
  file: string,
  ordinal: number
): Promise<ReplayResult> {
  const tableName = rangeVarName(node.relation);
  if (!tableName) {
    return unsupportedStatement(statement, file, "ALTER TABLE relation could not be resolved");
  }
  const table = tableLikeObject(objects, tableName);
  if (!table) {
    if (isConfigIgnoredSchema(tableName.schema, context.config)) {
      return emptyResult();
    }
    return orderGap(
      `ALTER TABLE target ${qualifiedDisplayName(tableName)} is absent from replay state`,
      file,
      statement.text,
      { kind: "table", name: tableName.name, schema: tableName.schema }
    );
  }

  const diagnostics: Diagnostic[] = [];
  let nextOrdinal = ordinal;
  for (const rawCommand of readArray(node.cmds)) {
    const result = await applyAlterTableCommand({
      context,
      file,
      node,
      objects,
      ordinal: nextOrdinal,
      rawCommand,
      statement,
      table,
    });
    diagnostics.push(...result.diagnostics);
    if (result.nextOrdinal !== undefined) {
      nextOrdinal = result.nextOrdinal;
    }
    if (result.hardFail) {
      return { diagnostics, hardFail: true, nextOrdinal };
    }
  }
  return { diagnostics, hardFail: false, nextOrdinal };
}

async function applyAlterTableCommand(options: {
  context: ReplayContext;
  file: string;
  node: AstNode;
  objects: Map<string, SchemaObject>;
  ordinal: number;
  rawCommand: unknown;
  statement: AstStatement;
  table: SchemaObject;
}): Promise<ReplayResult> {
  const command = asRecord(asRecord(options.rawCommand)?.AlterTableCmd);
  if (!command) {
    return unsupportedStatement(
      options.statement,
      options.file,
      "unresolved ALTER TABLE command during migration replay"
    );
  }

  const subtype = readString(command.subtype);
  const custom = applyColumnMutation(
    options.statement,
    subtype,
    command,
    options.table,
    options.objects,
    options.file
  );
  if (custom !== undefined) {
    return { ...custom, nextOrdinal: options.ordinal };
  }

  const extracted = alterTableObjects(
    { ...options.node, cmds: [options.rawCommand] },
    options.statement.text,
    options.ordinal,
    options.file
  );
  if (!extracted || extracted.length === 0) {
    return unsupportedStatement(
      options.statement,
      options.file,
      `unsupported ALTER TABLE subtype ${subtype ?? "unknown"} during migration replay`
    );
  }

  const diagnostics = await finalizeObjects(extracted, { normalize: options.context.normalize });
  if (hasErrors(diagnostics)) {
    return { diagnostics, hardFail: true, nextOrdinal: options.ordinal };
  }
  return applyExtractedObjects(options, extracted, diagnostics);
}

async function applyExtractedObjects(
  options: {
    context: ReplayContext;
    file: string;
    objects: Map<string, SchemaObject>;
    ordinal: number;
    statement: AstStatement;
  },
  extracted: SchemaObject[],
  diagnostics: Diagnostic[]
): Promise<ReplayResult> {
  let nextOrdinal = options.ordinal;
  for (const object of extracted) {
    const result = await applyExtractedObject(
      options.statement,
      object,
      options.objects,
      options.context,
      options.file
    );
    diagnostics.push(...result.diagnostics);
    if (result.hardFail) {
      return { diagnostics, hardFail: true, nextOrdinal };
    }
    nextOrdinal += 1;
  }
  return { diagnostics, hardFail: false, nextOrdinal };
}

function isConfigIgnoredSchema(schema: string | undefined, config: SupaschemaConfig): boolean {
  const name = schema ?? "public";
  if (config.managedSchemas.includes(name)) {
    return true;
  }
  if (config.schemas.exclude.includes(name)) {
    return true;
  }
  return config.schemas.include.length > 0 && !config.schemas.include.includes(name);
}

function qualifiedDisplayName(name: QualifiedName): string {
  return name.schema === undefined ? name.name : `${name.schema}.${name.name}`;
}

function applyColumnMutation(
  statement: AstStatement,
  subtype: string | undefined,
  command: AstNode,
  table: SchemaObject,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult | undefined {
  if (subtype === "AT_AddColumn") {
    return applyAddColumn(statement, command, table, file);
  }
  if (subtype === "AT_DropColumn") {
    return applyDropColumn(statement, command, table, objects, file);
  }
  if (subtype === "AT_AlterColumnType") {
    return applyAlterColumnType(statement, command, table, file);
  }
  if (subtype === "AT_SetNotNull" || subtype === "AT_DropNotNull") {
    return applyNotNull(statement, command, table, subtype === "AT_SetNotNull", file);
  }
  if (subtype === "AT_DropConstraint") {
    return applyDropConstraint(statement, command, table, objects, file);
  }
  return;
}

function applyAddColumn(
  statement: AstStatement,
  command: AstNode,
  table: SchemaObject,
  file: string
): ReplayResult {
  const columnDef = asRecord(asRecord(command.def)?.ColumnDef);
  const facts = columnFacts(command.def);
  if (!(columnDef && facts)) {
    return unsupportedStatement(statement, file, "ADD COLUMN definition could not be resolved");
  }
  const shape = tableShape(table);
  const shapeColumns = tableShapeColumns(shape);
  if (!(shape && shapeColumns)) {
    return unsupportedStatement(statement, file, `${table.key} has no canonical table shape`);
  }
  if (shapeColumns.some((column) => column.name === facts.name)) {
    if (readBoolean(command.missing_ok) === true) {
      return emptyResult();
    }
    return orderGap(
      `ADD COLUMN duplicates ${table.key}.${facts.name}`,
      file,
      statement.text,
      table.ref
    );
  }
  const unsupportedConstraints = unsupportedColumnConstraints(columnDef);
  if (unsupportedConstraints.length > 0) {
    return unsupportedStatement(
      statement,
      file,
      `ADD COLUMN contains unsupported inline constraints: ${unsupportedConstraints.join(", ")}`
    );
  }

  const canonical = canonicalColumnFromColumnDef(columnDef);
  if (!canonical) {
    return unsupportedStatement(
      statement,
      file,
      "ADD COLUMN canonical shape could not be resolved"
    );
  }
  updateTableShape(table, { ...shape, columns: [...shapeColumns, canonical] }, statement.text);
  table.metadata.columns = [
    ...tableMetadataColumns(table),
    metadataColumnFromFacts(facts, columnDef),
  ];
  return emptyResult();
}

function applyDropColumn(
  statement: AstStatement,
  command: AstNode,
  table: SchemaObject,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const columnName = readString(command.name);
  if (!columnName) {
    return unsupportedStatement(statement, file, "DROP COLUMN name could not be resolved");
  }
  const shape = tableShape(table);
  const shapeColumns = tableShapeColumns(shape);
  const columnIndex = shapeColumns?.findIndex((column) => column.name === columnName) ?? -1;
  if (!(shape && shapeColumns && columnIndex >= 0)) {
    if (readBoolean(command.missing_ok) === true) {
      return emptyResult();
    }
    return orderGap(
      `DROP COLUMN targets absent column ${table.key}.${columnName}`,
      file,
      statement.text,
      table.ref
    );
  }
  updateTableShape(
    table,
    { ...shape, columns: shapeColumns.filter((column) => column.name !== columnName) },
    statement.text
  );
  table.metadata.columns = tableMetadataColumns(table).filter(
    (column) => column.name !== columnName
  );
  removeColumnDependents(objects, table, columnName);
  return emptyResult();
}

function applyAlterColumnType(
  statement: AstStatement,
  command: AstNode,
  table: SchemaObject,
  file: string
): ReplayResult {
  const columnName = readString(command.name);
  const columnDef = asRecord(asRecord(command.def)?.ColumnDef);
  if (!(columnName && columnDef)) {
    return unsupportedStatement(
      statement,
      file,
      "ALTER COLUMN TYPE definition could not be resolved"
    );
  }
  const nextType = canonicalColumnType(columnDef.typeName);
  return mutateTableColumn(
    statement,
    table,
    columnName,
    file,
    (column) => ({ ...column, type: nextType }),
    (column) => ({
      ...column,
      definition: nextType,
      type: nextType,
    })
  );
}

function applyNotNull(
  statement: AstStatement,
  command: AstNode,
  table: SchemaObject,
  notNull: boolean,
  file: string
): ReplayResult {
  const columnName = readString(command.name);
  if (!columnName) {
    return unsupportedStatement(
      statement,
      file,
      "ALTER COLUMN nullability target could not be resolved"
    );
  }
  return mutateTableColumn(
    statement,
    table,
    columnName,
    file,
    (column) => ({ ...column, notNull }),
    (column) => ({
      ...column,
      notNull,
    })
  );
}

function applyDropConstraint(
  statement: AstStatement,
  command: AstNode,
  table: SchemaObject,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const constraintName = readString(command.name);
  if (!constraintName) {
    return unsupportedStatement(statement, file, "DROP CONSTRAINT name could not be resolved");
  }
  const ref: ObjectRef =
    table.ref.schema === undefined
      ? { kind: "constraint", name: constraintName, table: table.ref.name }
      : {
          kind: "constraint",
          name: constraintName,
          schema: table.ref.schema,
          table: table.ref.name,
        };
  const key = objectKey(ref);
  if (objects.delete(key) || readBoolean(command.missing_ok) === true) {
    return emptyResult();
  }
  return orderGap(`DROP CONSTRAINT targets absent constraint ${key}`, file, statement.text, ref);
}

function mutateTableColumn(
  statement: AstStatement,
  table: SchemaObject,
  columnName: string,
  file: string,
  mutateShape: (column: ColumnShape) => ColumnShape,
  mutateMetadata: (column: TableColumn) => TableColumn
): ReplayResult {
  const shape = tableShape(table);
  const shapeColumns = tableShapeColumns(shape);
  const columnIndex = shapeColumns?.findIndex((column) => column.name === columnName) ?? -1;
  if (!(shape && shapeColumns && columnIndex >= 0)) {
    return orderGap(
      `ALTER COLUMN targets absent column ${table.key}.${columnName}`,
      file,
      statement.text,
      table.ref
    );
  }
  const nextShapeColumns = [...shapeColumns];
  const current = nextShapeColumns[columnIndex];
  if (!current) {
    return unsupportedStatement(statement, file, `column ${columnName} could not be resolved`);
  }
  nextShapeColumns[columnIndex] = mutateShape(current);
  updateTableShape(table, { ...shape, columns: nextShapeColumns }, statement.text);
  table.metadata.columns = tableMetadataColumns(table).map((column) =>
    column.name === columnName ? mutateMetadata(column) : column
  );
  return emptyResult();
}

function applyAlterEnum(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const name = qualifiedName(node.typeName);
  if (!name) {
    return unsupportedStatement(statement, file, "ALTER TYPE enum name could not be resolved");
  }
  const enumObject = objects.get(objectKey({ kind: "enum", ...name }));
  if (!enumObject) {
    return orderGap(
      `ALTER TYPE ADD VALUE targets absent enum ${qualifiedObjectName(name)}`,
      file,
      statement.text,
      { kind: "enum", ...name }
    );
  }
  const values = enumValues(enumObject);
  const value = stringNode(node.newVal);
  if (value === undefined) {
    return unsupportedStatement(
      statement,
      file,
      "ALTER TYPE ADD VALUE value could not be resolved"
    );
  }
  if (values.includes(value)) {
    return emptyResult();
  }
  const neighbor = stringNode(node.newValNeighbor);
  if (neighbor === undefined) {
    values.push(value);
  } else {
    const index = values.indexOf(neighbor);
    if (index === -1) {
      return orderGap(
        `ALTER TYPE ADD VALUE references absent enum neighbor ${neighbor}`,
        file,
        statement.text,
        enumObject.ref
      );
    }
    values.splice(readBoolean(node.newValIsAfter) ? index + 1 : index, 0, value);
  }
  enumObject.metadata = { ...enumObject.metadata, values };
  enumObject.hash = shapeHash({ values }, enumObject.key, enumObject.ref);
  enumObject.sql = `${enumObject.sql};\n${statement.text}`;
  return emptyResult();
}

function applyRename(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const renameType = readString(node.renameType);
  if (renameType === "OBJECT_COLUMN") {
    return applyColumnRename(statement, node, objects, file);
  }
  if (renameType === "OBJECT_TABLE" || renameType === "OBJECT_FOREIGN_TABLE") {
    return applyTableRename(statement, node, objects, renameType, file);
  }
  if (renameType === "OBJECT_INDEX") {
    return applyObjectRename(statement, node, objects, "index", file);
  }
  return unsupportedStatement(
    statement,
    file,
    `unsupported rename type ${renameType ?? "unknown"} cannot be replayed without corrupting shape`
  );
}

function applyColumnRename(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const tableName = rangeVarName(node.relation);
  const oldName = stringNode(node.subname);
  const newName = stringNode(node.newname);
  if (!(tableName && oldName && newName)) {
    return unsupportedStatement(statement, file, "column rename target could not be resolved");
  }
  const table = tableLikeObject(objects, tableName);
  if (!table) {
    return emptyResult();
  }
  const shape = tableShape(table);
  const shapeColumns = tableShapeColumns(shape);
  const columnIndex = shapeColumns?.findIndex((column) => column.name === oldName) ?? -1;
  if (!(shape && shapeColumns && columnIndex >= 0)) {
    return orderGap(
      `RENAME COLUMN targets absent column ${table.key}.${oldName}`,
      file,
      statement.text,
      table.ref
    );
  }
  if (shapeColumns.some((column) => column.name === newName)) {
    return orderGap(
      `RENAME COLUMN would duplicate ${table.key}.${newName}`,
      file,
      statement.text,
      table.ref
    );
  }
  const nextShapeColumns = [...shapeColumns];
  const current = nextShapeColumns[columnIndex];
  if (!current) {
    return unsupportedStatement(statement, file, `column ${oldName} could not be resolved`);
  }
  nextShapeColumns[columnIndex] = { ...current, name: newName };
  updateTableShape(table, { ...shape, columns: nextShapeColumns }, statement.text);
  table.metadata.columns = tableMetadataColumns(table).map((column) =>
    column.name === oldName ? { ...column, name: newName } : column
  );
  updateColumnScopedMetadata(objects, tableName, oldName, newName);
  return emptyResult();
}

function applyTableRename(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  renameType: string,
  file: string
): ReplayResult {
  const oldTable = rangeVarName(node.relation);
  const newName = stringNode(node.newname);
  if (!(oldTable && newName)) {
    return unsupportedStatement(statement, file, "table rename target could not be resolved");
  }
  const kind = renameType === "OBJECT_FOREIGN_TABLE" ? "foreign-table" : "table";
  const oldKey = objectKey({ kind, ...oldTable });
  const target = objects.get(oldKey);
  if (!target) {
    return emptyResult();
  }
  const nextRef = { ...target.ref, name: newName };
  const nextKey = objectKey(nextRef);
  if (objects.has(nextKey)) {
    return orderGap(`RENAME TABLE would duplicate ${nextKey}`, file, statement.text, nextRef);
  }
  objects.delete(oldKey);
  objects.set(nextKey, renamedObject(target, nextRef, statement.text));
  return rekeyTableScopedObjects(objects, oldTable, newName, file, statement.text);
}

function applyDrop(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  file: string
): ReplayResult {
  const removeType = readString(node.removeType);
  const targets = dropTargets(removeType, node);
  if (targets.length === 0) {
    return unsupportedStatement(
      statement,
      file,
      `unsupported DROP ${removeType ?? "unknown"} during migration replay`
    );
  }
  const diagnostics: Diagnostic[] = [];
  const missingOk = readBoolean(node.missing_ok) === true;
  for (const target of targets) {
    if (!removeDropTarget(objects, target)) {
      if (missingOk) {
        continue;
      }
      diagnostics.push(
        replayDiagnostic(
          "SUPA_REPLAY_ORDER_GAP",
          "error",
          `DROP targets absent object ${target.display}`,
          { file, statement: statement.text }
        )
      );
    }
  }
  return { diagnostics, hardFail: hasErrors(diagnostics), nextOrdinal: undefined };
}

async function applyNormalizedAmendment(
  marker: SchemaObject,
  objects: Map<string, SchemaObject>,
  context: ReplayContext
): Promise<ReplayResult> {
  const target = objects.get(marker.key);
  if (!target) {
    return orderGap(
      `ALTER amendment targets absent object ${marker.key}`,
      marker.file,
      marker.sql,
      marker.ref
    );
  }
  const diagnostics: Diagnostic[] = [];
  const normalized = await normalizeSourceObjects([target, marker], diagnostics, {
    normalize: context.normalize,
  });
  const nextTarget = normalized.find((object) => object.key === marker.key);
  if (hasErrors(diagnostics) || !nextTarget) {
    return {
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              replayDiagnostic(
                "SUPA_REPLAY_UNSUPPORTED",
                "error",
                `ALTER amendment could not be applied to ${marker.key}`,
                { file: marker.file, statement: marker.sql, ref: marker.ref }
              ),
            ],
      hardFail: true,
      nextOrdinal: undefined,
    };
  }
  objects.set(marker.key, nextTarget);
  return emptyResult();
}

function isNormalizedAmendmentMarker(object: SchemaObject): boolean {
  return Object.keys(object.metadata).some((key) => normalizedAmendmentKeys.has(key));
}

function tableLikeObject(
  objects: Map<string, SchemaObject>,
  name: QualifiedName
): SchemaObject | undefined {
  return (
    objects.get(objectKey({ kind: "table", ...name })) ??
    objects.get(objectKey({ kind: "foreign-table", ...name }))
  );
}

function tableShape(table: SchemaObject): Record<string, unknown> | undefined {
  return asRecord(table.metadata.canonicalShape);
}

function tableShapeColumns(shape: Record<string, unknown> | undefined): ColumnShape[] | undefined {
  const columns = readArray(shape?.columns);
  const output: ColumnShape[] = [];
  for (const raw of columns) {
    const column = asRecord(raw);
    if (
      !column ||
      typeof column.name !== "string" ||
      typeof column.type !== "string" ||
      typeof column.notNull !== "boolean"
    ) {
      return;
    }
    output.push({ ...column, name: column.name, notNull: column.notNull, type: column.type });
  }
  return output;
}

function tableMetadataColumns(table: SchemaObject): TableColumn[] {
  const columns = table.metadata.columns;
  if (!Array.isArray(columns)) {
    return [];
  }
  return columns.flatMap((column) => (isTableColumn(column) ? [{ ...column }] : []));
}

function isTableColumn(value: unknown): value is TableColumn {
  const column = asRecord(value);
  return (
    column !== undefined && typeof column.definition === "string" && typeof column.name === "string"
  );
}

function canonicalColumnFromColumnDef(columnDef: AstNode): ColumnShape | undefined {
  const name = readString(columnDef.colname);
  if (!name) {
    return;
  }
  const column: ColumnShape = {
    name,
    notNull: false,
    type: canonicalColumnType(columnDef.typeName),
  };
  for (const item of readArray(columnDef.constraints)) {
    const constraint = asRecord(asRecord(item)?.Constraint);
    const contype = readString(constraint?.contype);
    if (!(constraint && contype)) {
      continue;
    }
    if (contype === "CONSTR_NOTNULL") {
      column.notNull = true;
      continue;
    }
    if (contype === "CONSTR_DEFAULT") {
      column.default = canonicalizeRegclassLiterals(stripLocations(constraint.raw_expr));
      continue;
    }
    if (contype === "CONSTR_IDENTITY") {
      column.identity = readString(constraint.generated_when) ?? "a";
      continue;
    }
    if (contype === "CONSTR_GENERATED") {
      column.generated = stripLocations(constraint.raw_expr);
    }
  }
  return column;
}

function metadataColumnFromFacts(facts: ColumnFacts, columnDef: AstNode): TableColumn {
  const column: TableColumn = {
    definition: facts.type,
    hasDefault: facts.hasDefault,
    hasInlineConstraint: facts.hasInlineConstraint,
    name: facts.name,
    notNull: facts.notNull,
    type: facts.type,
  };
  if (facts.generated !== undefined) {
    column.generated = facts.generated;
  }
  if (facts.identity !== undefined) {
    column.identity = facts.identity;
  }
  for (const item of readArray(columnDef.constraints)) {
    const constraint = asRecord(asRecord(item)?.Constraint);
    const contype = readString(constraint?.contype);
    if (contype === "CONSTR_DEFAULT") {
      const sql = expressionSql(constraint?.raw_expr);
      if (sql !== undefined) {
        column.defaultExpression = sql;
      }
    }
    if (contype === "CONSTR_GENERATED") {
      const sql = expressionSql(constraint?.raw_expr);
      if (sql !== undefined) {
        column.generatedExpression = sql;
      }
    }
  }
  return column;
}

function unsupportedColumnConstraints(columnDef: AstNode): string[] {
  return readArray(columnDef.constraints).flatMap((item) => {
    const constraint = asRecord(asRecord(item)?.Constraint);
    const contype = readString(constraint?.contype);
    return contype !== undefined && !supportedColumnConstraintTypes.has(contype) ? [contype] : [];
  });
}

function updateTableShape(
  table: SchemaObject,
  nextShape: Record<string, unknown>,
  statement: string
): void {
  table.metadata = { ...table.metadata, canonicalShape: nextShape };
  table.hash = shapeHash(nextShape, table.key, table.ref);
  table.sql = `${table.sql};\n${statement}`;
}

function updateColumnScopedMetadata(
  objects: Map<string, SchemaObject>,
  table: QualifiedName,
  oldName: string,
  newName: string
): void {
  for (const object of objects.values()) {
    if (object.ref.schema !== table.schema || object.ref.table !== table.name) {
      continue;
    }
    object.metadata = renameColumnMetadata(object.metadata, oldName, newName);
  }
}

function renameColumnMetadata(
  metadata: Record<string, unknown>,
  oldName: string,
  newName: string
): Record<string, unknown> {
  const next = { ...metadata };
  for (const key of ["constraintColumns", "columnDependencies", "routineColumnDependencies"]) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].map((value) => renameColumnReference(value, oldName, newName));
    }
  }
  return next;
}

function renameColumnReference(value: unknown, oldName: string, newName: string): unknown {
  if (value === oldName) {
    return newName;
  }
  if (typeof value === "string" && value.endsWith(`.${oldName}`)) {
    return `${value.slice(0, -oldName.length)}${newName}`;
  }
  return value;
}

function removeColumnDependents(
  objects: Map<string, SchemaObject>,
  table: SchemaObject,
  columnName: string
): void {
  for (const [key, object] of objects) {
    if (object.ref.schema !== table.ref.schema || object.ref.table !== table.ref.name) {
      continue;
    }
    const columns = object.metadata.constraintColumns;
    if (Array.isArray(columns) && columns.includes(columnName)) {
      objects.delete(key);
    }
  }
}

function renamedObject(object: SchemaObject, ref: ObjectRef, statement: string): SchemaObject {
  const next: SchemaObject = {
    ...object,
    dependencies: [...object.dependencies],
    key: objectKey(ref),
    metadata: structuredClone(object.metadata),
    ref,
    sql: `${object.sql};\n${statement}`,
  };
  const shape = tableShape(next);
  if ((ref.kind === "table" || ref.kind === "foreign-table") && shape) {
    const relation = asRecord(shape.relation);
    const nextShape = {
      ...shape,
      relation: relation ? { ...relation, name: ref.name } : shape.relation,
    };
    next.metadata = { ...next.metadata, canonicalShape: nextShape };
    next.hash = shapeHash(nextShape, next.key, next.ref);
    return next;
  }
  next.hash = makeObject(ref, next.sql, next.ordinal, next.file, next.metadata).hash;
  return next;
}

function rekeyTableScopedObjects(
  objects: Map<string, SchemaObject>,
  oldTable: QualifiedName,
  newName: string,
  file: string,
  statement: string
): ReplayResult {
  for (const [key, object] of [...objects]) {
    if (object.ref.schema !== oldTable.schema || object.ref.table !== oldTable.name) {
      continue;
    }
    const ref = { ...object.ref, table: newName };
    const nextKey = objectKey(ref);
    if (objects.has(nextKey)) {
      return orderGap(`RENAME TABLE would duplicate ${nextKey}`, file, statement, ref);
    }
    objects.delete(key);
    objects.set(nextKey, renamedObject(object, ref, statement));
  }
  return emptyResult();
}

function applyObjectRename(
  statement: AstStatement,
  node: AstNode,
  objects: Map<string, SchemaObject>,
  kind: ObjectKind,
  file: string
): ReplayResult {
  const oldName = rangeVarName(node.relation);
  const newName = stringNode(node.newname);
  if (!(oldName && newName)) {
    return unsupportedStatement(statement, file, `${kind} rename target could not be resolved`);
  }
  const ref: ObjectRef =
    oldName.schema === undefined
      ? { kind, name: oldName.name }
      : { kind, name: oldName.name, schema: oldName.schema };
  const target = [...objects].find(([, object]) => matchesDropRef(object.ref, ref));
  if (!target) {
    if (readBoolean(node.missing_ok) === true) {
      return emptyResult();
    }
    return orderGap(
      `RENAME ${kind.toUpperCase()} targets absent object ${qualifiedObjectName(oldName)}`,
      file,
      statement.text,
      ref
    );
  }
  const nextRef: ObjectRef = { ...target[1].ref, name: newName };
  if (
    [...objects.values()].some(
      (object) => object !== target[1] && matchesDropRef(object.ref, nextRef)
    )
  ) {
    return orderGap(
      `RENAME ${kind.toUpperCase()} would duplicate ${objectKey(nextRef)}`,
      file,
      statement.text,
      nextRef
    );
  }
  objects.delete(target[0]);
  objects.set(objectKey(nextRef), renamedObject(target[1], nextRef, statement.text));
  return emptyResult();
}

function dropTargets(removeType: string | undefined, node: AstNode): DropTarget[] {
  if (removeType === "OBJECT_TABLE") {
    return nameDropTargets(node, "table");
  }
  if (removeType === "OBJECT_FOREIGN_TABLE") {
    return nameDropTargets(node, "foreign-table");
  }
  if (removeType === "OBJECT_INDEX") {
    return nameDropTargets(node, "index");
  }
  if (removeType === "OBJECT_SEQUENCE") {
    return nameDropTargets(node, "sequence");
  }
  if (removeType === "OBJECT_SCHEMA") {
    return nameDropTargets(node, "schema");
  }
  if (removeType === "OBJECT_EXTENSION") {
    return nameDropTargets(node, "extension");
  }
  if (removeType === "OBJECT_POLICY") {
    return tableScopedDropTargets(node, "policy");
  }
  if (removeType === "OBJECT_TRIGGER") {
    return tableScopedDropTargets(node, "trigger");
  }
  if (removeType === "OBJECT_TYPE") {
    return readArray(node.objects).flatMap((object) => {
      const typeName = asRecord(asRecord(object)?.TypeName);
      const name = qualifiedName(typeName?.names) ?? qualifiedName(object);
      return name
        ? [
            {
              display: qualifiedObjectName(name),
              refs: [
                { kind: "enum", ...name },
                { kind: "type", ...name },
                { kind: "domain", ...name },
              ],
            },
          ]
        : [];
    });
  }
  if (removeType === "OBJECT_VIEW") {
    return nameDropTargets(node, "view");
  }
  if (removeType === "OBJECT_MATVIEW") {
    return nameDropTargets(node, "materialized-view");
  }
  if (removeType === "OBJECT_FUNCTION" || removeType === "OBJECT_PROCEDURE") {
    const kind = removeType === "OBJECT_PROCEDURE" ? "procedure" : "function";
    return readArray(node.objects).flatMap((object) => {
      const identity = objectWithArgsIdentity(object);
      return identity
        ? [
            {
              display: `${qualifiedObjectName(identity)}(${identity.signature})`,
              refs: [{ kind, ...identity }],
            },
          ]
        : [];
    });
  }
  return [];
}

function nameDropTargets(node: AstNode, kind: ObjectKind): DropTarget[] {
  return readArray(node.objects).flatMap<DropTarget>((object) => {
    const direct = stringNode(object);
    if (direct && (kind === "schema" || kind === "extension")) {
      return [{ display: direct, refs: [{ kind, name: direct }] }];
    }
    const name = qualifiedName(object);
    return name
      ? [
          {
            display: qualifiedObjectName(name),
            refs: [{ kind, name: name.name, schema: name.schema }],
          },
        ]
      : [];
  });
}

function tableScopedDropTargets(node: AstNode, kind: "policy" | "trigger"): DropTarget[] {
  return readArray(node.objects).flatMap((object) => {
    const items = readArray(asRecord(asRecord(object)?.List)?.items).map(stringNode);
    const [schema, table, name] = items.length === 3 ? items : [undefined, items[0], items[1]];
    if (!(table && name)) {
      return [];
    }
    const ref: ObjectRef =
      schema === undefined ? { kind, name, table } : { kind, name, schema, table };
    return [
      { display: `${schema === undefined ? table : `${schema}.${table}`}.${name}`, refs: [ref] },
    ];
  });
}

function removeDropTarget(objects: Map<string, SchemaObject>, target: DropTarget): boolean {
  for (const ref of target.refs) {
    const key = objectKey(ref);
    if (!objects.has(key)) {
      continue;
    }
    objects.delete(key);
    if (ref.kind === "table" || ref.kind === "foreign-table") {
      removeTableOwnedObjects(objects, ref);
    }
    if (ref.kind === "schema") {
      removeSchemaObjects(objects, ref.name);
    }
    return true;
  }
  for (const ref of target.refs) {
    let removed = false;
    for (const [key, object] of objects) {
      if (matchesDropRef(object.ref, ref)) {
        objects.delete(key);
        removed = true;
      }
    }
    if (removed) {
      return true;
    }
  }
  return false;
}

function matchesDropRef(candidate: ObjectRef, ref: ObjectRef): boolean {
  return (
    candidate.kind === ref.kind &&
    candidate.name === ref.name &&
    candidate.schema === ref.schema &&
    (ref.table === undefined || candidate.table === ref.table) &&
    (ref.signature === undefined || candidate.signature === ref.signature)
  );
}

function removeTableOwnedObjects(objects: Map<string, SchemaObject>, ref: ObjectRef): void {
  for (const [key, object] of objects) {
    if (object.ref.schema === ref.schema && object.ref.table === ref.name) {
      objects.delete(key);
    }
  }
}

function removeSchemaObjects(objects: Map<string, SchemaObject>, schema: string): void {
  for (const [key, object] of objects) {
    if (object.ref.schema === schema) {
      objects.delete(key);
    }
  }
}

function enumValues(object: SchemaObject): string[] {
  const values = object.metadata.values;
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

function stringNode(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  const direct = readString(record?.sval);
  if (direct !== undefined) {
    return direct;
  }
  return readString(asRecord(record?.String)?.sval);
}

function doBlockBody(node: AstNode): string | undefined {
  for (const item of readArray(node.args)) {
    const def = asRecord(asRecord(item)?.DefElem);
    if (readString(def?.defname) === "as") {
      return stringNode(def?.arg);
    }
  }
  return;
}

function doBlockDdlFragments(body: string): DoBlockDdlFragment[] {
  return splitDoBlockStatements(body).flatMap((statement) => {
    const fragment = doBlockDdlFragment(statement);
    if (fragment === undefined) {
      return [];
    }
    return [fragment];
  });
}

const doBlockDdlStartTokens = new Set(["alter", "comment", "create", "drop", "grant", "revoke"]);

function doBlockDdlFragment(statement: string): DoBlockDdlFragment | undefined {
  const tokens = tokenSpans(statement);
  const startTokenIndex = tokens.findIndex((token) => doBlockDdlStartTokens.has(token.text));
  const start = tokens[startTokenIndex]?.start;
  if (start === undefined) {
    return;
  }
  const sql = statement.slice(start).trim();
  if (sql.length === 0) {
    return;
  }
  const guardTokens = tokens.slice(0, startTokenIndex).map((token) => token.text);
  return {
    idempotentCreate:
      guardTokens.includes("if") && guardTokens.includes("not") && guardTokens.includes("exists"),
    sql,
  };
}

function splitDoBlockStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    const skipped = skipNonCode(body, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    if (char === ";") {
      statements.push(body.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  statements.push(body.slice(start));
  return statements;
}

function tokenSpans(sql: string): { end: number; start: number; text: string }[] {
  const tokens: { end: number; start: number; text: string }[] = [];
  let index = 0;
  while (index < sql.length) {
    const skipped = skipNonCode(sql, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    const char = sql[index] ?? "";
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index] ?? "")) {
        index += 1;
      }
      tokens.push({ end: index, start, text: sql.slice(start, index).toLowerCase() });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function skipNonCode(sql: string, index: number): number | undefined {
  const char = sql[index] ?? "";
  if (char === "'") {
    return skipSingleQuoted(sql, index);
  }
  if (char === "$") {
    return skipDollarQuoted(sql, index);
  }
  if (char === "-" && sql[index + 1] === "-") {
    return skipLineComment(sql, index);
  }
  if (char === "/" && sql[index + 1] === "*") {
    return skipBlockComment(sql, index);
  }
  return;
}

function skipSingleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'" && sql[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (sql[index] === "'") {
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function skipDollarQuoted(sql: string, start: number): number | undefined {
  const tagEnd = sql.indexOf("$", start + 1);
  if (tagEnd === -1) {
    return;
  }
  const tag = sql.slice(start, tagEnd + 1);
  if (!isDollarQuoteTag(tag)) {
    return;
  }
  const end = sql.indexOf(tag, tagEnd + 1);
  return end === -1 ? sql.length : end + tag.length;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}

function isIdentifierStart(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === underscore || isAsciiLetter(code);
}

function isIdentifierPart(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === dollarSign ||
    code === underscore ||
    isAsciiLetter(code) ||
    (code >= digitStart && code <= digitEnd)
  );
}

function isDollarQuoteTag(tag: string): boolean {
  if (tag === "$") {
    return true;
  }
  if (tag.length < 3 || tag.charCodeAt(0) !== dollarSign || tag.at(-1) !== "$") {
    return false;
  }
  if (!isIdentifierStart(tag[1] ?? "")) {
    return false;
  }
  for (let index = 2; index < tag.length - 1; index += 1) {
    if (!isIdentifierPart(tag[index] ?? "")) {
      return false;
    }
  }
  return true;
}

function isAsciiLetter(code: number): boolean {
  return (
    (code >= uppercaseStart && code <= uppercaseEnd) ||
    (code >= lowercaseStart && code <= lowercaseEnd)
  );
}

function replayExtractionDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((item) => {
    if (item.code === "SUPA_SUPABASE_MANAGED_SCHEMA") {
      return { ...item, severity: "warning" };
    }
    if (item.code !== "SUPA_EXTRACT_UNSUPPORTED") {
      return item;
    }
    return { ...item, code: "SUPA_REPLAY_UNSUPPORTED" };
  });
}

function unsupportedStatement(
  statement: AstStatement,
  file: string | undefined,
  message: string
): ReplayResult {
  return {
    diagnostics: [
      replayDiagnostic("SUPA_REPLAY_UNSUPPORTED", "error", message, {
        file,
        statement: statement.text,
      }),
    ],
    hardFail: true,
    nextOrdinal: undefined,
  };
}

function orderGap(
  message: string,
  file: string | undefined,
  statement: string,
  ref?: ObjectRef
): ReplayResult {
  return {
    diagnostics: [
      replayDiagnostic("SUPA_REPLAY_ORDER_GAP", "error", message, {
        file,
        ref,
        statement,
      }),
    ],
    hardFail: true,
    nextOrdinal: undefined,
  };
}

function qualifiedObjectName(name: QualifiedName): string {
  return `${name.schema}.${name.name}`;
}

function emptyResult(): ReplayResult {
  return { diagnostics: [], hardFail: false, nextOrdinal: undefined };
}

function replayDiagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
  extras: Parameters<typeof diagnostic>[3] = {}
): Diagnostic {
  return diagnostic(code, severity, message, extras);
}
