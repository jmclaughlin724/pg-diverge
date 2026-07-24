import { deparseSync } from "pgsql-deparser";
import { diagnostic } from "../diagnostics/diagnostics.js";
import type { Diagnostic, ObjectRef, SchemaObject } from "../types.js";
import type { AstNode } from "./ast.js";
import {
  asRecord,
  astStatements,
  rangeVarName,
  readArray,
  readBoolean,
  readNumber,
  readString,
  stringList,
  stringValue,
  typeNameToSql,
} from "./ast.js";
import {
  canonicalIndexNode,
  canonicalPolicyNode,
  canonicalRoutineNode,
  canonicalViewNode,
} from "./canonical-nodes.js";
import { quoteIdent } from "./identifiers.js";
import { normalizeObjectSql } from "./normalize-deparse.js";
import { astObjectHash, shapeHash, stripLocations } from "./object-hash.js";
import { parseSqlAst } from "./parser.js";
import { extractStatementDependencies } from "./routine-dependencies.js";
import {
  canonicalConstraintShape,
  canonicalSequenceShape,
  canonicalTableShape,
} from "./table-shape.js";

export interface RenderGuardFacts {
  guard: "ifNotExists" | "orReplace";
  offset?: number;
  present: boolean;
}

export interface RoutineReturnFacts {
  setof: boolean;
  type: string;
}

export interface RoutineOutParamFacts {
  mode: string;
  name: string;
  type: string;
}

interface KeywordStep {
  optional?: boolean;
  words: string[];
}

const ifNotExistsSteps: Record<string, KeywordStep[]> = {
  CreateExtensionStmt: [{ words: ["CREATE"] }, { words: ["EXTENSION"] }],
  CreateForeignServerStmt: [{ words: ["CREATE"] }, { words: ["SERVER"] }],
  CreateForeignTableStmt: [{ words: ["CREATE"] }, { words: ["FOREIGN"] }, { words: ["TABLE"] }],
  CreateSchemaStmt: [{ words: ["CREATE"] }, { words: ["SCHEMA"] }],
  CreateSeqStmt: [
    { words: ["CREATE"] },
    { optional: true, words: ["UNLOGGED", "TEMP", "TEMPORARY"] },
    { words: ["SEQUENCE"] },
  ],
  CreateStmt: [
    { words: ["CREATE"] },
    { optional: true, words: ["GLOBAL", "LOCAL"] },
    { optional: true, words: ["UNLOGGED", "TEMP", "TEMPORARY"] },
    { words: ["TABLE"] },
  ],
  CreateTableAsStmt: [{ words: ["CREATE"] }, { words: ["MATERIALIZED"] }, { words: ["VIEW"] }],
  IndexStmt: [
    { words: ["CREATE"] },
    { optional: true, words: ["UNIQUE"] },
    { words: ["INDEX"] },
    { optional: true, words: ["CONCURRENTLY"] },
  ],
};

const orReplaceTags = new Set(["CreateFunctionStmt", "ViewStmt"]);

const finalizeConcurrency = 8;

export interface FinalizeOptions {
  normalize?: boolean;
}

export async function finalizeObjects(
  objects: SchemaObject[],
  options: FinalizeOptions = {}
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (let start = 0; start < objects.length; start += finalizeConcurrency) {
    const batch = objects.slice(start, start + finalizeConcurrency);
    const results = await Promise.all(batch.map((object) => finalizeObject(object, options)));
    for (const result of results) {
      diagnostics.push(...result);
    }
  }
  return diagnostics;
}

