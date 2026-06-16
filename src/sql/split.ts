export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  const state: SqlScanState = {
    blockCommentDepth: 0,
    dollarTag: "",
    inDoubleQuote: false,
    inEscapeString: false,
    inLineComment: false,
    inSingleQuote: false,
  };
  for (let index = 0; index < sql.length; index += 1) {
    const advanced = advanceSqlStatementScan(sql, index, state);
    if (advanced !== index) {
      index = advanced;
      continue;
    }
    if (isSqlStatementScanProtected(state)) {
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

interface SqlScanState {
  blockCommentDepth: number;
  dollarTag: string;
  inDoubleQuote: boolean;
  inEscapeString: boolean;
  inLineComment: boolean;
  inSingleQuote: boolean;
}

function advanceSqlStatementScan(sql: string, index: number, state: SqlScanState): number {
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

function isSqlStatementScanProtected(state: SqlScanState): boolean {
  return (
    state.inLineComment ||
    state.blockCommentDepth > 0 ||
    Boolean(state.dollarTag) ||
    state.inSingleQuote ||
    state.inDoubleQuote
  );
}

function advanceLineComment(sql: string, index: number, state: SqlScanState): number | undefined {
  if (!state.inLineComment) {
    return;
  }
  if (sql[index] === "\n") {
    state.inLineComment = false;
  }
  return index;
}

function advanceBlockComment(sql: string, index: number, state: SqlScanState): number | undefined {
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

function advanceDollarQuote(sql: string, index: number, state: SqlScanState): number | undefined {
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

function advanceSingleQuote(sql: string, index: number, state: SqlScanState): number | undefined {
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

function advanceDoubleQuote(sql: string, index: number, state: SqlScanState): number | undefined {
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
  state: SqlScanState
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
  const state: TopLevelScanState = {
    dollarTag: "",
    inDoubleQuote: false,
    inSingleQuote: false,
  };
  for (let index = 0; index < input.length; index += 1) {
    const advanced = advanceTopLevelScan(input, index, state);
    if (advanced !== index) {
      index = advanced;
      continue;
    }
    if (isTopLevelScanProtected(state)) {
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

interface TopLevelScanState {
  dollarTag: string;
  inDoubleQuote: boolean;
  inSingleQuote: boolean;
}

function advanceTopLevelScan(input: string, index: number, state: TopLevelScanState): number {
  return (
    advanceTopLevelDollarQuote(input, index, state) ??
    advanceTopLevelSingleQuote(input, index, state) ??
    advanceTopLevelDoubleQuote(input, index, state) ??
    enterTopLevelDelimiter(input, index, state) ??
    index
  );
}

function isTopLevelScanProtected(state: TopLevelScanState): boolean {
  return Boolean(state.dollarTag) || state.inSingleQuote || state.inDoubleQuote;
}

function advanceTopLevelDollarQuote(
  input: string,
  index: number,
  state: TopLevelScanState
): number | undefined {
  if (!state.dollarTag) {
    return;
  }
  if (input.startsWith(state.dollarTag, index)) {
    const nextIndex = index + state.dollarTag.length - 1;
    state.dollarTag = "";
    return nextIndex;
  }
  return index;
}

function advanceTopLevelSingleQuote(
  input: string,
  index: number,
  state: TopLevelScanState
): number | undefined {
  if (!state.inSingleQuote) {
    return;
  }
  const char = input[index] ?? "";
  const next = input[index + 1] ?? "";
  if (char === "'" && next === "'") {
    return index + 1;
  }
  if (char === "'") {
    state.inSingleQuote = false;
  }
  return index;
}

function advanceTopLevelDoubleQuote(
  input: string,
  index: number,
  state: TopLevelScanState
): number | undefined {
  if (!state.inDoubleQuote) {
    return;
  }
  const char = input[index] ?? "";
  const next = input[index + 1] ?? "";
  if (char === '"' && next === '"') {
    return index + 1;
  }
  if (char === '"') {
    state.inDoubleQuote = false;
  }
  return index;
}

function enterTopLevelDelimiter(
  input: string,
  index: number,
  state: TopLevelScanState
): number | undefined {
  const char = input[index] ?? "";
  if (char === "'") {
    state.inSingleQuote = true;
    return index;
  }
  if (char === '"') {
    state.inDoubleQuote = true;
    return index;
  }
  const tag = readDollarTag(input, index);
  if (tag) {
    state.dollarTag = tag;
    return index + tag.length - 1;
  }
  return;
}
