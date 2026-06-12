import { deparseSync } from "pgsql-deparser";
import type { Diagnostic, SchemaObject } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstNode } from "./ast.js";
import {
  asRecord,
  astStatements,
  readArray,
  readBoolean,
  readNumber,
  readString,
  stringList,
  stringValue,
  typeNameToSql,
} from "./ast.js";
import { canonicalPolicyNode, canonicalViewNode } from "./canonical-nodes.js";
import { normalizeObjectSql } from "./normalize-deparse.js";
import { astObjectHash, shapeHash } from "./object-hash.js";
import { parseSqlAst } from "./parser.js";
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

type KeywordStep = { optional?: boolean; words: string[] };

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
  options: FinalizeOptions = {},
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
  options: FinalizeOptions = {},
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
        { file: object.file, ref: object.ref, statement: object.sql },
      ),
    ];
  }
  const diagnostics: Diagnostic[] = [];
  if (options.normalize === true) {
    // Deparse-normalization is fidelity-gated: the canonical text is used
    // only when it reparses to the identical location-stripped tree, so
    // hashes are unchanged and a deparser gap degrades to the source text.
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
  object.hash = canonicalHash(object, statements);
  Object.assign(object.metadata, statementFacts(first.tag, first.node, object.sql));
  return diagnostics;
}