export async function finalizeObject(
  object: SchemaObject,
  options: FinalizeOptions = {}
): Promise<Diagnostic[]> {
  const parsed = await parseSqlAst(object.sql, object.file);
  let statements = parsed.ast === undefined ? [] : astStatements(parsed.ast, object.sql);
  if (!statements[0]) {
    return [
      ...parsed.diagnostics,
      diagnostic(
        "SUPA_OBJECT_PARSE_FAILED",
        "error",
        `object SQL for ${object.key} did not parse; object identity fell back to text`,
        { file: object.file, ref: object.ref, statement: object.sql }
      ),
    ];
  }
  const diagnostics: Diagnostic[] = [];
  if (options.normalize === true) {
    const normalized = await normalizeObjectSql(object, parsed.ast);
    diagnostics.push(...normalized.diagnostics);
    if (normalized.sql !== undefined && normalized.statements !== undefined) {
      object.sql = normalized.sql;
      statements = normalized.statements;
    }
  }
  const first = statements[0];
  if (!first) {
    return diagnostics;
  }
  const dependency = await extractStatementDependencies(first, object.file);
  diagnostics.push(...dependency.diagnostics);
  applyStatementDependencies(object, dependency);
  object.hash = canonicalHash(object, statements);
  Object.assign(object.metadata, statementFacts(first.tag, first.node, object.sql));
  await assignRoutineCatalogTypecheckSql(object);
  return diagnostics;
}

type StatementDependency = Awaited<ReturnType<typeof extractStatementDependencies>>;

function applyStatementDependencies(object: SchemaObject, dependency: StatementDependency): void {
  const identity = objectIdentity(object.ref);
  object.dependencies = [...new Set([...object.dependencies, ...dependency.references])]
    .filter((reference) => reference !== identity)
    .sort((left, right) => left.localeCompare(right));
  const columnDependencies = [
    ...metadataStrings(object.metadata.columnDependencies),
    ...dependency.columnReferences,
  ];
  if (columnDependencies.length > 0) {
    object.metadata.columnDependencies = [...new Set(columnDependencies)].sort((left, right) =>
      left.localeCompare(right)
    );
  }
  if (dependency.routine && isRoutineObject(object)) {
    object.metadata.routineDependencyConfidence = dependency.routine.confidence;
    object.metadata.routineDependencies = dependency.routine.references;
    object.metadata.routineColumnDependencies = dependency.routine.columnReferences;
  }
}

function isRoutineObject(object: SchemaObject): boolean {
  return object.ref.kind === "function" || object.ref.kind === "procedure";
}

function metadataStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

function canonicalHash(object: SchemaObject, statements: { node: AstNode; tag: string }[]): string {
  const first = statements[0];
  const statementShapeHash = canonicalStatementShapeHash(object, first, statements);
  if (statementShapeHash !== undefined) {
    return statementShapeHash;
  }
  const objectKindHash = canonicalObjectKindHash(object, statements);
  if (objectKindHash !== undefined) {
    return objectKindHash;
  }
  return astObjectHash(
    statements.map((item) => item.node),
    object.key,
    object.ref
  );
}

function canonicalStatementShapeHash(
  object: SchemaObject,
  first: { node: AstNode; tag: string } | undefined,
  statements: { node: AstNode; tag: string; text?: string }[]
): string | undefined {
  if (first?.tag === "CreateStmt") {
    return tableShapeHash(object, asRecord(first.node.CreateStmt), statements);
  }
  if (first?.tag === "CreateSeqStmt") {
    return sequenceShapeHash(object, asRecord(first.node.CreateSeqStmt));
  }
  if (object.ref.kind === "constraint" && first?.tag === "AlterTableStmt") {
    return constraintShapeHash(object, asRecord(first.node.AlterTableStmt));
  }
}

function tableShapeHash(
  object: SchemaObject,
  createStmt: AstNode | undefined,
  statements: { node: AstNode; tag: string; text?: string }[]
): string | undefined {
  if (!createStmt) {
    return;
  }
  let shape = canonicalTableShape(createStmt);
  const partition = tablePartitionAttachment(object, statements);
  if (partition !== undefined) {
    shape = {
      ...shape,
      inhRelations: [
        {
          RangeVar: {
            ...(partition.parent.schema ? { schemaname: partition.parent.schema } : {}),
            inh: true,
            relname: partition.parent.name,
            relpersistence: "p",
          },
        },
      ],
      partbound: stripLocations(partition.bound),
    };
    object.metadata.partitionAttachSql = partition.sql;
  }

  object.metadata.canonicalShape = shape;
  return shapeHash(shape, object.key, object.ref);
}

