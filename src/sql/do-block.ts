import type { AstNode } from "./ast.js";
import { asRecord, readArray, readString } from "./ast.js";

export interface DoBlockDdlFragment {
  idempotentCreate: boolean;
  sql: string;
}

export type DoBlockClassification = "idempotent-role" | "other" | "unsafe-role";

const doBlockDdlStartTokens = new Set(["alter", "comment", "create", "drop", "grant", "revoke"]);
const digitStart = "0".charCodeAt(0);
const digitEnd = "9".charCodeAt(0);
const uppercaseStart = "A".charCodeAt(0);
const uppercaseEnd = "Z".charCodeAt(0);
const underscore = "_".charCodeAt(0);
const lowercaseStart = "a".charCodeAt(0);
const lowercaseEnd = "z".charCodeAt(0);
const dollarSign = "$".charCodeAt(0);

export function classifyDoBlock(node: AstNode): DoBlockClassification {
  const body = doBlockBody(node);
  if (body === undefined || !containsCreateRole(body)) {
    return "other";
  }
  const language = doBlockLanguage(node);
  if (language !== undefined && language.toLowerCase() !== "plpgsql") {
    return "unsafe-role";
  }
  return isIdempotentRoleBody(body) ? "idempotent-role" : "unsafe-role";
}

export function doBlockBody(node: AstNode): string | undefined {
  for (const item of readArray(node.args)) {
    const def = asRecord(asRecord(item)?.DefElem);
    if (readString(def?.defname) === "as") {
      return stringNode(def?.arg);
    }
  }
}

export function doBlockDdlFragments(body: string): DoBlockDdlFragment[] {
  const fragments: DoBlockDdlFragment[] = [];
  let idempotentGuardDepth = 0;
  for (const statement of splitDoBlockStatements(body)) {
    const tokens = tokenSpans(statement);
    const startTokenIndex = tokens.findIndex((token) => doBlockDdlStartTokens.has(token.text));
    const localGuard = isIdempotentGuard(tokens, startTokenIndex);
    const fragment = doBlockDdlFragment(
      statement,
      tokens,
      startTokenIndex,
      localGuard || idempotentGuardDepth > 0
    );
    if (fragment === undefined) {
      if (isEndIfStatement(tokens)) {
        idempotentGuardDepth = Math.max(0, idempotentGuardDepth - 1);
      }
      continue;
    }
    fragments.push(fragment);
    if (localGuard) {
      idempotentGuardDepth += 1;
    }
    if (isEndIfStatement(tokens)) {
      idempotentGuardDepth = Math.max(0, idempotentGuardDepth - 1);
    }
  }
  return fragments;
}

function doBlockLanguage(node: AstNode): string | undefined {
  for (const item of readArray(node.args)) {
    const def = asRecord(asRecord(item)?.DefElem);
    if (readString(def?.defname) === "language") {
      return stringNode(def?.arg);
    }
  }
}

function stringNode(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  return readString(record?.sval) ?? readString(asRecord(record?.String)?.sval);
}

function containsCreateRole(body: string): boolean {
  const tokens = tokenSpans(body);
  return tokens.some(
    (token, index) => token.text === "create" && tokens[index + 1]?.text === "role"
  );
}

function isIdempotentRoleBody(body: string): boolean {
  const statements = splitDoBlockStatements(body).filter(
    (statement) => tokenSpans(statement).length > 0
  );
  if (statements.length !== 3) {
    return false;
  }
  const create = statements[0] ?? "";
  const handler = statements[1] ?? "";
  const end = statements[2] ?? "";
  if (!(hasOnlyBareIdentifierText(create) && hasOnlyBareIdentifierText(handler))) {
    return false;
  }
  const createTokens = tokenSpans(create);
  const handlerTokens = tokenSpans(handler);
  const endTokens = tokenSpans(end);
  if (
    createTokens.map((token) => token.text).join(" ") !==
      `begin create role ${createTokens[3]?.text ?? ""} nologin` ||
    handlerTokens.map((token) => token.text).join(" ") !==
      "exception when duplicate_object then null" ||
    endTokens.map((token) => token.text).join(" ") !== "end"
  ) {
    return false;
  }
  const roleKeyword = createTokens[2];
  const roleName = createTokens[3];
  const noLogin = createTokens[4];
  if (!(roleKeyword && roleName && noLogin)) {
    return false;
  }
  const rawRoleName = create.slice(roleKeyword.end, noLogin.start).trim();
  return rawRoleName === roleName.text && isBareIdentifier(rawRoleName);
}

