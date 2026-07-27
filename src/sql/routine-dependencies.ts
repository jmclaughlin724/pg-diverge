import { diagnostic } from "../diagnostics/diagnostics.js";
import type { Diagnostic } from "../types.js";
import type { AstNode, AstStatement } from "./ast.js";
import {
  asRecord,
  collectReferences,
  rangeVarName,
  readArray,
  readBoolean,
  readString,
  stringList,
  stringValue,
} from "./ast.js";
import { normalizeIdentifier } from "./identifiers.js";
import { parseSqlAst } from "./parser.js";

const plpgsqlTrimKeywords = new Set(["begin", "end", "then", "else", "declare"]);
const plpgsqlDeclarationModifiers = new Set(["collate", "default", "not"]);

interface StatementDependencyResult {
  columnReferences: string[];
  diagnostics: Diagnostic[];
  references: string[];
  routine?: RoutineDependencyResult;
}

interface StaticSqlFragment {
  source: string;
  sql: string;
}

interface PlpgsqlFragments {
  dynamicUnknown: string[];
  fragments: StaticSqlFragment[];
  unrecognized: string[];
}

type PlpgsqlDeclaration =
  | { kind: "typed"; name: string; typeExpression: string }
  | { kind: "unproven"; name?: string }
  | { kind: "untyped"; name: string };

type PlpgsqlAttributeType =
  | { kind: "direct" }
  | { kind: "invalid" }
  | {
      base: string;
      kind: "reference";
      referenceKind: "rowtype" | "type";
      suffix: string;
    };

export async function extractStatementDependencies(
  statement: AstStatement,
  file?: string
): Promise<StatementDependencyResult> {
  const references = new Set(collectReferences(statement.node));
  const columnReferences = collectColumnDependencyIdentities(statement.node);
  const diagnostics: Diagnostic[] = [];
  const routine =
    statement.tag === "CreateFunctionStmt"
      ? await extractRoutineDependencies(statement, file)
      : undefined;
  if (routine) {
    addAll(references, routine.references);
    addAll(columnReferences, routine.columnReferences);
    diagnostics.push(...routine.diagnostics);
  }
  return {
    columnReferences: sorted(columnReferences),
    diagnostics,
    references: sorted(references),
    ...(routine ? { routine } : {}),
  };
}

export async function extractRoutineDependencies(
  statement: AstStatement,
  file?: string
): Promise<RoutineDependencyResult> {
  const node = asRecord(statement.node.CreateFunctionStmt);
  const language = routineLanguage(node?.options);
  if (node?.sql_body !== undefined) {
    return {
      columnReferences: sorted(collectColumnDependencyIdentities(node.sql_body)),
      confidence: "sql-body",
      diagnostics: [],
      references: sorted(collectReferences(node.sql_body)),
      unqualifiedReferences: collectUnqualifiedRoutineReferences(node.sql_body),
    };
  }
  const bodies = routineBodyStrings(node?.options);
  if (language === "sql") {
    return await parseRoutineSqlBodies(bodies, file);
  }
  if (language === "plpgsql") {
    return await parsePlpgsqlBodies(bodies, file);
  }
  return {
    columnReferences: [],
    confidence: "unsupported-language",
    diagnostics: [
      diagnostic(
        "SUPA_ROUTINE_BODY_DEPENDENCY_UNKNOWN",
        "warning",
        `routine language "${language ?? "unknown"}" is not statically analyzed for dependencies`,
        {
          file,
          hint: "Rewrite the routine in a statically analyzable language/form before changing relations or types it may reference.",
          statement: statement.text,
        }
      ),
    ],
    references: [],
    unqualifiedReferences: emptyUnqualifiedReferences(),
  };
}

export function collectColumnDependencyIdentities(value: unknown): Set<string> {
  const relationByName = new Map<string, string>();
  const relationIdentities = new Set<string>();
  collectRangeVars(value, relationByName, relationIdentities);
  const columns = new Set<string>();
  collectColumnRefs(value, relationByName, relationIdentities, columns);
  return columns;
}

async function parseRoutineSqlBodies(
  bodies: readonly string[],
  file: string | undefined
): Promise<RoutineDependencyResult> {
  const references = new Set<string>();
  const columnReferences = new Set<string>();
  const unqualifiedRelations = new Set<string>();
  const unqualifiedTypes = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const body of bodies) {
    const parsed = await parseStaticSql(body, file);
    addAll(references, parsed.references);
    addAll(columnReferences, parsed.columnReferences);
    addAll(unqualifiedRelations, parsed.unqualifiedReferences.relations);
    addAll(unqualifiedTypes, parsed.unqualifiedReferences.types);
    diagnostics.push(...parsed.diagnostics);
  }
  return {
    columnReferences: sorted(columnReferences),
    confidence: diagnostics.some((item) => item.severity === "error")
      ? "sql-string-partial"
      : "sql-string-parsed",
    diagnostics,
    references: sorted(references),
    unqualifiedReferences: {
      relations: sorted(unqualifiedRelations),
      types: sorted(unqualifiedTypes),
    },
  };
}