function tablePartitionAttachment(
  object: SchemaObject,
  statements: { node: AstNode; tag: string; text?: string }[]
):
  | {
      bound: unknown;
      parent: { name: string; schema: string };
      sql: string;
    }
  | undefined {
  if (object.ref.kind !== "table") {
    return;
  }
  for (const statement of statements) {
    if (statement.tag !== "AlterTableStmt") {
      continue;
    }
    const alter = asRecord(statement.node.AlterTableStmt);
    const parent = rangeVarName(alter?.relation);
    if (!parent) {
      continue;
    }
    for (const rawCommand of readArray(alter?.cmds)) {
      const command = asRecord(asRecord(rawCommand)?.AlterTableCmd);
      if (readString(command?.subtype) !== "AT_AttachPartition") {
        continue;
      }
      const partition = asRecord(asRecord(command?.def)?.PartitionCmd);
      const child = rangeVarName(partition?.name);
      if (child?.name !== object.ref.name || child.schema !== (object.ref.schema ?? "public")) {
        continue;
      }
      return {
        bound: partition?.bound ?? null,
        parent,
        sql: statement.text ?? object.sql,
      };
    }
  }
}

function sequenceShapeHash(
  object: SchemaObject,
  createSeqStmt: AstNode | undefined
): string | undefined {
  if (!createSeqStmt) {
    return;
  }
  const shape = canonicalSequenceShape(createSeqStmt);

  object.metadata.canonicalShape = shape;
  return shapeHash(shape, object.key, object.ref);
}

function constraintShapeHash(
  object: SchemaObject,
  alterTableStmt: AstNode | undefined
): string | undefined {
  const constraintNode = addConstraintNode(alterTableStmt);
  if (!constraintNode) {
    return;
  }
  return shapeHash(
    canonicalConstraintShape(constraintNode, {
      name: object.ref.table ?? "",
      schema: object.ref.schema ?? "public",
    }),
    object.key,
    object.ref
  );
}

function canonicalObjectKindHash(
  object: SchemaObject,
  statements: { node: AstNode; tag: string }[]
): string | undefined {
  if (object.ref.kind === "index") {
    return astObjectHash(
      statements.map((item) => canonicalIndexNode(item.node)),
      object.key,
      object.ref
    );
  }
  if (object.ref.kind === "function" || object.ref.kind === "procedure") {
    return astObjectHash(
      statements.map((item) => canonicalRoutineNode(item.node)),
      object.key,
      object.ref
    );
  }
  if (object.ref.kind === "grant") {
    return grantHash(object);
  }
  if (object.ref.kind === "default-privilege") {
    return defaultPrivilegeHash(object);
  }
  if (object.ref.kind === "rls") {
    return rlsHash(object, statements);
  }
  if (object.ref.kind === "policy") {
    return policyHash(object, statements);
  }
  if (object.ref.kind === "comment") {
    return commentHash(object);
  }
  if (object.ref.kind === "view" || object.ref.kind === "materialized-view") {
    return viewHash(object, statements);
  }
}

function grantHash(object: SchemaObject): string {
  return shapeHash(
    {
      columnPrivileges: object.metadata.columnPrivileges ?? null,
      grantee: String(object.metadata.grantee ?? ""),
      kindPhrase: String(object.metadata.kindPhrase ?? ""),
      privileges: Array.isArray(object.metadata.privileges) ? object.metadata.privileges : [],
      targetIdentity: String(object.metadata.targetIdentity ?? ""),
      verb: String(object.metadata.verb ?? ""),
      withGrantOption: object.metadata.withGrantOption === true,
    },
    object.key,
    object.ref
  );
}

