import { resolveConfig } from "../config/schema.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import type {
  Diagnostic,
  ExtractOptions,
  ObjectKind,
  SchemaObject,
  SupaschemaConfig,
} from "../types.js";
import { alterTableObjects } from "./alter-table.js";
import type { AstNode, AstStatement } from "./ast.js";
import {
  asRecord,
  astStatements,
  collectColumnReferences,
  collectReferences,
  functionIdentity,
  qualifiedName,
  rangeVarName,
  readArray,
  readBoolean,
  readString,
  stringList,
} from "./ast.js";
import { classifyDoBlock } from "./do-block.js";
import { finalizeObjects } from "./facts.js";
import { extensionSchemaOption, sequenceOwnedByOption } from "./options.js";
import { supabaseViewSecurityDiagnostics, withManagedSchemaDiagnostics } from "./ownership.js";
import { parseSqlAst } from "./parser.js";
import { policyMetadataFromAst } from "./policies.js";
import {
  commentObjectFromAst,
  defaultPrivilegesFromAst,
  grantObjectsFromAst,
  isInitdbDefaultComment,
  isRevokeGrantOptionFor,
} from "./privileges.js";
import { makeObject, tableMetadataFromAst } from "./statements.js";
import {
  ignoredStatementTags,
  sourceIntentStatementTags,
  unsupportedStatement,
} from "./support.js";
import { stripDeclaredConstraints, tableConstraintSyntheses } from "./table-constraints.js";

type ExtractObjectsOptions = ExtractOptions & {
  existingObjects?: readonly SchemaObject[];
  file?: string;
  startOrdinal?: number;
};

interface ExtractObjectsResult {
  diagnostics: Diagnostic[];
  nextOrdinal: number;
  objects: SchemaObject[];
}

interface ParseStatementResult {
  diagnostics: Diagnostic[];
  objects: SchemaObject[];
}

type ConstraintNamesBySchema = Map<string, Set<string>>;

type ObjectBuilder = (
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
) => SchemaObject[] | undefined;

const objectBuilders: Partial<Record<string, ObjectBuilder>> = {
  AlterDefaultPrivilegesStmt: defaultPrivilegeObjects,
  AlterSeqStmt: sequenceOwnedByObjects,
  CommentStmt: commentObjects,
  CompositeTypeStmt: (node, statement, ordinal, file) =>
    singleRangeVarObject("type", node.typevar, statement, ordinal, file),
  CreateDomainStmt: (node, statement, ordinal, file) =>
    singleQualifiedObject("domain", node.domainname, statement, ordinal, file),
  CreateEnumStmt: enumObjects,
  CreateExtensionStmt: extensionObjects,
  CreateFdwStmt: (node, statement, ordinal, file) =>
    singleNamedObject("foreign-data-wrapper", readString(node.fdwname), statement, ordinal, file),
  CreateForeignServerStmt: (node, statement, ordinal, file) =>
    singleNamedObject("foreign-server", readString(node.servername), statement, ordinal, file),
  CreateForeignTableStmt: foreignTableObjects,
  CreateFunctionStmt: functionObjects,
  CreatePolicyStmt: policyObjects,
  CreateRangeStmt: (node, statement, ordinal, file) =>
    singleQualifiedObject("type", node.typeName, statement, ordinal, file),
  CreateSchemaStmt: schemaObjects,
  CreateSeqStmt: (node, statement, ordinal, file) =>
    singleRangeVarObject("sequence", node.sequence, statement, ordinal, file),
  CreateTableAsStmt: materializedViewObjects,
  CreateTrigStmt: triggerObjects,
  GrantStmt: (node, statement, ordinal, file) =>
    grantObjectsFromAst(node, statement.text, ordinal, file),
  IndexStmt: indexObjects,
  ViewStmt: (node, statement, ordinal, file) =>
    singleRangeVarObject("view", node.view, statement, ordinal, file),
};