function canonicalHash(object: SchemaObject, statements: { node: AstNode; tag: string }[]): string {
  const first = statements[0];
  if (first?.tag === "CreateStmt") {
    const createStmt = asRecord(first.node.CreateStmt);
    if (createStmt) {
      const shape = canonicalTableShape(createStmt);
      // Carried so the planner can diff per-column instead of replacing the
      // whole table when only column facts change.
      object.metadata.canonicalShape = shape;
      return shapeHash(shape, object.key, object.ref);
    }
  }
  if (first?.tag === "CreateSeqStmt") {
    const createSeqStmt = asRecord(first.node.CreateSeqStmt);
    if (createSeqStmt) {
      const shape = canonicalSequenceShape(createSeqStmt);
      // Carried so a standalone ALTER SEQUENCE ... OWNED BY (the pg_dump
      // serial decomposition) can fold into the sequence's identity.
      object.metadata.canonicalShape = shape;
      return shapeHash(shape, object.key, object.ref);
    }
  }
  if (object.ref.kind === "constraint" && first?.tag === "AlterTableStmt") {
    const constraintNode = addConstraintNode(asRecord(first.node.AlterTableStmt));
    if (constraintNode) {
      return shapeHash(
        canonicalConstraintShape(constraintNode, {
          name: object.ref.table ?? "",
          schema: object.ref.schema ?? "public",
        }),
        object.key,
        object.ref,
      );
    }
  }
  if (object.ref.kind === "default-privilege") {
    // Hash from the builder-normalized shape, not the statement AST: the
    // FOR ROLE clause names the executing role and must not affect identity
    // or content equality across lanes.
    return shapeHash(
      {
        grantee: String(object.metadata.grantee ?? ""),
        objectType: String(object.metadata.objectType ?? ""),
        privileges: Array.isArray(object.metadata.privileges) ? object.metadata.privileges : [],
        schema: String(object.metadata.schema ?? ""),
        verb: String(object.metadata.verb ?? ""),
      },
      object.key,
      object.ref,
    );
  }
  if (object.ref.kind === "rls") {
    // ALTER TABLE [ONLY] for RLS flags does not recurse to children, so the
    // ONLY spelling (relation.inh) is semantically inert and must not split
    // cross-lane identity: catalogs reconstruct without ONLY while trees
    // often write it.
    return astObjectHash(
      statements.map((item) => {
        const cloned = structuredClone(item.node) as Record<string, unknown>;
        const alterTable = asRecord(cloned.AlterTableStmt);
        const relation = asRecord(alterTable?.relation);
        if (relation) {
          relation.inh = true;
        }
        return cloned as AstNode;
      }),
      object.key,
      object.ref,
    );
  }
  if (object.ref.kind === "policy") {
    // pg_get_expr renders ANALYZED expressions: subquery targets gain
    // auto-aliases (`SELECT auth.uid() AS uid`) and constants gain implicit
    // casts (`(0)::numeric`) that raw declarative text lacks. Both are
    // semantically inert inside a policy expression, so hashing strips them
    // on both lanes.
    return astObjectHash(
      statements.map((item) => canonicalPolicyNode(item.node) as AstNode),
      object.key,
      object.ref,
    );
  }
  if (object.ref.kind === "view" || object.ref.kind === "materialized-view") {
    // pg_get_viewdef qualifies every column with its relation name on PG 15
    // (`upper(accounts.name)`) where PG 16+ and declarative sources write the
    // bare column (`upper(name)`). Stripping the qualifier is provably safe
    // only when it names the sole plain relation of the innermost SELECT
    // scope, so both lanes converge to that form and everything else (joins,
    // correlated outer refs) keeps its written qualification.
    return astObjectHash(
      statements.map((item) => canonicalViewNode(item.node, []) as AstNode),
      object.key,
      object.ref,
    );
  }
  return astObjectHash(
    statements.map((item) => item.node),
    object.key,
    object.ref,
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
  return undefined;
}

export function statementFacts(
  tag: string,
  statementNode: AstNode,
  sql: string,
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

/**
 * A comment drop is the same statement with a NULL value; deparsing the
 * comment-stripped node quotes the target correctly (descriptor text is an
 * identity label, not renderable SQL — `extension uuid-ossp` must render as
 * `COMMENT ON EXTENSION "uuid-ossp"`).
 */
function commentDropSql(node: AstNode): string | undefined {
  try {
    const stripped = structuredClone(node) as Record<string, unknown>;
    delete stripped.comment;
    return deparseSync({
      stmts: [{ stmt: { CommentStmt: stripped } }],
      version: 170004,
    } as unknown as Parameters<typeof deparseSync>[0]);
  } catch {
    return undefined;
  }
}

function renderGuardFacts(tag: string, node: AstNode, sql: string): RenderGuardFacts | undefined {
  if (tag === "CreateTableAsStmt" && readString(node.objtype) !== "OBJECT_MATVIEW") {
    return undefined;
  }
  const steps = ifNotExistsSteps[tag];
  if (steps) {
    // CreateForeignTableStmt nests the flag on its embedded base CreateStmt.
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
  return undefined;
}

function functionFacts(node: AstNode): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
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

function viewFacts(node: AstNode): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const aliases = stringList(node.aliases);
  const columns = aliases.length > 0 ? aliases : viewTargetColumns(node.query);
  if (columns !== undefined) {
    facts.viewColumns = columns;
  }
  const securityInvoker = viewSecurityInvoker(node.options);
  if (securityInvoker !== undefined) {
    facts.securityInvoker = securityInvoker;
  }
  return facts;
}

function viewTargetColumns(query: unknown): string[] | undefined {
  const select = asRecord(asRecord(query)?.SelectStmt);
  if (!select || asRecord(select.larg) || asRecord(select.rarg)) {
    return undefined;
  }
  const columns: string[] = [];
  for (const item of readArray(select.targetList)) {
    const target = asRecord(asRecord(item)?.ResTarget);
    if (!target) {
      return undefined;
    }
    const explicit = readString(target.name);
    if (explicit) {
      columns.push(explicit);
      continue;
    }
    const fields = readArray(asRecord(asRecord(target.val)?.ColumnRef)?.fields);
    const name = stringValue(fields.at(-1));
    if (!name) {
      return undefined;
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
  return undefined;
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

/**
 * Walks the leading keyword sequence of a statement (skipping whitespace and
 * comments) and returns the offset of the token that follows it — the splice
 * point for a replay guard. Character scanning only; classification stays AST.
 */
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
    return undefined;
  }
  return index;
}

function readWord(sql: string, start: number): { end: number; text: string } | undefined {
  let end = start;
  while (end < sql.length) {
    const char = sql[end] ?? "";
    if (!/[A-Za-z_]/.test(char) && !(end > start && /[0-9$]/.test(char))) {
      break;
    }
    end += 1;
  }
  if (end === start) {
    return undefined;
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