function defaultPrivilegeHash(object: SchemaObject): string {
  return shapeHash(
    {
      forRole: String(object.metadata.forRole ?? ""),
      grantee: String(object.metadata.grantee ?? ""),
      objectType: String(object.metadata.objectType ?? ""),
      privileges: Array.isArray(object.metadata.privileges) ? object.metadata.privileges : [],
      schema: String(object.metadata.schema ?? ""),
      verb: String(object.metadata.verb ?? ""),
    },
    object.key,
    object.ref
  );
}

function rlsHash(object: SchemaObject, statements: { node: AstNode; tag: string }[]): string {
  return astObjectHash(
    statements.map((item) => {
      const cloned = structuredClone(item.node);
      const alterTable = asRecord(cloned.AlterTableStmt);
      const relation = asRecord(alterTable?.relation);
      if (alterTable && relation) {
        return {
          ...cloned,
          AlterTableStmt: {
            ...alterTable,
            relation: { ...relation, inh: true },
          },
        };
      }
      return cloned;
    }),
    object.key,
    object.ref
  );
}

function policyHash(object: SchemaObject, statements: { node: AstNode; tag: string }[]): string {
  return astObjectHash(
    statements.map((item) => canonicalPolicyNode(item.node)),
    object.key,
    object.ref
  );
}

function commentHash(object: SchemaObject): string {
  return shapeHash(
    {
      description: object.metadata.description ?? null,
      descriptor: String(object.metadata.descriptor ?? ""),
    },
    object.key,
    object.ref
  );
}

function viewHash(object: SchemaObject, statements: { node: AstNode; tag: string }[]): string {
  const viewNode = asRecord(statements[0]?.node.ViewStmt);
  const facts = viewNode ? viewFacts(viewNode) : object.metadata;
  return shapeHash(
    {
      node: stripLocations(statements.map((item) => canonicalViewNode(item.node, []))),
      securityInvoker: facts.securityInvoker ?? null,
      viewColumns: Array.isArray(facts.viewColumns) ? facts.viewColumns : [],
    },
    object.key,
    object.ref
  );
}

function addConstraintNode(alterTableStmt: AstNode | undefined): AstNode | undefined {
  for (const item of readArray(alterTableStmt?.cmds)) {
    const command = asRecord(asRecord(item)?.AlterTableCmd);
    if (readString(command?.subtype) !== "AT_AddConstraint") {
      continue;
    }
    const constraint = asRecord(asRecord(command?.def)?.Constraint);
    if (constraint) {
      return constraint;
    }
  }
}

export function statementFacts(
  tag: string,
  statementNode: AstNode,
  sql: string
): Record<string, unknown> {
  const node = asRecord(statementNode[tag]) ?? {};
  const facts: Record<string, unknown> = {};
  const render = renderGuardFacts(tag, node, sql);
  if (render) {
    facts.render = render;
  }
  if (tag === "CreateFunctionStmt") {
    Object.assign(facts, functionFacts(node));
  }
  if (tag === "ViewStmt") {
    Object.assign(facts, viewFacts(node));
  }
  if (tag === "CommentStmt") {
    const dropSql = commentDropSql(node);
    if (dropSql !== undefined) {
      facts.commentDropSql = dropSql;
    }
  }
  return facts;
}

function commentDropSql(node: AstNode): string | undefined {
  try {
    const cloned = asRecord(structuredClone(node));
    if (!cloned) {
      return;
    }
    const { comment: _comment, ...stripped } = cloned;
    return deparseSync(
      JSON.parse(
        JSON.stringify({
          stmts: [{ stmt: { CommentStmt: stripped } }],
          version: 170_004,
        })
      )
    );
  } catch {
    // Unrenderable guard SQL has no facts to contribute.
  }
}