export async function extractObjectsFromSql(
  sql: string,
  options: ExtractObjectsOptions = {}
): Promise<ExtractObjectsResult> {
  const config = resolveConfig(options.config);
  const parsedSql = await parseSqlAst(sql, options.file);
  const diagnostics = [...parsedSql.diagnostics];
  const objects: SchemaObject[] = [];
  const constraintNames = constraintNameState(options.existingObjects);
  let ordinal = options.startOrdinal ?? 0;
  if (parsedSql.ast === undefined) {
    if (!diagnostics.some((item) => item.severity === "error")) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_PARSER_REQUIRED",
          "error",
          "AST extraction requires the libpg-query parser",
          { file: options.file }
        )
      );
    }
    return { diagnostics, nextOrdinal: ordinal, objects };
  }
  for (const statement of astStatements(parsedSql.ast, sql)) {
    if (statement.text.length === 0 || ignoredStatementTags.has(statement.tag)) {
      continue;
    }
    const parsed = parseStatement(statement, ordinal, config, options.file, constraintNames);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.objects.length > 0) {
      diagnostics.push(
        ...(await finalizeObjects(parsed.objects, { normalize: config.normalize === "deparse" }))
      );
      diagnostics.push(...supabaseViewSecurityDiagnostics(parsed.objects, config));
    }
    recordConstraintNames(parsed.objects, constraintNames);
    objects.push(...parsed.objects);
    ordinal += parsed.objects.length;
  }
  return {
    diagnostics,
    nextOrdinal: ordinal,
    objects,
  };
}

function parseStatement(
  statement: AstStatement,
  ordinal: number,
  config: SupaschemaConfig,
  file: string | undefined,
  constraintNames: ConstraintNamesBySchema
): ParseStatementResult {
  const node = asRecord(statement.node[statement.tag]) ?? {};
  if (statement.tag === "DoStmt" && classifyDoBlock(node) === "idempotent-role") {
    return { diagnostics: [], objects: [] };
  }
  if (sourceIntentStatementTags.has(statement.tag)) {
    return {
      diagnostics: [
        diagnostic(
          "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED",
          "error",
          "side-effect statements are not schema objects and cannot be rendered as replay-safe migrations",
          {
            file,
            hint: "Keep data/control-plane side effects in an explicit reviewed migration.",
            schemas: referencedSchemas(statement),
            statement: statement.text,
          }
        ),
      ],
      objects: [],
    };
  }
  const unsupported = unsupportedStatement(statement.tag, node);
  if (unsupported) {
    return {
      diagnostics: [
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          `unsupported declarative boundary (${unsupported.boundary}): ${statement.tag}`,
          {
            file,
            hint: unsupported.hint,
            schemas: referencedSchemas(statement),
            statement: statement.text,
          }
        ),
      ],
      objects: [],
    };
  }
  const objects = buildObjects(statement, ordinal, file, constraintNames);
  if (objects === undefined) {
    const head = statement.text.split("\n", 1)[0]?.slice(0, 100) ?? "";
    return {
      diagnostics: [
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          `unsupported or ambiguous DDL statement (${statement.tag}): ${head}`,
          {
            file,
            hint: "Add support for this object kind or keep the change hand-authored.",
            schemas: referencedSchemas(statement),
            statement: statement.text,
          }
        ),
      ],
      objects: [],
    };
  }
  const managed = withManagedSchemaDiagnostics(objects, statement.text, config, file);
  if (statement.tag !== "GrantStmt" || !isRevokeGrantOptionFor(node)) {
    return managed;
  }
  return {
    diagnostics: [
      diagnostic(
        "SUPA_EXTRACT_UNSUPPORTED",
        "error",
        "unsupported REVOKE GRANT OPTION FOR privilege statement",
        {
          file,
          hint: "Keep this privilege mutation in an explicit reviewed migration until it has a dedicated model.",
          schemas: referencedSchemas(statement),
          statement: statement.text,
        }
      ),
      ...managed.diagnostics,
    ],
    objects: managed.objects,
  };
}