async function parsePlpgsqlBodies(
  bodies: readonly string[],
  file: string | undefined
): Promise<RoutineDependencyResult> {
  const references = new Set<string>();
  const columnReferences = new Set<string>();
  const unqualifiedRelations = new Set<string>();
  const unqualifiedTypes = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  let parsedDynamic = false;
  let dynamicUnknown = false;
  let partial = false;
  for (const body of bodies) {
    const declarations = await parsePlpgsqlDeclarations(body, file);
    addAll(unqualifiedRelations, declarations.unqualifiedReferences.relations);
    addAll(unqualifiedTypes, declarations.unqualifiedReferences.types);
    if (declarations.diagnostics.length > 0) {
      partial = true;
      diagnostics.push(...declarations.diagnostics);
    }
    const extracted = plpgsqlStaticSqlFragments(body);
    parsedDynamic ||= extracted.fragments.some((fragment) => fragment.source === "EXECUTE");
    dynamicUnknown ||= extracted.dynamicUnknown.length > 0;
    for (const statement of extracted.dynamicUnknown) {
      diagnostics.push(
        diagnostic(
          "SUPA_ROUTINE_DYNAMIC_SQL_DEPENDENCY_UNKNOWN",
          "warning",
          "routine contains dynamic SQL whose relation and column dependencies cannot be proven statically",
          {
            file,
            hint: "Rewrite dynamic SQL to static SQL before relation/type changes, or move the change to a reviewed explicit migration.",
            statement,
          }
        )
      );
    }
    if (extracted.unrecognized.length > 0) {
      partial = true;
      for (const statement of extracted.unrecognized) {
        diagnostics.push(
          diagnostic(
            "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY",
            "warning",
            "could not prove all PL/pgSQL dependencies in an unrecognized statement form",
            {
              file,
              hint: "Rewrite this statement as a supported static query form before changing referenced relations.",
              statement,
            }
          )
        );
      }
    }
    for (const fragment of extracted.fragments) {
      const parsed = await parseStaticSql(fragment.sql, file);
      addAll(references, parsed.references);
      addAll(columnReferences, parsed.columnReferences);
      addAll(unqualifiedRelations, parsed.unqualifiedReferences.relations);
      addAll(unqualifiedTypes, parsed.unqualifiedReferences.types);
      if (parsed.diagnostics.length > 0) {
        partial = true;
        diagnostics.push(
          diagnostic(
            "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY",
            "warning",
            `could not prove all PL/pgSQL dependencies in ${fragment.source}`,
            {
              file,
              hint: "Keep proven dependencies and rewrite the unproven statement before changing referenced relations.",
              statement: fragment.sql,
            }
          )
        );
      }
    }
  }
  return {
    columnReferences: sorted(columnReferences),
    confidence: plpgsqlConfidence(parsedDynamic, dynamicUnknown, partial),
    diagnostics,
    references: sorted(references),
    unqualifiedReferences: {
      relations: sorted(unqualifiedRelations),
      types: sorted(unqualifiedTypes),
    },
  };
}

async function parsePlpgsqlDeclarations(
  body: string,
  file: string | undefined
): Promise<{
  diagnostics: Diagnostic[];
  unqualifiedReferences: RoutineUnqualifiedReferences;
}> {
  const diagnostics: Diagnostic[] = [];
  const relations = new Set<string>();
  const types = new Set<string>();
  for (const block of plpgsqlDeclarationBlocks(body)) {
    diagnostics.push(...(await parsePlpgsqlDeclarationBlock(block, file, relations, types)));
  }
  return {
    diagnostics,
    unqualifiedReferences: { relations: sorted(relations), types: sorted(types) },
  };
}

async function parsePlpgsqlDeclarationBlock(
  statements: readonly string[],
  file: string | undefined,
  relations: Set<string>,
  types: Set<string>
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const declaredVariables = new Set<string>();
  for (const statement of statements) {
    const declaration = plpgsqlDeclaration(statement);
    const proven =
      declaration.kind !== "unproven" &&
      (declaration.kind !== "typed" ||
        (await addPlpgsqlDeclarationType(
          declaration.typeExpression,
          file,
          declaredVariables,
          relations,
          types
        )));
    if (!proven) {
      diagnostics.push(plpgsqlDeclarationDiagnostic(statement, file));
    }
    if (declaration.name) {
      declaredVariables.add(declaration.name);
    }
  }
  return diagnostics;
}

async function addPlpgsqlDeclarationType(
  typeExpression: string,
  file: string | undefined,
  declaredVariables: ReadonlySet<string>,
  relations: Set<string>,
  types: Set<string>
): Promise<boolean> {
  const attributeType = plpgsqlAttributeType(typeExpression);
  if (attributeType.kind === "invalid") {
    return false;
  }
  if (attributeType.kind === "reference") {
    const parts = await plpgsqlAttributeTypeParts(attributeType, file);
    return Boolean(
      parts &&
        addPlpgsqlAttributeReference(
          attributeType.referenceKind,
          parts,
          declaredVariables,
          relations
        )
    );
  }
  const parsed = await parseSqlAst(
    `CREATE TABLE pg_temp.__supaschema_declaration (value ${typeExpression})`,
    file
  );
  if (parsed.ast === undefined) {
    return false;
  }
  addAll(types, collectUnqualifiedRoutineReferences(parsed.ast).types);
  return true;
}

function plpgsqlDeclarationBlocks(body: string): string[][] {
  const tokens = tokenSpans(body);
  const blocks: string[][] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const declaration = tokens[index];
    if (declaration?.text !== "declare") {
      continue;
    }
    const beginIndex = tokens.findIndex(
      (token, candidateIndex) => candidateIndex > index && token.text === "begin"
    );
    const begin = beginIndex < 0 ? undefined : tokens[beginIndex];
    if (!begin) {
      continue;
    }
    const statements = splitPlpgsqlStatements(body.slice(declaration.end, begin.start))
      .map((statement) => statement.trim())
      .filter(Boolean);
    blocks.push(statements);
    index = beginIndex;
  }
  return blocks;
}