function renderGuardFacts(tag: string, node: AstNode, sql: string): RenderGuardFacts | undefined {
  if (tag === "CreateTableAsStmt" && readString(node.objtype) !== "OBJECT_MATVIEW") {
    return;
  }
  const steps = ifNotExistsSteps[tag];
  if (steps) {
    const flagNode = tag === "CreateForeignTableStmt" ? (asRecord(node.base) ?? node) : node;
    const facts: RenderGuardFacts = {
      guard: "ifNotExists",
      present: readBoolean(flagNode.if_not_exists),
    };
    const offset = keywordOffset(sql, steps);
    if (offset !== undefined) {
      facts.offset = offset;
    }
    return facts;
  }
  if (orReplaceTags.has(tag)) {
    const facts: RenderGuardFacts = {
      guard: "orReplace",
      present: readBoolean(node.replace),
    };
    const offset = keywordOffset(sql, [{ words: ["CREATE"] }]);
    if (offset !== undefined) {
      facts.offset = offset;
    }
    return facts;
  }
}

function functionFacts(node: AstNode): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const language = functionLanguage(node.options);
  if (language) {
    facts.routineLanguage = language.toLowerCase();
  }
  const body = functionBody(node.options);
  if (body) {
    facts.routineBody = body.text;
    facts.routineBodyAsOffset = body.asOffset;
  }
  const returnType = asRecord(node.returnType);
  if (returnType) {
    const returns: RoutineReturnFacts = {
      setof: readBoolean(returnType.setof),
      type: typeNameToSql(node.returnType),
    };
    facts.returns = returns;
  }
  const outParams: RoutineOutParamFacts[] = [];
  for (const item of readArray(node.parameters)) {
    const parameter = asRecord(asRecord(item)?.FunctionParameter);
    if (!parameter) {
      continue;
    }
    const mode = readString(parameter.mode) ?? "FUNC_PARAM_DEFAULT";
    if (mode !== "FUNC_PARAM_OUT" && mode !== "FUNC_PARAM_INOUT" && mode !== "FUNC_PARAM_TABLE") {
      continue;
    }
    outParams.push({
      mode,
      name: readString(parameter.name) ?? "",
      type: typeNameToSql(parameter.argType),
    });
  }
  if (outParams.length > 0) {
    facts.outParams = outParams;
  }
  return facts;
}

function functionLanguage(options: unknown): string | undefined {
  for (const item of readArray(options)) {
    const option = asRecord(asRecord(item)?.DefElem);
    if (readString(option?.defname) !== "language") {
      continue;
    }
    return stringValue(option?.arg);
  }
}

function functionBody(options: unknown): { asOffset: number; text: string } | undefined {
  for (const item of readArray(options)) {
    const option = asRecord(asRecord(item)?.DefElem);
    if (readString(option?.defname) !== "as") {
      continue;
    }
    const body = stringValue(readArray(asRecord(asRecord(option?.arg)?.List)?.items)[0]);
    const asOffset = readNumber(option?.location);
    if (body !== undefined && asOffset !== undefined) {
      return { asOffset, text: body };
    }
  }
}

async function assignRoutineCatalogTypecheckSql(object: SchemaObject): Promise<void> {
  if (object.metadata.routineLanguage !== "sql") {
    return;
  }
  const body = object.metadata.routineBody;
  const asOffset = object.metadata.routineBodyAsOffset;
  if (typeof body !== "string" || typeof asOffset !== "number") {
    return;
  }
  const rewrittenBody = await quoteQualifiedSortColumns(body, object.file);
  if (rewrittenBody === body) {
    return;
  }
  const range = dollarQuotedFunctionBodyRange(object.sql, body, asOffset);
  if (!range) {
    return;
  }
  object.metadata.routineBodyForCatalogTypecheck = rewrittenBody;
  object.metadata.routineSqlForCatalogTypecheck = `${object.sql.slice(
    0,
    range.start
  )}${rewrittenBody}${object.sql.slice(range.end)}`;
}

