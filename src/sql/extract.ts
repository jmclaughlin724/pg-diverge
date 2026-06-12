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
import type { AstStatement } from "./ast.js";
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

type ExtractObjectsResult = {
  diagnostics: Diagnostic[];
  nextOrdinal: number;
  objects: SchemaObject[];
};

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

export async function extractObjectsFromSql(
  sql: string,
  options: ExtractObjectsOptions = {},
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
          { file: options.file },
        ),
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
        ...(await finalizeObjects(parsed.objects, { normalize: config.normalize === "deparse" })),
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
  file: string | undefined,
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
          },
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
          },
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
  file: string | undefined,
): SchemaObject[] | undefined {
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return undefined;
  }
  switch (statement.tag) {
    case "CreateSchemaStmt": {
      const name = readString(node.schemaname);
      return name
        ? [makeObject({ kind: "schema", name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateExtensionStmt": {
      const name = readString(node.extname);
      if (!name) {
        return undefined;
      }
      const schema = extensionSchemaOption(node.options);
      return [
        makeObject(
          { kind: "extension", name },
          statement.text,
          ordinal,
          file,
          schema ? { schema } : {},
        ),
      ];
    }
    case "CreateEnumStmt": {
      const name = qualifiedName(node.typeName);
      if (!name) {
        return undefined;
      }
      const values = stringList(node.vals);
      return [makeObject({ kind: "enum", ...name }, statement.text, ordinal, file, { values })];
    }
    case "CreateDomainStmt": {
      const name = qualifiedName(node.domainname);
      return name
        ? [makeObject({ kind: "domain", ...name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CompositeTypeStmt": {
      const name = rangeVarName(node.typevar);
      return name
        ? [makeObject({ kind: "type", ...name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateRangeStmt": {
      const name = qualifiedName(node.typeName);
      return name
        ? [makeObject({ kind: "type", ...name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateStmt": {
      const name = rangeVarName(node.relation);
      if (!name) {
        return undefined;
      }
      const tableSql =
        stripDeclaredConstraints(node, statement.text, statement.byteStart) ?? statement.text;
      const objects = [
        makeObject(
          { kind: "table", ...name },
          tableSql,
          ordinal,
          file,
          tableMetadataFromAst(node, statement.text, statement.byteStart),
        ),
      ];
      // In-CREATE constraints surface as their own constraint objects so table
      // identity stays independent of where a constraint is declared; the
      // table object's SQL is rebuilt columns-only to match the catalog lane.
      for (const [index, synthesized] of tableConstraintSyntheses(
        node,
        statement.text,
        statement.byteStart,
      ).entries()) {
        objects.push(
          makeObject(
            { kind: "constraint", name: synthesized.name, schema: name.schema, table: name.name },
            synthesized.sql,
            ordinal + 1 + index,
            file,
          ),
        );
      }
      return objects;
    }
    case "CreateSeqStmt": {
      const name = rangeVarName(node.sequence);
      return name
        ? [makeObject({ kind: "sequence", ...name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "AlterSeqStmt": {
      const name = rangeVarName(node.sequence);
      if (!name) {
        return undefined;
      }
      const ownedBy = sequenceOwnedByOption(node.options);
      if (ownedBy === undefined) {
        return undefined;
      }
      // Folded into the owning sequence's canonical shape at model assembly.
      return [
        makeObject({ kind: "sequence", ...name }, statement.text, ordinal, file, {
          sequenceOwnedByAmendment: { ownedBy },
        }),
      ];
    }
    case "CreateFdwStmt": {
      const name = readString(node.fdwname);
      return name
        ? [makeObject({ kind: "foreign-data-wrapper", name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateForeignServerStmt": {
      const name = readString(node.servername);
      return name
        ? [makeObject({ kind: "foreign-server", name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateForeignTableStmt": {
      const name = rangeVarName(asRecord(node.base)?.relation);
      if (!name) {
        return undefined;
      }
      const server = readString(node.servername);
      return [
        makeObject(
          { kind: "foreign-table", ...name },
          statement.text,
          ordinal,
          file,
          server ? { server } : {},
        ),
      ];
    }
    case "IndexStmt": {
      const tableName = rangeVarName(node.relation);
      const indexName = readString(node.idxname);
      if (!tableName || !indexName) {
        return undefined;
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
          { concurrent: readBoolean(node.concurrent) },
        ),
      ];
    }
    case "CreateFunctionStmt": {
      const identity = functionIdentity(node.funcname, node.parameters);
      if (!identity) {
        return undefined;
      }
      const kind: ObjectKind = readBoolean(node.is_procedure) ? "procedure" : "function";
      return [makeObject({ kind, ...identity }, statement.text, ordinal, file)];
    }
    case "ViewStmt": {
      const name = rangeVarName(node.view);
      return name
        ? [makeObject({ kind: "view", ...name }, statement.text, ordinal, file)]
        : undefined;
    }
    case "CreateTableAsStmt": {
      if (readString(node.objtype) !== "OBJECT_MATVIEW") {
        return undefined;
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
    case "CreateTrigStmt": {
      const tableName = rangeVarName(node.relation);
      const triggerName = readString(node.trigname);
      if (!tableName || !triggerName) {
        return undefined;
      }
      return [
        makeObject(
          {
            kind: "trigger",
            name: triggerName,
            schema: tableName.schema,
            table: tableName.name,
          },
          statement.text,
          ordinal,
          file,
        ),
      ];
    }
    case "CreatePolicyStmt": {
      const tableName = rangeVarName(node.table);
      const policyName = readString(node.policy_name);
      if (!tableName || !policyName) {
        return undefined;
      }
      return [
        makeObject(
          {
            kind: "policy",
            name: policyName,
            schema: tableName.schema,
            table: tableName.name,
          },
          statement.text,
          ordinal,
          file,
        ),
      ];
    }
    case "AlterTableStmt":
      return alterTableObjects(node, statement.text, ordinal, file);
    case "GrantStmt":
      return grantObjectsFromAst(node, statement.text, ordinal, file);
    case "AlterDefaultPrivilegesStmt":
      return defaultPrivilegesFromAst(node, statement.text, ordinal, file);
    case "CommentStmt": {
      const object = commentObjectFromAst(node, statement.text, ordinal, file);
      return object ? [object] : undefined;
    }
    default:
      return undefined;
  }
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
