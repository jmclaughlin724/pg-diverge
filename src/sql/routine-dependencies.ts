import type { Diagnostic, RoutineDependencyResult } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstStatement } from "./ast.js";
import {
  asRecord,
  collectReferences,
  rangeVarName,
  readArray,
  readString,
  stringList,
  stringValue,
} from "./ast.js";
import { parseSqlAst } from "./parser.js";

const plpgsqlTrimKeywords = new Set(["begin", "end", "then", "else", "declare"]);

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
  const diagnostics: Diagnostic[] = [];
  for (const body of bodies) {
    const parsed = await parseStaticSql(body, file);
    addAll(references, parsed.references);
    addAll(columnReferences, parsed.columnReferences);
    diagnostics.push(...parsed.diagnostics);
  }
  return {
    columnReferences: sorted(columnReferences),
    confidence: diagnostics.some((item) => item.severity === "error")
      ? "sql-string-partial"
      : "sql-string-parsed",
    diagnostics,
    references: sorted(references),
  };
}

async function parsePlpgsqlBodies(
  bodies: readonly string[],
  file: string | undefined
): Promise<RoutineDependencyResult> {
  const references = new Set<string>();
  const columnReferences = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  let parsedDynamic = false;
  let dynamicUnknown = false;
  let partial = false;
  for (const body of bodies) {
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
  };
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
): Promise<{ columnReferences: string[]; diagnostics: Diagnostic[]; references: string[] }> {
  const parsed = await parseSqlAst(sql, file);
  if (parsed.ast === undefined) {
    return { columnReferences: [], diagnostics: parsed.diagnostics, references: [] };
  }
  return {
    columnReferences: sorted(collectColumnDependencyIdentities(parsed.ast)),
    diagnostics: parsed.diagnostics,
    references: sorted(collectReferences(parsed.ast)),
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
    dmlStatementFragment(statement)
  );
}

function plpgsqlStatementMayContainSql(statement: string): boolean {
  if (statement.length === 0) {
    return false;
  }
  const tokens = new Set(tokenSpans(statement).map((token) => token.text));
  return ["select", "insert", "update", "delete", "merge", "with", "exists"].some((token) =>
    tokens.has(token)
  );
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
  return;
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
  if (char === "$") {
    return skipDollarQuoted(statement, index);
  }
  if (char === "-" && statement[index + 1] === "-") {
    return skipLineComment(statement, index);
  }
  if (char === "/" && statement[index + 1] === "*") {
    return skipBlockComment(statement, index);
  }
  return;
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
  return;
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
  return;
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
  return;
}

function tokenSpans(sql: string): { end: number; start: number; text: string }[] {
  const tokens: { end: number; start: number; text: string }[] = [];
  let index = 0;
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

function routineLanguage(options: unknown): string | undefined {
  for (const item of readArray(options)) {
    const option = asRecord(asRecord(item)?.DefElem);
    if (readString(option?.defname) !== "language") {
      continue;
    }
    return stringValue(option?.arg)?.toLowerCase();
  }
  return;
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