async function quoteQualifiedSortColumns(sql: string, file: string | undefined): Promise<string> {
  const parsed = await parseSqlAst(sql, file);
  if (parsed.ast === undefined) {
    return sql;
  }
  const replacements: { end: number; start: number; text: string }[] = [];
  for (const statement of astStatements(parsed.ast, sql)) {
    const select = asRecord(statement.node.SelectStmt);
    if (!select) {
      continue;
    }
    for (const item of readArray(select.sortClause)) {
      const sortBy = asRecord(asRecord(item)?.SortBy);
      const columnRef = asRecord(asRecord(sortBy?.node)?.ColumnRef);
      const location = readNumber(columnRef?.location);
      const fields = readArray(columnRef?.fields)
        .map((field) => stringValue(field))
        .filter((field): field is string => field !== undefined);
      const replacement = sortColumnReplacement(sql, location, fields);
      if (replacement) {
        replacements.push(replacement);
      }
    }
  }
  return applyReplacements(sql, replacements);
}

function sortColumnReplacement(
  sql: string,
  byteOffset: number | undefined,
  fields: readonly string[]
): { end: number; start: number; text: string } | undefined {
  const column = fields.at(-1);
  if (byteOffset === undefined || fields.length < 2 || !column || !isLowercaseIdentifier(column)) {
    return;
  }
  const raw = fields.join(".");
  const start = stringIndexFromByteOffset(sql, byteOffset);
  if (sql.slice(start, start + raw.length) !== raw) {
    return;
  }
  const columnStart = start + raw.lastIndexOf(".") + 1;
  return {
    end: columnStart + column.length,
    start: columnStart,
    text: quoteIdent(column),
  };
}

