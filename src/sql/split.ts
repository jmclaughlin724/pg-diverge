export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let dollarTag = "";
  let inSingleQuote = false;
  let inEscapeString = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let blockCommentDepth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
        continue;
      }
      if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }
    if (inSingleQuote) {
      if (inEscapeString && char === "\\") {
        index += 1;
        continue;
      }
      if (char === "'" && next === "'") {
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
        inEscapeString = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        index += 1;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      inEscapeString = isEscapeStringQuote(sql, index);
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    const tag = readDollarTag(sql, index);
    if (tag) {
      dollarTag = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === ";") {
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
    return undefined;
  }
  if (sql[index + 1] === "$") {
    return "$$";
  }
  let cursor = index + 1;
  if (!isTagStartChar(sql[cursor] ?? "")) {
    return undefined;
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
  let dollarTag = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (dollarTag) {
      if (input.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        index += 1;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    const tag = readDollarTag(input, index);
    if (tag) {
      dollarTag = tag;
      index += tag.length - 1;
      continue;
    }
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
