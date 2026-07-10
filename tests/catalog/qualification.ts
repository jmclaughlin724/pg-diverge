export function hasUnqualifiedCatalogName(sql: string, names: string[]): boolean {
  return names.some((name) => hasUnqualifiedName(sql, name));
}

export function hasUnqualifiedRegproc(sql: string): boolean {
  return hasUnqualifiedCall(sql, "to_regclass") || hasUnqualifiedCall(sql, "to_regprocedure");
}

function hasUnqualifiedCall(sql: string, name: string): boolean {
  let index = 0;
  while (index < sql.length) {
    const found = sql.indexOf(name, index);
    if (found === -1) {
      return false;
    }
    const after = found + name.length;
    if (
      isIdentifierBoundary(sql, found, after) &&
      !isPgCatalogQualified(sql, found) &&
      nextNonWhitespace(sql, after) === "("
    ) {
      return true;
    }
    index = after;
  }
  return false;
}

function hasUnqualifiedName(sql: string, name: string): boolean {
  let index = 0;
  while (index < sql.length) {
    const found = sql.indexOf(name, index);
    if (found === -1) {
      return false;
    }
    const after = found + name.length;
    if (isIdentifierBoundary(sql, found, after) && !isPgCatalogQualified(sql, found)) {
      return true;
    }
    index = after;
  }
  return false;
}

function isIdentifierBoundary(sql: string, start: number, end: number): boolean {
  return !(isIdentifierChar(sql[start - 1] ?? "") || isIdentifierChar(sql[end] ?? ""));
}

function isPgCatalogQualified(sql: string, start: number): boolean {
  return sql.slice(Math.max(0, start - "pg_catalog.".length), start) === "pg_catalog.";
}

function nextNonWhitespace(sql: string, start: number): string | undefined {
  let index = start;
  while (index < sql.length && isWhitespace(sql[index] ?? "")) {
    index += 1;
  }
  return sql[index];
}

function isIdentifierChar(char: string): boolean {
  return isAsciiLetter(char) || isDigit(char) || char === "_";
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}