function plpgsqlDeclaration(statement: string): PlpgsqlDeclaration {
  const nameStart = firstDeclarationCodeCharacter(statement);
  if (nameStart === undefined) {
    return { kind: "unproven" };
  }
  const identifier = plpgsqlIdentifierAt(statement, nameStart);
  if (!identifier) {
    return { kind: "unproven" };
  }
  const name = normalizeIdentifier(identifier.raw);
  let typeStart = firstDeclarationCodeCharacter(statement, identifier.end);
  if (typeStart === undefined) {
    return { kind: "unproven", name };
  }
  const constantEnd = keywordEnd(statement, typeStart, "constant");
  if (constantEnd !== undefined) {
    typeStart = firstDeclarationCodeCharacter(statement, constantEnd) ?? statement.length;
  }
  const aliasEnd = keywordEnd(statement, typeStart, "alias");
  if (aliasEnd !== undefined) {
    const forStart = firstDeclarationCodeCharacter(statement, aliasEnd);
    return forStart !== undefined && keywordEnd(statement, forStart, "for") !== undefined
      ? { kind: "untyped", name }
      : { kind: "unproven", name };
  }
  const cursorEnd = plpgsqlCursorKeywordEnd(statement, typeStart);
  if (cursorEnd !== undefined) {
    const cursorTail = firstDeclarationCodeCharacter(statement, cursorEnd);
    return cursorTail !== undefined &&
      statement[cursorTail] !== "(" &&
      keywordEnd(statement, cursorTail, "for") !== undefined
      ? { kind: "untyped", name }
      : { kind: "unproven", name };
  }
  const typeEnd = plpgsqlDeclarationTypeEnd(statement, typeStart);
  const typeExpression = statement.slice(typeStart, typeEnd).trim();
  return typeExpression.length > 0
    ? { kind: "typed", name, typeExpression }
    : { kind: "unproven", name };
}

function plpgsqlDeclarationTypeEnd(value: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < value.length) {
    const skipped = skipNonCodeSpan(value, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    const char = value[index] ?? "";
    if (depth === 0 && isPlpgsqlDeclarationAssignment(value, index)) {
      return index;
    }
    if (depth === 0 && isIdentifierStart(char)) {
      const end = identifierEnd(value, index);
      const keyword = value.slice(index, end).toLowerCase();
      if (plpgsqlDeclarationModifiers.has(keyword)) {
        return index;
      }
      index = end;
      continue;
    }
    depth = plpgsqlDeclarationDepth(depth, char);
    index += 1;
  }
  return value.length;
}

function isPlpgsqlDeclarationAssignment(value: string, index: number): boolean {
  return value[index] === "=" || (value[index] === ":" && value[index + 1] === "=");
}

function plpgsqlDeclarationDepth(depth: number, char: string): number {
  if (char === "(" || char === "[") {
    return depth + 1;
  }
  if (char === ")" || char === "]") {
    return Math.max(0, depth - 1);
  }
  return depth;
}

function plpgsqlAttributeType(typeExpression: string): PlpgsqlAttributeType {
  const percent = codeCharacterIndex(typeExpression, "%");
  if (percent === undefined) {
    return { kind: "direct" };
  }
  const markerStart = firstDeclarationCodeCharacter(typeExpression, percent + 1);
  if (markerStart === undefined) {
    return { kind: "invalid" };
  }
  const rowtypeEnd = keywordEnd(typeExpression, markerStart, "rowtype");
  const typeEnd = keywordEnd(typeExpression, markerStart, "type");
  const markerEnd = rowtypeEnd ?? typeEnd;
  const base = typeExpression.slice(0, percent).trim();
  if (markerEnd === undefined || base.length === 0) {
    return { kind: "invalid" };
  }
  const suffix = typeExpression.slice(markerEnd).trim();
  if (codeCharacterIndex(suffix, "%") !== undefined || !isPlpgsqlArrayTypeSuffix(suffix)) {
    return { kind: "invalid" };
  }
  return {
    base,
    kind: "reference",
    referenceKind: rowtypeEnd === undefined ? "type" : "rowtype",
    suffix,
  };
}

async function plpgsqlAttributeTypeParts(
  attributeType: Extract<PlpgsqlAttributeType, { kind: "reference" }>,
  file: string | undefined
): Promise<string[] | undefined> {
  const parsed = await parseSqlAst(
    `CREATE TABLE pg_temp.__supaschema_declaration (value ${attributeType.base}${
      attributeType.suffix.length > 0 ? ` ${attributeType.suffix}` : ""
    })`,
    file
  );
  return parsed.ast === undefined ? undefined : firstTypeNameParts(parsed.ast);
}

