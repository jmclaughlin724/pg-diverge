import { resolveConfig } from "../config.js";
import type {
  Diagnostic,
  ExtractOptions,
  ObjectKind,
  ObjectRef,
  SchemaObject,
  SupaschemaConfig,
} from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstNode, AstStatement } from "./ast.js";
import {
  asRecord,
  astStatements,
  collectReferences,
  functionIdentity,
  qualifiedName,
  rangeVarName,
  readArray,
  readBoolean,
  readString,
  stringList,
} from "./ast.js";
import type { ParseStatementResult } from "./extract-helpers.js";
import {
  alterTableObjects,
  extensionSchemaOption,
  sequenceOwnedByOption,
  supabaseViewSecurityDiagnostics,
  withManagedSchemaDiagnostics,
} from "./extract-helpers.js";
import { finalizeObjects } from "./facts.js";
import { parseSqlAst } from "./parser.js";
import { policyMetadataFromAst } from "./policies.js";
import {
  commentObjectFromAst,
  defaultPrivilegesFromAst,
  grantObjectsFromAst,
} from "./privileges.js";
import { makeObject, tableMetadataFromAst } from "./statements.js";
import { stripDeclaredConstraints, tableConstraintSyntheses } from "./table-constraints.js";

type ExtractObjectsOptions = ExtractOptions & {
  file?: string;
  startOrdinal?: number;
};

interface ExtractObjectsResult {
  diagnostics: Diagnostic[];
  nextOrdinal: number;
  objects: SchemaObject[];
}

const sideEffectTags = new Set([
  "CallStmt",
  "DeleteStmt",
  "DoStmt",
  "InsertStmt",
  "RefreshMatViewStmt",
  "SelectStmt",
  "UpdateStmt",
]);

const ignoredTags = new Set(["TransactionStmt"]);

type ObjectBuilder = (
  node: AstNode,
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
) => SchemaObject[] | undefined;

const objectBuilders: Partial<Record<string, ObjectBuilder>> = {
  AlterDefaultPrivilegesStmt: defaultPrivilegeObjects,
  AlterSeqStmt: sequenceOwnedByObjects,
  AlterTableStmt: (node, statement, ordinal, file) =>
    alterTableObjects(node, statement.text, ordinal, file),
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
  CreateStmt: tableObjects,
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
    if (statement.text.length === 0 || ignoredTags.has(statement.tag)) {
      continue;
    }
    const parsed = parseStatement(statement, ordinal, config, options.file);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.objects.length > 0) {
      const references = await statementReferences(statement);
      for (const object of parsed.objects) {
        object.dependencies = [...references]
          .filter((reference) => reference !== objectIdentity(object.ref))
          .sort((left, right) => left.localeCompare(right));
      }
      diagnostics.push(
        ...(await finalizeObjects(parsed.objects, { normalize: config.normalize === "deparse" }))
      );
      diagnostics.push(...supabaseViewSecurityDiagnostics(parsed.objects, config));
    }
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
  file: string | undefined
): ParseStatementResult {
  if (sideEffectTags.has(statement.tag)) {
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
  const objects = buildObjects(statement, ordinal, file);
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
  return withManagedSchemaDiagnostics(objects, statement.text, config, file);
}

function buildObjects(
  statement: AstStatement,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return;
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
  file: string | undefined
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
    statement.byteStart
  ).entries()) {
    objects.push(
      makeObject(
        { kind: "constraint", name: synthesized.name, schema: name.schema, table: name.name },
        synthesized.sql,
        ordinal + 1 + index,
        file
      )
    );
  }
  return objects;
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
      { concurrent: readBoolean(node.concurrent) }
    ),
  ];
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
  return object ? [object] : undefined;
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

async function statementReferences(statement: AstStatement): Promise<Set<string>> {
  const references = collectReferences(statement.node);
  if (statement.tag === "CreateFunctionStmt") {
    const node = asRecord(statement.node.CreateFunctionStmt);
    for (const body of functionBodyStrings(node?.options)) {
      const parsedBody = await parseSqlAst(body);
      if (parsedBody.ast !== undefined) {
        collectReferences(parsedBody.ast, references);
      }
    }
  }
  return references;
}

function functionBodyStrings(options: unknown): string[] {
  const bodies: string[] = [];
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "as") {
      continue;
    }
    bodies.push(...stringList(defElem?.arg));
  }
  return bodies;
}

function objectIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}