function applyReplacements(
  sql: string,
  replacements: readonly { end: number; start: number; text: string }[]
): string {
  let output = sql;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(
      replacement.end
    )}`;
  }
  return output;
}

function dollarQuotedFunctionBodyRange(
  sql: string,
  body: string,
  asByteOffset: number
): { end: number; start: number } | undefined {
  const asIndex = stringIndexFromByteOffset(sql, asByteOffset);
  if (sql.slice(asIndex, asIndex + 2).toUpperCase() !== "AS") {
    return;
  }
  const tagStart = skipWhitespace(sql, asIndex + 2);
  const tag = dollarQuoteTagAt(sql, tagStart);
  if (!tag) {
    return;
  }
  const bodyStart = tagStart + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  if (bodyEnd < 0 || sql.slice(bodyStart, bodyEnd) !== body) {
    return;
  }
  return { end: bodyEnd, start: bodyStart };
}

function dollarQuoteTagAt(sql: string, start: number): string | undefined {
  if (sql[start] !== "$") {
    return;
  }
  let index = start + 1;
  while (index < sql.length && sql[index] !== "$") {
    const char = sql[index] ?? "";
    if (!isDollarTagChar(char)) {
      return;
    }
    index += 1;
  }
  return sql[index] === "$" ? sql.slice(start, index + 1) : undefined;
}

function stringIndexFromByteOffset(text: string, byteOffset: number): number {
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    if (bytes >= byteOffset) {
      return index;
    }
    bytes += Buffer.byteLength(char, "utf8");
    index += char.length;
  }
  return index;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && isWhitespace(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

function isDollarTagChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  );
}

function isLowercaseIdentifier(value: string): boolean {
  if (value.length === 0 || !isLowercaseIdentifierStart(value[0] ?? "")) {
    return false;
  }
  for (const char of value.slice(1)) {
    if (!isLowercaseIdentifierPart(char)) {
      return false;
    }
  }
  return true;
}

function isLowercaseIdentifierStart(char: string): boolean {
  return (char >= "a" && char <= "z") || char === "_";
}

function isLowercaseIdentifierPart(char: string): boolean {
  return isLowercaseIdentifierStart(char) || (char >= "0" && char <= "9");
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function viewFacts(node: AstNode): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const aliases = stringList(node.aliases);
  const columns = aliases.length > 0 ? aliases : viewTargetColumns(node.query);
  if (columns !== undefined) {
    facts.viewColumns = columns;
  }
  const castTypes = viewTargetCastTypes(node.query);
  if (columns !== undefined && castTypes !== undefined && castTypes.length === columns.length) {
    facts.viewColumnCastTypes = castTypes;
  }
  const securityInvoker = viewSecurityInvoker(node.options);
  if (securityInvoker !== undefined) {
    facts.securityInvoker = securityInvoker;
  }
  return facts;
}

function viewTargetColumns(query: unknown): string[] | undefined {
  const select = asRecord(asRecord(query)?.SelectStmt);
  return select ? selectOutputColumns(select) : undefined;
}

function viewTargetCastTypes(query: unknown): (string | null)[] | undefined {
  const select = asRecord(asRecord(query)?.SelectStmt);
  return select ? selectOutputCastTypes(select) : undefined;
}

function selectOutputCastTypes(select: AstNode): (string | null)[] | undefined {
  const larg = asRecord(select.larg);
  if (larg) {
    return selectOutputCastTypes(larg);
  }
  if (asRecord(select.rarg)) {
    return;
  }
  const castTypes: (string | null)[] = [];
  for (const item of readArray(select.targetList)) {
    const target = asRecord(asRecord(item)?.ResTarget);
    if (!target) {
      return;
    }
    const typeName = asRecord(asRecord(target.val)?.TypeCast)?.typeName;
    castTypes.push(typeName === undefined ? null : typeNameToSql(typeName));
  }
  return castTypes;
}

function selectOutputColumns(select: AstNode): string[] | undefined {
  const larg = asRecord(select.larg);
  if (larg) {
    return selectOutputColumns(larg);
  }
  if (asRecord(select.rarg)) {
    return;
  }
  const columns: string[] = [];
  for (const item of readArray(select.targetList)) {
    const target = asRecord(asRecord(item)?.ResTarget);
    if (!target) {
      return;
    }
    const explicit = readString(target.name);
    if (explicit) {
      columns.push(explicit);
      continue;
    }
    const fields = readArray(asRecord(asRecord(target.val)?.ColumnRef)?.fields);
    const name = stringValue(fields.at(-1));
    if (!name) {
      return;
    }
    columns.push(name);
  }
  return columns;
}

function viewSecurityInvoker(options: unknown): boolean | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname)?.toLowerCase() !== "security_invoker") {
      continue;
    }
    return defElemBoolean(defElem?.arg);
  }
}

function defElemBoolean(arg: unknown): boolean {
  if (arg === undefined || arg === null) {
    return true;
  }
  if (readBoolean(arg)) {
    return true;
  }
  const integer = asRecord(asRecord(arg)?.Integer);
  if (integer) {
    return (readNumber(integer.ival) ?? 0) !== 0;
  }
  const text = (stringValue(arg) ?? "").toLowerCase();
  return text === "true" || text === "on" || text === "1" || text === "yes";
}

export function keywordOffset(sql: string, steps: KeywordStep[]): number | undefined {
  let index = skipNonTokens(sql, 0);
  for (const step of steps) {
    const word = readWord(sql, index);
    if (word && step.words.some((candidate) => candidate === word.text.toUpperCase())) {
      index = skipNonTokens(sql, word.end);
      continue;
    }
    if (step.optional) {
      continue;
    }
    return;
  }
  return index;
}

function isWordStartChar(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isWordContinuationChar(char: string): boolean {
  return (char >= "0" && char <= "9") || char === "$";
}

function readWord(sql: string, start: number): { end: number; text: string } | undefined {
  let end = start;
  while (end < sql.length) {
    const char = sql[end] ?? "";
    if (!(isWordStartChar(char) || (end > start && isWordContinuationChar(char)))) {
      break;
    }
    end += 1;
  }
  if (end === start) {
    return;
  }
  return { end, text: sql.slice(start, end) };
}

function skipNonTokens(sql: string, start: number): number {
  let index = start;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    break;
  }
  return index;
}
