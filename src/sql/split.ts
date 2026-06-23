export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  const state = createSqlLexicalScanState();
  for (let index = 0; index < sql.length; index += 1) {
    const advanced = advanceSqlLexicalScan(sql, index, state);
    if (advanced !== index) {
      index = advanced;
      continue;
    }
    if (isSqlLexicalScanProtected(state)) {
      continue;
    }
    if (sql[index] === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      start = index + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }
  return statements;
}

interface SqlLexicalScanState {
  blockCommentDepth: number;
  dollarTag: string;
  inDoubleQuote: boolean;
  inEscapeString: boolean;
  inLineComment: boolean;
  inSingleQuote: boolean;
}

function createSqlLexicalScanState(): SqlLexicalScanState {
  return {
    blockCommentDepth: 0,
    dollarTag: "",
    inDoubleQuote: false,
    inEscapeString: false,
    inLineComment: false,
    inSingleQuote: false,
  };
}

export interface SqlParenRange {
  close: number;
  open: number;
}

export function findSqlParenRange(input: string, from: number): SqlParenRange | undefined {
  const open = findSqlChar(input, "(", from);
  if (open === -1) {
    return;
  }
  const close = findMatchingSqlParen(input, open);
  if (close === -1) {
    return;
  }
  return { close, open };
}

function findSqlChar(input: string, target: string, from: number): number {
  const state = createSqlLexicalScanState();
  let index = from;
  while (index < input.length) {
    const advanced = advanceSqlLexicalScan(input, index, state);
    if (advanced !== index) {
      index = advanced + 1;
      continue;
    }
    if (!isSqlLexicalScanProtected(state) && input[index] === target) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function findMatchingSqlParen(input: string, openIndex: number): number {
  const state = createSqlLexicalScanState();
  let depth = 0;
  let index = openIndex;
  while (index < input.length) {
    const advanced = advanceSqlLexicalScan(input, index, state);
    if (advanced !== index) {
      index = advanced + 1;
      continue;
    }
    if (!isSqlLexicalScanProtected(state)) {
      const char = input[index] ?? "";
      if (char === "(") {
        depth += 1;
      }
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
    index += 1;
  }
  return -1;
}

function advanceSqlLexicalScan(sql: string, index: number, state: SqlLexicalScanState): number {
  return (
    advanceLineComment(sql, index, state) ??
    advanceBlockComment(sql, index, state) ??
    advanceDollarQuote(sql, index, state) ??
    advanceSingleQuote(sql, index, state) ??
    advanceDoubleQuote(sql, index, state) ??
    enterSqlStatementDelimiter(sql, index, state) ??
    index
  );
}

function isSqlLexicalScanProtected(state: SqlLexicalScanState): boolean {
  return (
    state.inLineComment ||
    state.blockCommentDepth > 0 ||
    Boolean(state.dollarTag) ||
    state.inSingleQuote ||
    state.inDoubleQuote
  );
}

function advanceLineComment(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  if (!state.inLineComment) {
    return;
  }
  if (sql[index] === "\n") {
    state.inLineComment = false;
  }
  return index;
}

function advanceBlockComment(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  if (state.blockCommentDepth === 0) {
    return;
  }
  const char = sql[index] ?? "";
  const next = sql[index + 1] ?? "";
  if (char === "/" && next === "*") {
    state.blockCommentDepth += 1;
    return index + 1;
  }
  if (char === "*" && next === "/") {
    state.blockCommentDepth -= 1;
    return index + 1;
  }
  return index;
}

function advanceDollarQuote(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  if (!state.dollarTag) {
    return;
  }
  if (sql.startsWith(state.dollarTag, index)) {
    const nextIndex = index + state.dollarTag.length - 1;
    state.dollarTag = "";
    return nextIndex;
  }
  return index;
}

function advanceSingleQuote(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  if (!state.inSingleQuote) {
    return;
  }
  const char = sql[index] ?? "";
  const next = sql[index + 1] ?? "";
  if (state.inEscapeString && char === "\\") {
    return index + 1;
  }
  if (char === "'" && next === "'") {
    return index + 1;
  }
  if (char === "'") {
    state.inSingleQuote = false;
    state.inEscapeString = false;
  }
  return index;
}

function advanceDoubleQuote(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  if (!state.inDoubleQuote) {
    return;
  }
  const char = sql[index] ?? "";
  const next = sql[index + 1] ?? "";
  if (char === '"' && next === '"') {
    return index + 1;
  }
  if (char === '"') {
    state.inDoubleQuote = false;
  }
  return index;
}

function enterSqlStatementDelimiter(
  sql: string,
  index: number,
  state: SqlLexicalScanState
): number | undefined {
  const char = sql[index] ?? "";
  const next = sql[index + 1] ?? "";
  if (char === "-" && next === "-") {
    state.inLineComment = true;
    return index + 1;
  }
  if (char === "/" && next === "*") {
    state.blockCommentDepth = 1;
    return index + 1;
  }
  if (char === "'") {
    state.inSingleQuote = true;
    state.inEscapeString = isEscapeStringQuote(sql, index);
    return index;
  }
  if (char === '"') {
    state.inDoubleQuote = true;
    return index;
  }
  const tag = readDollarTag(sql, index);
  if (tag) {
    state.dollarTag = tag;
    return index + tag.length - 1;
  }
  return;
}

function isEscapeStringQuote(sql: string, index: number): boolean {
  const markerIndex = index - 1;
  const marker = sql[markerIndex] ?? "";
  if (marker !== "E" && marker !== "e") {
    return false;
  }
  const beforeMarker = sql[markerIndex - 1] ?? "";
  return !isIdentifierChar(beforeMarker);
}

function isIdentifierChar(char: string): boolean {
  return isTagChar(char) || char === "$";
}

function isTagStartChar(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isTagChar(char: string): boolean {
  return isTagStartChar(char) || (char >= "0" && char <= "9");
}

function readDollarTag(sql: string, index: number): string | undefined {
  if (sql[index] !== "$") {
    return;
  }
  if (sql[index + 1] === "$") {
    return "$$";
  }
  let cursor = index + 1;
  if (!isTagStartChar(sql[cursor] ?? "")) {
    return;
  }
  cursor += 1;
  while (isTagChar(sql[cursor] ?? "")) {
    cursor += 1;
  }
  return sql[cursor] === "$" ? sql.slice(index, cursor + 1) : undefined;
}

export function splitTopLevel(input: string, separator = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  const state = createSqlLexicalScanState();
  for (let index = 0; index < input.length; index += 1) {
    const advanced = advanceSqlLexicalScan(input, index, state);
    if (advanced !== index) {
      index = advanced;
      continue;
    }
    if (isSqlLexicalScanProtected(state)) {
      continue;
    }
    const char = input[index] ?? "";
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === separator && depth === 0) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  const trailing = input.slice(start).trim();
  if (trailing.length > 0) {
    parts.push(trailing);
  }
  return parts;
}