function buildObjects(
  statement: AstStatement,
  ordinal: number,
  file: string | undefined,
  constraintNames: ConstraintNamesBySchema
): SchemaObject[] | undefined {
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return;
  }
  const existingNames = constraintNames.get(rangeVarName(node.relation)?.schema ?? "public") ?? [];
  if (statement.tag === "CreateStmt") {
    return tableObjects(node, statement, ordinal, file, existingNames);
  }
  if (statement.tag === "AlterTableStmt") {
    return alterTableObjects(node, statement.text, ordinal, file, existingNames);
  }
  return objectBuilders[statement.tag]?.(node, statement, ordinal, file);
}

function schemaObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = readString(node.schemaname);
  return name ? [makeObject({ kind: "schema", name }, statement.text, ordinal, file)] : undefined;
}

function extensionObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = readString(node.extname);
  if (!name) {
    return;
  }
  const schema = extensionSchemaOption(node.options);
  return [
    makeObject(
      { kind: "extension", name },
      statement.text,
      ordinal,
      file,
      schema ? { schema } : {}
    ),
  ];
}

function enumObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = qualifiedName(node.typeName);
  return name
    ? [
        makeObject({ kind: "enum", ...name }, statement.text, ordinal, file, {
          values: stringList(node.vals),
        }),
      ]
    : undefined;
}

function tableObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined,
  existingConstraintNames: Iterable<string> = []
): SchemaObject[] | undefined {
  const name = rangeVarName(node.relation);
  if (!name) {
    return;
  }
  const tableSql =
    stripDeclaredConstraints(node, statement.text, statement.byteStart) ?? statement.text;
  const objects = [
    makeObject(
      { kind: "table", ...name },
      tableSql,
      ordinal,
      file,
      tableMetadataFromAst(node, statement.text, statement.byteStart)
    ),
  ];

  for (const [index, synthesized] of tableConstraintSyntheses(
    node,
    statement.text,
    statement.byteStart,
    existingConstraintNames
  ).entries()) {
    objects.push(
      makeObject(
        { kind: "constraint", name: synthesized.name, schema: name.schema, table: name.name },
        synthesized.sql,
        ordinal + 1 + index,
        file,
        synthesized.metadata
      )
    );
  }
  return objects;
}

function constraintNameState(
  existingObjects: readonly SchemaObject[] | undefined
): ConstraintNamesBySchema {
  const names: ConstraintNamesBySchema = new Map();
  recordConstraintNames(existingObjects ?? [], names);
  return names;
}

function recordConstraintNames(
  objects: readonly SchemaObject[],
  names: ConstraintNamesBySchema
): void {
  for (const object of objects) {
    if (object.ref.kind !== "constraint") {
      continue;
    }
    const schema = object.ref.schema ?? "public";
    const schemaNames = names.get(schema) ?? new Set<string>();
    schemaNames.add(object.ref.name);
    names.set(schema, schemaNames);
  }
}

function sequenceOwnedByObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = rangeVarName(node.sequence);
  const ownedBy = sequenceOwnedByOption(node.options);
  if (!(name && ownedBy !== undefined)) {
    return;
  }

  return [
    makeObject({ kind: "sequence", ...name }, statement.text, ordinal, file, {
      sequenceOwnedByAmendment: { ownedBy },
    }),
  ];
}

function foreignTableObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = rangeVarName(asRecord(node.base)?.relation);
  if (!name) {
    return;
  }
  const server = readString(node.servername);
  return [
    makeObject(
      { kind: "foreign-table", ...name },
      statement.text,
      ordinal,
      file,
      server ? { server } : {}
    ),
  ];
}

function indexObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const tableName = rangeVarName(node.relation);
  const indexName = readString(node.idxname);
  if (!(tableName && indexName)) {
    return;
  }
  return [
    makeObject(
      {
        kind: "index",
        name: indexName,
        schema: tableName.schema,
        table: tableName.name,
      },
      statement.text,
      ordinal,
      file,
      indexMetadataFromAst(node, tableName)
    ),
  ];
}