function firstTypeNameParts(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parts = firstTypeNameParts(item);
      if (parts) {
        return parts;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const typeName = asRecord(record.TypeName) ?? asRecord(record.typeName);
  const parts = stringList(typeName?.names);
  if (parts.length > 0) {
    return parts;
  }
  for (const child of Object.values(record)) {
    const childParts = firstTypeNameParts(child);
    if (childParts) {
      return childParts;
    }
  }
}

function addPlpgsqlAttributeReference(
  kind: "rowtype" | "type",
  parts: readonly string[],
  declaredVariables: ReadonlySet<string>,
  relations: Set<string>
): boolean {
  const first = parts[0];
  if (!first) {
    return false;
  }
  if (kind === "rowtype") {
    if (parts.length === 1) {
      relations.add(first);
    }
    return parts.length <= 2;
  }
  if (parts.length === 1) {
    return declaredVariables.has(first);
  }
  if (parts.length === 2 && !declaredVariables.has(first)) {
    relations.add(first);
  }
  return parts.length <= 3;
}

function isPlpgsqlArrayTypeSuffix(value: string): boolean {
  let index = firstDeclarationCodeCharacter(value);
  while (index !== undefined) {
    const arrayEnd = keywordEnd(value, index, "array");
    if (arrayEnd !== undefined) {
      index = firstDeclarationCodeCharacter(value, arrayEnd);
    }
    if (index === undefined || value[index] !== "[") {
      return false;
    }
    const bracketEnd = matchingSquareBracketEnd(value, index);
    if (bracketEnd === undefined) {
      return false;
    }
    index = firstDeclarationCodeCharacter(value, bracketEnd);
  }
  return true;
}

function matchingSquareBracketEnd(value: string, start: number): number | undefined {
  let depth = 0;
  let index = start;
  while (index < value.length) {
    const skipped = skipNonCodeSpan(value, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    if (value[index] === "[") {
      depth += 1;
    } else if (value[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
}

function plpgsqlCursorKeywordEnd(statement: string, start: number): number | undefined {
  let cursorStart = start;
  const noEnd = keywordEnd(statement, cursorStart, "no");
  if (noEnd === undefined) {
    const scrollEnd = keywordEnd(statement, cursorStart, "scroll");
    if (scrollEnd !== undefined) {
      cursorStart = firstDeclarationCodeCharacter(statement, scrollEnd) ?? statement.length;
    }
    return keywordEnd(statement, cursorStart, "cursor");
  }
  const scrollStart = firstDeclarationCodeCharacter(statement, noEnd);
  const scrollEnd =
    scrollStart === undefined ? undefined : keywordEnd(statement, scrollStart, "scroll");
  if (scrollEnd === undefined) {
    return;
  }
  cursorStart = firstDeclarationCodeCharacter(statement, scrollEnd) ?? statement.length;
  return keywordEnd(statement, cursorStart, "cursor");
}

function keywordEnd(value: string, start: number, keyword: string): number | undefined {
  return keywordAt(value, start, keyword) ? start + keyword.length : undefined;
}

function firstDeclarationCodeCharacter(value: string, start = 0): number | undefined {
  let index = start;
  while (index < value.length) {
    if (isWhitespace(value[index] ?? "")) {
      index += 1;
      continue;
    }
    if (value[index] === "-" && value[index + 1] === "-") {
      index = skipLineComment(value, index);
      continue;
    }
    if (value[index] === "/" && value[index + 1] === "*") {
      index = skipBlockComment(value, index);
      continue;
    }
    return index;
  }
}

function plpgsqlIdentifierAt(
  value: string,
  start: number
): { end: number; raw: string } | undefined {
  const char = value[start] ?? "";
  if (char === '"') {
    const end = skipDoubleQuoted(value, start);
    return end <= value.length && value[end - 1] === '"' && end > start + 2
      ? { end, raw: value.slice(start, end) }
      : undefined;
  }
  if (!isIdentifierStart(char)) {
    return;
  }
  const end = identifierEnd(value, start);
  return { end, raw: value.slice(start, end) };
}

function codeCharacterIndex(value: string, target: string): number | undefined {
  let index = 0;
  while (index < value.length) {
    const skipped = skipNonCodeSpan(value, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    if (value[index] === target) {
      return index;
    }
    index += 1;
  }
}

function plpgsqlDeclarationDiagnostic(statement: string, file: string | undefined): Diagnostic {
  return diagnostic(
    "SUPA_ROUTINE_BODY_PARTIAL_DEPENDENCY",
    "warning",
    "could not prove the type dependency in a PL/pgSQL declaration",
    {
      file,
      hint: "Use a schema-qualified type or %TYPE/%ROWTYPE reference in the declaration.",
      statement,
    }
  );
}

function plpgsqlConfidence(
  parsedDynamic: boolean,
  dynamicUnknown: boolean,
  partial: boolean
): RoutineDependencyResult["confidence"] {
  if (dynamicUnknown) {
    return "dynamic-sql-unknown";
  }
  if (partial) {
    return "plpgsql-partial";
  }
  if (parsedDynamic) {
    return "plpgsql-dynamic-parsed";
  }
  return "plpgsql-static";
}

async function parseStaticSql(
  sql: string,
  file: string | undefined
): Promise<{
  columnReferences: string[];
  diagnostics: Diagnostic[];
  references: string[];
  unqualifiedReferences: RoutineUnqualifiedReferences;
}> {
  const parsed = await parseSqlAst(sql, file);
  if (parsed.ast === undefined) {
    return {
      columnReferences: [],
      diagnostics: parsed.diagnostics,
      references: [],
      unqualifiedReferences: emptyUnqualifiedReferences(),
    };
  }
  return {
    columnReferences: sorted(collectColumnDependencyIdentities(parsed.ast)),
    diagnostics: parsed.diagnostics,
    references: sorted(collectReferences(parsed.ast)),
    unqualifiedReferences: collectUnqualifiedRoutineReferences(parsed.ast),
  };
}

function plpgsqlStaticSqlFragments(body: string): PlpgsqlFragments {
  const fragments: StaticSqlFragment[] = [];
  const dynamicUnknown: string[] = [];
  const unrecognized: string[] = [];
  for (const statement of splitPlpgsqlStatements(body)) {
    const normalized = trimPlpgsqlStatement(statement);
    const dynamicFragment = dynamicExecuteStatementFragment(normalized);
    if (dynamicFragment) {
      fragments.push(dynamicFragment);
      continue;
    }
    if (isExecuteStatement(normalized)) {
      dynamicUnknown.push(normalized);
      continue;
    }
    const fragment = plpgsqlStatementFragment(normalized);
    if (fragment) {
      fragments.push(fragment);
    } else if (plpgsqlStatementMayContainSql(normalized)) {
      unrecognized.push(normalized);
    }
  }
  return { dynamicUnknown, fragments, unrecognized };
}

function plpgsqlStatementFragment(statement: string): StaticSqlFragment | undefined {
  if (statement.length === 0) {
    return;
  }
  const cursorSql = afterKeywordSequence(statement, ["cursor", "for"]);
  if (cursorSql) {
    return { source: "cursor query", sql: cursorSql };
  }
  return (
    forLoopStatementFragment(statement) ??
    performStatementFragment(statement) ??
    returnStatementFragment(statement) ??
    openStatementFragment(statement) ??
    selectStatementFragment(statement) ??
    dmlStatementFragment(statement) ??
    relationUtilityStatementFragment(statement)
  );
}

const relationUtilityPrefixes = ["truncate ", "lock ", "analyze ", "analyse "];

function relationUtilityStatementFragment(sql: string): StaticSqlFragment | undefined {
  const lower = sql.toLowerCase();
  return relationUtilityPrefixes.some((prefix) => lower.startsWith(prefix))
    ? { source: "utility statement", sql }
    : undefined;
}

function plpgsqlStatementMayContainSql(statement: string): boolean {
  if (statement.length === 0) {
    return false;
  }
  const tokens = new Set(tokenSpans(statement).map((token) => token.text));
  return [
    "select",
    "insert",
    "update",
    "delete",
    "merge",
    "with",
    "exists",
    "truncate",
    "lock",
    "analyze",
    "analyse",
  ].some((token) => tokens.has(token));
}

function forLoopStatementFragment(sql: string): StaticSqlFragment | undefined {
  const query = forLoopQuery(sql);
  return query ? { source: "FOR query", sql: query } : undefined;
}

function performStatementFragment(sql: string): StaticSqlFragment | undefined {
  return sql.toLowerCase().startsWith("perform ")
    ? { source: "PERFORM", sql: `select ${sql.slice(8)}` }
    : undefined;
}

function returnStatementFragment(sql: string): StaticSqlFragment | undefined {
  const lower = sql.toLowerCase();
  if (lower.startsWith("return query ")) {
    return { source: "RETURN QUERY", sql: sql.slice(13) };
  }
  if (!lower.startsWith("return ")) {
    return;
  }
  const query = returnExpressionQuery(sql.slice(7));
  return query ? { source: "RETURN query expression", sql: query } : undefined;
}

function openStatementFragment(sql: string): StaticSqlFragment | undefined {
  if (!sql.toLowerCase().startsWith("open ")) {
    return;
  }
  const query = afterKeywordSequence(sql, ["for"]);
  return query ? { source: "OPEN query", sql: query } : undefined;
}

function selectStatementFragment(sql: string): StaticSqlFragment | undefined {
  return sql.toLowerCase().startsWith("select ")
    ? { source: "SELECT", sql: stripSelectInto(sql) }
    : undefined;
}

function dmlStatementFragment(sql: string): StaticSqlFragment | undefined {
  const lower = sql.toLowerCase();
  if (
    lower.startsWith("insert ") ||
    lower.startsWith("update ") ||
    lower.startsWith("delete ") ||
    lower.startsWith("merge ")
  ) {
    return { source: "DML statement", sql: stripReturningInto(sql) };
  }
}

function dynamicExecuteStatementFragment(statement: string): StaticSqlFragment | undefined {
  if (!isExecuteStatement(statement)) {
    return;
  }
  const tokens = tokenSpans(statement);
  const executeToken = tokens[0];
  if (!executeToken) {
    return;
  }
  const end = dynamicSqlExpressionEnd(statement, executeToken.end);
  const expression = statement.slice(executeToken.end, end).trim();
  const sql = dynamicSqlFromExpression(expression);
  return sql ? { source: "EXECUTE", sql } : undefined;
}

function isExecuteStatement(statement: string): boolean {
  return tokenSpans(statement)[0]?.text === "execute";
}

function dynamicSqlExpressionEnd(statement: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < statement.length) {
    const char = statement[index] ?? "";
    const skipped = skipNonCodeSpan(statement, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && isIdentifierStart(char)) {
      const wordEnd = identifierEnd(statement, index);
      const token = statement.slice(index, wordEnd).toLowerCase();
      if (token === "into" || token === "using") {
        return index;
      }
      index = wordEnd;
      continue;
    }
    index += 1;
  }
  return statement.length;
}

function skipNonCodeSpan(statement: string, index: number): number | undefined {
  const char = statement[index] ?? "";
  if (char === "'") {
    return skipSingleQuoted(statement, index);
  }
  if (char === '"') {
    return skipDoubleQuoted(statement, index);
  }
  if (char === "$") {
    return skipDollarQuoted(statement, index);
  }
  if (char === "-" && statement[index + 1] === "-") {
    return skipLineComment(statement, index);
  }
  if (char === "/" && statement[index + 1] === "*") {
    return skipBlockComment(statement, index);
  }
}

function identifierEnd(statement: string, start: number): number {
  let index = start + 1;
  while (index < statement.length && isIdentifierPart(statement[index] ?? "")) {
    index += 1;
  }
  return index;
}

function dynamicSqlFromExpression(expression: string): string | undefined {
  const literal = stringLiteralFromExpression(expression);
  if (literal !== undefined) {
    return literal;
  }
  return formatTemplateFromExpression(expression);
}

function stringLiteralFromExpression(expression: string): string | undefined {
  const start = firstNonWhitespace(expression);
  if (start === undefined) {
    return;
  }
  const literal = sqlStringLiteralAt(expression, start);
  if (!literal) {
    return;
  }
  return expression.slice(literal.end).trim().length === 0 ? literal.value : undefined;
}

function formatTemplateFromExpression(expression: string): string | undefined {
  const start = firstNonWhitespace(expression);
  if (start === undefined || !keywordAt(expression, start, "format")) {
    return;
  }
  const parenStart = firstNonWhitespace(expression, start + "format".length);
  if (parenStart === undefined || expression[parenStart] !== "(") {
    return;
  }
  const parenEnd = matchingParenEnd(expression, parenStart);
  if (parenEnd === undefined || expression.slice(parenEnd).trim().length > 0) {
    return;
  }
  const args = expression.slice(parenStart + 1, parenEnd - 1);
  const firstArgStart = firstNonWhitespace(args);
  if (firstArgStart === undefined) {
    return;
  }
  const literal = sqlStringLiteralAt(args, firstArgStart);
  if (!literal) {
    return;
  }
  return normalizeFormatTemplate(literal.value);
}

function normalizeFormatTemplate(template: string): string {
  let sql = "";
  let index = 0;
  while (index < template.length) {
    const char = template[index] ?? "";
    if (char !== "%") {
      sql += char;
      index += 1;
      continue;
    }
    const next = template[index + 1] ?? "";
    if (next === "%") {
      sql += "%";
      index += 2;
      continue;
    }
    const specifier = formatSpecifier(template, index + 1);
    sql += specifier.value;
    index = specifier.end;
  }
  return sql;
}

const formatSpecifierSubstitutions = new Map([
  ["I", "__supaschema_identifier"],
  ["L", "'__supaschema_literal'"],
  ["s", "ASC"],
]);

function formatSpecifier(template: string, start: number): { end: number; value: string } {
  let index = start;
  while (isDigit(template[index] ?? "")) {
    index += 1;
  }
  if (template[index] === "$") {
    index += 1;
  }
  while ("-+ 0#".includes(template[index] ?? "")) {
    index += 1;
  }
  while (isDigit(template[index] ?? "")) {
    index += 1;
  }
  if (template[index] === ".") {
    index += 1;
    while (isDigit(template[index] ?? "")) {
      index += 1;
    }
  }
  const value = formatSpecifierSubstitutions.get(template[index] ?? "") ?? "__supaschema_value";
  return { end: index + 1, value };
}

function sqlStringLiteralAt(
  sql: string,
  start: number
): { end: number; value: string } | undefined {
  const char = sql[start] ?? "";
  if ((char === "e" || char === "E") && sql[start + 1] === "'") {
    return singleQuotedLiteralAt(sql, start + 1);
  }
  if (char === "'") {
    return singleQuotedLiteralAt(sql, start);
  }
  if (char === "$") {
    const tag = dollarTagAt(sql, start);
    if (!tag) {
      return;
    }
    const end = sql.indexOf(tag, start + tag.length);
    if (end < 0) {
      return;
    }
    return {
      end: end + tag.length,
      value: sql.slice(start + tag.length, end),
    };
  }
}

function singleQuotedLiteralAt(sql: string, start: number): { end: number; value: string } {
  let index = start + 1;
  let value = "";
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (char === "'" && sql[index + 1] === "'") {
      value += "'";
      index += 2;
      continue;
    }
    if (char === "'") {
      return { end: index + 1, value };
    }
    value += char;
    index += 1;
  }
  return { end: sql.length, value };
}

function matchingParenEnd(sql: string, start: number): number | undefined {
  let depth = 0;
  let index = start;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (char === "'") {
      index = skipSingleQuoted(sql, index);
      continue;
    }
    if (char === "$") {
      const end = skipDollarQuoted(sql, index);
      if (end !== undefined) {
        index = end;
        continue;
      }
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
}

function firstNonWhitespace(value: string, start = 0): number | undefined {
  let index = start;
  while (index < value.length && isWhitespace(value[index] ?? "")) {
    index += 1;
  }
  return index < value.length ? index : undefined;
}

function keywordAt(value: string, start: number, keyword: string): boolean {
  if (value.slice(start, start + keyword.length).toLowerCase() !== keyword) {
    return false;
  }
  const before = start === 0 ? "" : (value[start - 1] ?? "");
  const after = value[start + keyword.length] ?? "";
  return !(isIdentifierPart(before) || isIdentifierPart(after));
}

function returnExpressionQuery(value: string): string | undefined {
  const trimmed = stripOuterParens(value.trim());
  return trimmed.toLowerCase().startsWith("select ") ? trimmed : undefined;
}

function stripOuterParens(value: string): string {
  let current = value;
  while (current.startsWith("(") && current.endsWith(")") && wrapsWholeString(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function wrapsWholeString(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function splitPlpgsqlStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  while (index < body.length) {
    const quote = body[index];
    if (quote === "'") {
      index = skipSingleQuoted(body, index);
      continue;
    }
    if (quote === '"') {
      index = skipDoubleQuoted(body, index);
      continue;
    }
    if (quote === "$") {
      const end = skipDollarQuoted(body, index);
      if (end !== undefined) {
        index = end;
        continue;
      }
    }
    if (quote === "-" && body[index + 1] === "-") {
      index = skipLineComment(body, index);
      continue;
    }
    if (quote === "/" && body[index + 1] === "*") {
      index = skipBlockComment(body, index);
      continue;
    }
    if (quote === ";") {
      statements.push(body.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  statements.push(body.slice(start));
  return statements;
}

function trimPlpgsqlStatement(statement: string): string {
  const parts = splitWhitespace(statement.trim()).filter(
    (part) => !plpgsqlTrimKeywords.has(part.toLowerCase())
  );
  return parts.join(" ").trim();
}

function splitWhitespace(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current !== "") {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current !== "") {
    parts.push(current);
  }
  return parts;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function stripSelectInto(sql: string): string {
  const tokens = tokenSpans(sql);
  const into = tokens.findIndex((token) => token.text === "into");
  const from = tokens.findIndex((token, index) => index > into && token.text === "from");
  if (into < 0 || from < 0) {
    return sql;
  }
  return `${sql.slice(0, tokens[into]?.start).trimEnd()} ${sql.slice(tokens[from]?.start).trimStart()}`;
}

function stripReturningInto(sql: string): string {
  const tokens = tokenSpans(sql);
  const returning = tokens.findIndex((token) => token.text === "returning");
  const into = tokens.findIndex((token, index) => index > returning && token.text === "into");
  if (returning < 0 || into < 0) {
    return sql;
  }
  return sql.slice(0, tokens[into]?.start).trimEnd();
}

function forLoopQuery(sql: string): string | undefined {
  const tokens = tokenSpans(sql);
  const inToken = tokens.find((token) => token.text === "in");
  const loopToken = tokens.find((token) => token.text === "loop");
  if (!(inToken && loopToken) || inToken.end >= loopToken.start) {
    return;
  }
  const query = sql.slice(inToken.end, loopToken.start).trim();
  return query.length > 0 ? query : undefined;
}

function afterKeywordSequence(sql: string, sequence: readonly string[]): string | undefined {
  const tokens = tokenSpans(sql);
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((keyword, offset) => tokens[index + offset]?.text === keyword)) {
      const end = tokens[index + sequence.length - 1]?.end;
      const query = end === undefined ? "" : sql.slice(end).trim();
      return query.length > 0 ? query : undefined;
    }
  }
}

function tokenSpans(sql: string): { end: number; start: number; text: string }[] {
  const tokens: { end: number; start: number; text: string }[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const skipped = skipNonCodeSpan(sql, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
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

function collectRangeVars(
  value: unknown,
  relationByName: Map<string, string>,
  relationIdentities: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRangeVars(item, relationByName, relationIdentities);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const rangeVar = asRecord(record.RangeVar);
  if (rangeVar) {
    const name = rangeVarName(rangeVar);
    if (name) {
      const identity = `${name.schema}.${name.name}`;
      relationIdentities.add(identity);
      relationByName.set(name.name, identity);
      const alias = aliasName(rangeVar.alias);
      if (alias) {
        relationByName.set(alias, identity);
      }
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectRangeVars(child, relationByName, relationIdentities);
    }
  }
}

function aliasName(value: unknown): string | undefined {
  const alias = asRecord(asRecord(value)?.Alias) ?? asRecord(value);
  return readString(alias?.aliasname);
}

function collectColumnRefs(
  value: unknown,
  relationByName: Map<string, string>,
  relationIdentities: Set<string>,
  into: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectColumnRefs(item, relationByName, relationIdentities, into);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const columnRef = asRecord(record.ColumnRef);
  if (columnRef) {
    addColumnRef(stringList(columnRef.fields), relationByName, relationIdentities, into);
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectColumnRefs(child, relationByName, relationIdentities, into);
    }
  }
}

function addColumnRef(
  fields: readonly string[],
  relationByName: ReadonlyMap<string, string>,
  relationIdentities: ReadonlySet<string>,
  into: Set<string>
): void {
  const column = fields.at(-1);
  if (!column || column === "*") {
    return;
  }
  if (fields.length >= 3) {
    into.add(`${fields.at(-3)}.${fields.at(-2)}.${column}`);
    return;
  }
  if (fields.length === 2) {
    const qualifier = fields[0] ?? "";
    const relation =
      relationByName.get(qualifier) ??
      ((qualifier.toLowerCase() === "old" || qualifier.toLowerCase() === "new") &&
      relationIdentities.size === 1
        ? [...relationIdentities][0]
        : undefined);
    if (relation) {
      into.add(`${relation}.${column}`);
    }
    return;
  }
  if (relationIdentities.size === 1) {
    const relation = [...relationIdentities][0];
    if (relation) {
      into.add(`${relation}.${column}`);
    }
  }
}

const queryNodeTags: readonly string[] = [
  "DeleteStmt",
  "InsertStmt",
  "MergeStmt",
  "SelectStmt",
  "UpdateStmt",
];

function collectUnqualifiedRoutineReferences(value: unknown): RoutineUnqualifiedReferences {
  const relations = new Set<string>();
  const types = new Set<string>();
  collectUnqualifiedNodes(value, new Set(), relations, types);
  return { relations: sorted(relations), types: sorted(types) };
}

function collectUnqualifiedNodes(
  value: unknown,
  visibleCtes: ReadonlySet<string>,
  relations: Set<string>,
  types: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUnqualifiedNodes(item, visibleCtes, relations, types);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const queryTags = queryNodeTags.filter((tag) => asRecord(record[tag]) !== undefined);
  if (queryTags.length > 0) {
    for (const tag of queryTags) {
      const query = asRecord(record[tag]);
      if (query) {
        collectUnqualifiedQuery(query, visibleCtes, relations, types);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (!queryTags.includes(key)) {
        collectUnqualifiedNodes(child, visibleCtes, relations, types);
      }
    }
    return;
  }
  collectUnqualifiedRelation(record, visibleCtes, relations);
  collectUnqualifiedType(record, types);
  for (const child of Object.values(record)) {
    collectUnqualifiedNodes(child, visibleCtes, relations, types);
  }
}

function collectUnqualifiedRelation(
  record: AstNode,
  visibleCtes: ReadonlySet<string>,
  relations: Set<string>
): void {
  const rangeVar = asRecord(record.RangeVar) ?? unwrappedRangeVar(record);
  const relation = readString(rangeVar?.relname);
  if (relation && readString(rangeVar?.schemaname) === undefined && !visibleCtes.has(relation)) {
    relations.add(relation);
  }
  collectRegclassRelation(record, relations);
}

function unwrappedRangeVar(record: AstNode): AstNode | undefined {
  const relation = asRecord(record.relation);
  return typeof relation?.relname === "string" ? relation : undefined;
}

const regclassResolutionFunctions = new Set(["nextval", "currval", "setval", "lastval"]);
const regclassCastTypes = new Set(["regclass", "_regclass"]);

function collectRegclassRelation(record: AstNode, relations: Set<string>): void {
  const funcCall = asRecord(record.FuncCall);
  if (funcCall) {
    const name = stringList(funcCall.funcname).at(-1);
    if (name !== undefined && regclassResolutionFunctions.has(name)) {
      for (const argument of readArray(funcCall.args)) {
        addUnqualifiedRelationLiteral(relationLiteral(asRecord(argument)), relations);
      }
    }
    return;
  }
  const cast = asRecord(record.TypeCast);
  const castType = stringList(asRecord(cast?.typeName)?.names).at(-1);
  if (cast && castType !== undefined && regclassCastTypes.has(castType)) {
    addUnqualifiedRelationLiteral(relationLiteral(asRecord(cast.arg)), relations);
  }
}

function relationLiteral(node: AstNode | undefined): string | undefined {
  if (!node) {
    return;
  }
  const cast = asRecord(node.TypeCast);
  if (cast) {
    return relationLiteral(asRecord(cast.arg));
  }
  return readString(asRecord(asRecord(node.A_Const)?.sval)?.sval);
}

function addUnqualifiedRelationLiteral(value: string | undefined, relations: Set<string>): void {
  if (value !== undefined && value.length > 0 && !value.includes(".")) {
    relations.add(value);
  }
}

function collectUnqualifiedType(record: AstNode, types: Set<string>): void {
  const typeName = asRecord(record.TypeName) ?? asRecord(record.typeName);
  const typeParts = stringList(typeName?.names);
  const type = typeParts.length === 1 ? typeParts[0] : undefined;
  if (type) {
    types.add(type);
  }
}

function collectUnqualifiedQuery(
  query: AstNode,
  outerCtes: ReadonlySet<string>,
  relations: Set<string>,
  types: Set<string>
): void {
  const withClause = asRecord(asRecord(query.withClause)?.WithClause) ?? asRecord(query.withClause);
  const visibleCtes = new Set(outerCtes);
  const ctes = commonTableExpressions(withClause?.ctes);
  if (readBoolean(withClause?.recursive)) {
    for (const cte of ctes) {
      const name = readString(cte.ctename);
      if (name) {
        visibleCtes.add(name);
      }
    }
    for (const cte of ctes) {
      collectUnqualifiedNodes(cte.ctequery, visibleCtes, relations, types);
    }
  } else {
    for (const cte of ctes) {
      collectUnqualifiedNodes(cte.ctequery, visibleCtes, relations, types);
      const name = readString(cte.ctename);
      if (name) {
        visibleCtes.add(name);
      }
    }
  }
  collectDmlTargetRelation(query, relations);
  for (const [key, child] of Object.entries(query)) {
    if (key !== "withClause") {
      collectUnqualifiedNodes(child, visibleCtes, relations, types);
    }
  }
}

function collectDmlTargetRelation(query: AstNode, relations: Set<string>): void {
  const rangeVar = asRecord(query.relation);
  const relation = readString(rangeVar?.relname);
  if (relation && readString(rangeVar?.schemaname) === undefined) {
    relations.add(relation);
  }
}

function commonTableExpressions(value: unknown): AstNode[] {
  const ctes: AstNode[] = [];
  for (const item of readArray(value)) {
    const cte = asRecord(asRecord(item)?.CommonTableExpr) ?? asRecord(item);
    if (cte) {
      ctes.push(cte);
    }
  }
  return ctes;
}

function emptyUnqualifiedReferences(): RoutineUnqualifiedReferences {
  return { relations: [], types: [] };
}

function routineLanguage(options: unknown): string | undefined {
  for (const item of readArray(options)) {
    const option = asRecord(asRecord(item)?.DefElem);
    if (readString(option?.defname) !== "language") {
      continue;
    }
    return stringValue(option?.arg)?.toLowerCase();
  }
}

function routineBodyStrings(options: unknown): string[] {
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

function addAll(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    target.add(value);
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
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

function skipDoubleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '"' && sql[index + 1] === '"') {
      index += 2;
      continue;
    }
    if (sql[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function skipDollarQuoted(sql: string, start: number): number | undefined {
  const tag = dollarTagAt(sql, start);
  if (!tag) {
    return;
  }
  const end = sql.indexOf(tag, start + tag.length);
  return end < 0 ? sql.length : end + tag.length;
}

function dollarTagAt(sql: string, start: number): string | undefined {
  if (sql[start] !== "$") {
    return;
  }
  let index = start + 1;
  while (index < sql.length && sql[index] !== "$") {
    const char = sql[index] ?? "";
    if (!isIdentifierPart(char)) {
      return;
    }
    index += 1;
  }
  return sql[index] === "$" ? sql.slice(start, index + 1) : undefined;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end < 0 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end < 0 ? sql.length : end + 2;
}

function isIdentifierStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || (char >= "0" && char <= "9") || char === "$";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

export interface RoutineDependencyResult {
  columnReferences: string[];
  confidence: RoutineDependencyConfidence;
  diagnostics: Diagnostic[];
  references: string[];
  unqualifiedReferences: RoutineUnqualifiedReferences;
}

export interface RoutineUnqualifiedReferences {
  relations: string[];
  types: string[];
}

export type RoutineDependencyConfidence =
  | "sql-body"
  | "sql-string-partial"
  | "sql-string-parsed"
  | "plpgsql-dynamic-parsed"
  | "plpgsql-static"
  | "plpgsql-partial"
  | "dynamic-sql-unknown"
  | "unsupported-language";