function hasOnlyBareIdentifierText(value: string): boolean {
  for (const char of value) {
    if (!(isIdentifierPart(char) || isWhitespace(char))) {
      return false;
    }
  }
  return true;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function isBareIdentifier(value: string): boolean {
  if (!isIdentifierStart(value[0] ?? "")) {
    return false;
  }
  for (let index = 1; index < value.length; index += 1) {
    if (!isIdentifierPart(value[index] ?? "")) {
      return false;
    }
  }
  return true;
}

function doBlockDdlFragment(
  statement: string,
  tokens: { end: number; start: number; text: string }[],
  startTokenIndex: number,
  idempotentCreate: boolean
): DoBlockDdlFragment | undefined {
  const start = tokens[startTokenIndex]?.start;
  if (start === undefined) {
    return;
  }
  const sql = statement.slice(start).trim();
  if (sql.length === 0) {
    return;
  }
  return { idempotentCreate, sql };
}

function isIdempotentGuard(tokens: { text: string }[], startTokenIndex: number): boolean {
  if (startTokenIndex <= 0) {
    return false;
  }
  const guardTokens = tokens.slice(0, startTokenIndex).map((token) => token.text);
  return (
    guardTokens.includes("if") && guardTokens.includes("not") && guardTokens.includes("exists")
  );
}

function isEndIfStatement(tokens: { text: string }[]): boolean {
  return tokens[0]?.text === "end" && tokens[1]?.text === "if";
}

function splitDoBlockStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  while (index < body.length) {
    const skipped = skipNonCode(body, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    if (body[index] === ";") {
      statements.push(body.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  statements.push(body.slice(start));
  return statements;
}

function tokenSpans(sql: string): { end: number; start: number; text: string }[] {
  const tokens: { end: number; start: number; text: string }[] = [];
  let index = 0;
  while (index < sql.length) {
    const skipped = skipNonCode(sql, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    const char = sql[index] ?? "";
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

function skipNonCode(sql: string, index: number): number | undefined {
  const char = sql[index] ?? "";
  if (char === "'") {
    return skipSingleQuoted(sql, index);
  }
  if (char === '"') {
    return skipDoubleQuoted(sql, index);
  }
  if (char === "$") {
    return skipDollarQuoted(sql, index);
  }
  if (char === "-" && sql[index + 1] === "-") {
    return skipLineComment(sql, index);
  }
  if (char === "/" && sql[index + 1] === "*") {
    return skipBlockComment(sql, index);
  }
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
  const tagEnd = sql.indexOf("$", start + 1);
  if (tagEnd === -1) {
    return;
  }
  const tag = sql.slice(start, tagEnd + 1);
  if (!isDollarQuoteTag(tag)) {
    return;
  }
  const end = sql.indexOf(tag, tagEnd + 1);
  return end === -1 ? sql.length : end + tag.length;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}

function isIdentifierStart(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === underscore || isAsciiLetter(code);
}

function isIdentifierPart(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === dollarSign ||
    code === underscore ||
    isAsciiLetter(code) ||
    (code >= digitStart && code <= digitEnd)
  );
}

function isDollarQuoteTag(tag: string): boolean {
  if (tag === "$$") {
    return true;
  }
  if (tag.length < 3 || tag.charCodeAt(0) !== dollarSign || tag.at(-1) !== "$") {
    return false;
  }
  if (!isIdentifierStart(tag[1] ?? "")) {
    return false;
  }
  for (let index = 2; index < tag.length - 1; index += 1) {
    if (!isIdentifierPart(tag[index] ?? "")) {
      return false;
    }
  }
  return true;
}

function isAsciiLetter(code: number): boolean {
  return (
    (code >= uppercaseStart && code <= uppercaseEnd) ||
    (code >= lowercaseStart && code <= lowercaseEnd)
  );
}