function indexMetadataFromAst(
  node: AstNode,
  tableName: { name: string; schema: string }
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { concurrent: readBoolean(node.concurrent) };
  const columns = indexColumnDependencies(node, tableName);
  if (columns.length > 0) {
    metadata.columnDependencies = columns;
  }
  return metadata;
}

function indexColumnDependencies(
  node: AstNode,
  tableName: { name: string; schema: string }
): string[] {
  const columns = new Set<string>();
  for (const item of [...readArray(node.indexParams), ...readArray(node.indexIncludingParams)]) {
    const element = asRecord(asRecord(item)?.IndexElem);
    const directColumn = readString(element?.name);
    if (directColumn) {
      columns.add(directColumn);
    }
    for (const column of collectColumnReferences(element?.expr)) {
      columns.add(column);
    }
  }
  for (const column of collectColumnReferences(node.whereClause)) {
    columns.add(column);
  }
  return [...columns]
    .map((column) => `${tableName.schema}.${tableName.name}.${column}`)
    .sort((left, right) => left.localeCompare(right));
}

function functionObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const identity = functionIdentity(node.funcname, node.parameters);
  if (!identity) {
    return;
  }
  const kind: ObjectKind = readBoolean(node.is_procedure) ? "procedure" : "function";
  return [makeObject({ kind, ...identity }, statement.text, ordinal, file)];
}

function materializedViewObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  if (readString(node.objtype) !== "OBJECT_MATVIEW") {
    return;
  }
  const into = asRecord(node.into);
  const name = rangeVarName(into?.rel);
  return name
    ? [
        makeObject({ kind: "materialized-view", ...name }, statement.text, ordinal, file, {
          withNoData: readBoolean(into?.skipData),
        }),
      ]
    : undefined;
}

function triggerObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  return tableScopedObject("trigger", node.relation, node.trigname, statement, ordinal, file);
}

function policyObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const tableName = rangeVarName(node.table);
  const name = readString(node.policy_name);
  return tableName && name
    ? [
        makeObject(
          {
            kind: "policy",
            name,
            schema: tableName.schema,
            table: tableName.name,
          },
          statement.text,
          ordinal,
          file,
          policyMetadataFromAst(node)
        ),
      ]
    : undefined;
}

function defaultPrivilegeObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  return defaultPrivilegesFromAst(node, statement.text, ordinal, file);
}

function commentObjects(
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const object = commentObjectFromAst(node, statement.text, ordinal, file);
  if (!object) {
    return;
  }
  const description = object.metadata.description;
  return isInitdbDefaultComment(
    String(object.metadata.descriptor ?? ""),
    typeof description === "string" ? description : null
  )
    ? []
    : [object];
}

function singleNamedObject(
  kind: ObjectKind,
  name: string | undefined,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  return name ? [makeObject({ kind, name }, statement.text, ordinal, file)] : undefined;
}

function singleQualifiedObject(
  kind: ObjectKind,
  value: unknown,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = qualifiedName(value);
  return name ? [makeObject({ kind, ...name }, statement.text, ordinal, file)] : undefined;
}

function singleRangeVarObject(
  kind: ObjectKind,
  value: unknown,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const name = rangeVarName(value);
  return name ? [makeObject({ kind, ...name }, statement.text, ordinal, file)] : undefined;
}

function tableScopedObject(
  kind: ObjectKind,
  tableValue: unknown,
  nameValue: unknown,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const tableName = rangeVarName(tableValue);
  const name = readString(nameValue);
  return tableName && name
    ? [
        makeObject(
          {
            kind,
            name,
            schema: tableName.schema,
            table: tableName.name,
          },
          statement.text,
          ordinal,
          file
        ),
      ]
    : undefined;
}

function referencedSchemas(statement: AstStatement): string[] {
  const schemas = new Set<string>();
  for (const reference of collectReferences(statement.node)) {
    const separator = reference.indexOf(".");
    if (separator > 0) {
      schemas.add(reference.slice(0, separator));
    }
  }
  return [...schemas].sort((left, right) => left.localeCompare(right));
}
