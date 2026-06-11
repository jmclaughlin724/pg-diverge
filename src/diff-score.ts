import type { FixtureManifestEntry } from "./benchmark-fixtures.js";
import type { ObjectKind } from "./core.js";
import type { AstNode } from "./sql/ast.js";
import {
  asRecord,
  astStatements,
  functionIdentity,
  qualifiedName,
  rangeVarName,
  readArray,
  readString,
  stringValue,
} from "./sql/ast.js";
import { objectKey } from "./sql/identifiers.js";
import { parseSqlAst } from "./sql/parser.js";

export interface DiffOutputScore {
  classifiedStatements: number;
  excess: string[];
  f1: number;
  matched: number;
  missed: string[];
  precision: number;
  recall: number;
}

interface ClassifiedStatement {
  destructive: boolean;
  keys: string[];
}

const unclassified: ClassifiedStatement = { destructive: false, keys: [] };

export async function scoreDiffOutput(
  sql: string,
  manifest: FixtureManifestEntry[],
): Promise<DiffOutputScore> {
  const emittedKeys = new Set<string>();
  const destructiveKeys = new Set<string>();
  let classifiedStatements = 0;
  const classify = async (text: string): Promise<void> => {
    const parsed = await parseSqlAst(text, "diff-score");
    if (parsed.ast === undefined) {
      return;
    }
    for (const statement of astStatements(parsed.ast, text)) {
      const classified = statementKeys(statement.tag, statement.node);
      if (classified === "do-block") {
        for (const segment of doBlockStatements(statement.node)) {
          await classify(segment);
        }
        continue;
      }
      if (classified.keys.length === 0) {
        continue;
      }
      classifiedStatements += 1;
      for (const key of classified.keys) {
        emittedKeys.add(key);
        if (classified.destructive) {
          destructiveKeys.add(key);
        }
      }
    }
  };
  await classify(sql);
  const manifestKeys = new Set(manifest.map((entry) => entry.key));
  const missed = [...manifestKeys].filter((key) => !emittedKeys.has(key)).sort();
  const excess = [...emittedKeys]
    .filter((key) => !manifestKeys.has(key) || destructiveKeys.has(key))
    .sort();
  const matched = manifestKeys.size - missed.length;
  const recall = manifestKeys.size === 0 ? 1 : matched / manifestKeys.size;
  const precision =
    emittedKeys.size === 0 ? 1 : (emittedKeys.size - excess.length) / emittedKeys.size;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { classifiedStatements, excess, f1, matched, missed, precision, recall };
}

function keysOf(keys: string[], destructive = false): ClassifiedStatement {
  return { destructive, keys };
}

function statementKeys(tag: string, statementNode: AstNode): ClassifiedStatement | "do-block" {
  const node = asRecord(statementNode[tag]) ?? {};
  switch (tag) {
    case "DoStmt":
      return "do-block";
    case "CreateStmt": {
      const name = rangeVarName(node.relation);
      return name ? keysOf([objectKey({ kind: "table", ...name })]) : unclassified;
    }
    case "CreateTableAsStmt": {
      const name = rangeVarName(asRecord(node.into)?.rel);
      const kind = readString(node.objtype) === "OBJECT_MATVIEW" ? "materialized-view" : "table";
      return name ? keysOf([objectKey({ kind, ...name })]) : unclassified;
    }
    case "RefreshMatViewStmt": {
      const name = rangeVarName(node.relation);
      return name ? keysOf([objectKey({ kind: "materialized-view", ...name })]) : unclassified;
    }
    case "AlterTableStmt":
      return keysOf(alterTableKeys(node));
    case "IndexStmt": {
      const table = rangeVarName(node.relation);
      const index = readString(node.idxname);
      return table && index
        ? keysOf([
            objectKey({ kind: "index", name: index, schema: table.schema, table: table.name }),
          ])
        : unclassified;
    }
    case "CreateFunctionStmt": {
      const identity = functionIdentity(node.funcname, node.parameters);
      return identity ? keysOf([objectKey({ kind: "function", ...identity })]) : unclassified;
    }
    case "ViewStmt": {
      const name = rangeVarName(node.view);
      return name ? keysOf([objectKey({ kind: "view", ...name })]) : unclassified;
    }
    case "CreatePolicyStmt": {
      const table = rangeVarName(node.table);
      const policy = readString(node.policy_name);
      return table && policy
        ? keysOf([
            objectKey({ kind: "policy", name: policy, schema: table.schema, table: table.name }),
          ])
        : unclassified;
    }
    case "AlterEnumStmt": {
      const name = qualifiedName(node.typeName);
      return name ? keysOf([objectKey({ kind: "enum", ...name })]) : unclassified;
    }
    case "CreateEnumStmt": {
      const name = qualifiedName(node.typeName);
      return name ? keysOf([objectKey({ kind: "enum", ...name })]) : unclassified;
    }
    case "CreateTrigStmt": {
      const table = rangeVarName(node.relation);
      const trigger = readString(node.trigname);
      return table && trigger
        ? keysOf([
            objectKey({ kind: "trigger", name: trigger, schema: table.schema, table: table.name }),
          ])
        : unclassified;
    }
    case "DropStmt":
      return keysOf(dropKeys(node), dataBearingDropTypes.has(readString(node.removeType) ?? ""));
    default:
      return unclassified;
  }
}

function alterTableKeys(node: AstNode): string[] {
  const table = rangeVarName(node.relation);
  if (!table) {
    return [];
  }
  const keys: string[] = [];
  for (const item of readArray(node.cmds)) {
    const command = asRecord(asRecord(item)?.AlterTableCmd);
    const subtype = readString(command?.subtype);
    if (subtype === "AT_AddConstraint") {
      const name = readString(asRecord(asRecord(command?.def)?.Constraint)?.conname);
      if (name) {
        keys.push(objectKey({ kind: "constraint", name, schema: table.schema, table: table.name }));
        continue;
      }
    }
    if (subtype === "AT_EnableRowSecurity" || subtype === "AT_DisableRowSecurity") {
      keys.push(
        objectKey({ kind: "rls", name: table.name, schema: table.schema, table: table.name }),
      );
      continue;
    }
    keys.push(objectKey({ kind: "table", ...table }));
  }
  return [...new Set(keys)];
}

const dataBearingDropTypes = new Set([
  "OBJECT_DOMAIN",
  "OBJECT_MATVIEW",
  "OBJECT_SCHEMA",
  "OBJECT_SEQUENCE",
  "OBJECT_TABLE",
  "OBJECT_TYPE",
]);

const plainDropKinds = new Map<string, ObjectKind>([
  ["OBJECT_INDEX", "index"],
  ["OBJECT_MATVIEW", "materialized-view"],
  ["OBJECT_SCHEMA", "schema"],
  ["OBJECT_SEQUENCE", "sequence"],
  ["OBJECT_TABLE", "table"],
  ["OBJECT_VIEW", "view"],
]);

const tableScopedDropKinds = new Map<string, ObjectKind>([
  ["OBJECT_POLICY", "policy"],
  ["OBJECT_TRIGGER", "trigger"],
]);

const typeDropKinds = new Map<string, ObjectKind>([
  ["OBJECT_DOMAIN", "domain"],
  ["OBJECT_TYPE", "enum"],
]);

function dropKeys(node: AstNode): string[] {
  const removeType = readString(node.removeType) ?? "";
  const keys: string[] = [];
  for (const object of readArray(node.objects)) {
    const plainKind = plainDropKinds.get(removeType);
    if (plainKind) {
      const parts = objectNameParts(object);
      const name = parts.at(-1);
      if (name && removeType === "OBJECT_SCHEMA") {
        keys.push(objectKey({ kind: plainKind, name }));
      } else if (name) {
        const schema = parts.length > 1 ? (parts.at(-2) ?? "public") : "public";
        keys.push(objectKey({ kind: plainKind, name, schema }));
      }
      continue;
    }
    const tableScopedKind = tableScopedDropKinds.get(removeType);
    if (tableScopedKind) {
      const parts = objectNameParts(object);
      const name = parts.at(-1);
      const table = parts.at(-2);
      if (name && table) {
        keys.push(
          objectKey({
            kind: tableScopedKind,
            name,
            schema: parts.length > 2 ? (parts.at(-3) ?? "public") : "public",
            table,
          }),
        );
      }
      continue;
    }
    const typeKind = typeDropKinds.get(removeType);
    if (typeKind) {
      const name = qualifiedName(asRecord(asRecord(object)?.TypeName)?.names);
      if (name) {
        keys.push(objectKey({ kind: typeKind, ...name }));
      }
      continue;
    }
    if (removeType === "OBJECT_FUNCTION" || removeType === "OBJECT_PROCEDURE") {
      const name = qualifiedName(asRecord(asRecord(object)?.ObjectWithArgs)?.objname);
      if (name) {
        keys.push(objectKey({ kind: "function", ...name }));
      }
    }
  }
  return keys;
}

function objectNameParts(object: unknown): string[] {
  return readArray(asRecord(object)?.List ? asRecord(asRecord(object)?.List)?.items : object)
    .map((item) => stringValue(item))
    .filter((item): item is string => item !== undefined);
}

function doBlockStatements(statementNode: AstNode): string[] {
  const node = asRecord(statementNode.DoStmt);
  for (const item of readArray(node?.args)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "as") {
      continue;
    }
    const body = stringValue(defElem?.arg);
    return body ? guardedBodySegments(body) : [];
  }
  return [];
}

function guardedBodySegments(body: string): string[] {
  const thenOffsets = keywordOffsets(body, "then");
  const endIfOffsets = keywordOffsets(body, "end").filter((offset) =>
    nextKeywordIs(body, offset + "end".length, "if"),
  );
  const segments: string[] = [];
  let cursor = -1;
  for (const endIf of endIfOffsets) {
    const start = thenOffsets.find((offset) => offset > cursor && offset < endIf);
    if (start === undefined) {
      continue;
    }
    segments.push(body.slice(start + "then".length, endIf));
    cursor = endIf;
  }
  if (segments.length > 0) {
    return segments;
  }
  const begin = keywordOffsets(body, "begin").at(0);
  const lastEnd = keywordOffsets(body, "end").at(-1);
  if (begin !== undefined && lastEnd !== undefined && lastEnd > begin) {
    return [body.slice(begin + "begin".length, lastEnd)];
  }
  return [body];
}

const whitespaceChars = " \t\n\r";

function nextKeywordIs(text: string, from: number, word: string): boolean {
  let index = from;
  while (index < text.length && whitespaceChars.includes(text[index] ?? "")) {
    index += 1;
  }
  return isKeywordAt(text, index, word);
}

function isKeywordAt(text: string, offset: number, word: string): boolean {
  if (text.slice(offset, offset + word.length).toLowerCase() !== word) {
    return false;
  }
  return !(isWordChar(text[offset - 1]) || isWordChar(text[offset + word.length]));
}

function isWordChar(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  );
}

function keywordOffsets(text: string, word: string): number[] {
  const offsets: number[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (char === "-" && next === "-") {
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const blockEnd = text.indexOf("*/", index + 2);
      index = blockEnd === -1 ? text.length : blockEnd + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      index = skipQuoted(text, index, char);
      continue;
    }
    if (char === "$") {
      const skipped = skipDollarQuoted(text, index);
      if (skipped > index) {
        index = skipped;
        continue;
      }
    }
    if (isKeywordAt(text, index, word)) {
      offsets.push(index);
      index += word.length;
      continue;
    }
    index += 1;
  }
  return offsets;
}

function skipQuoted(text: string, from: number, quote: string): number {
  let index = from + 1;
  while (index < text.length) {
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function skipDollarQuoted(text: string, from: number): number {
  let tagEnd = from + 1;
  while (tagEnd < text.length && (isWordChar(text[tagEnd]) || text[tagEnd] === "$")) {
    if (text[tagEnd] === "$") {
      const tag = text.slice(from, tagEnd + 1);
      const close = text.indexOf(tag, tagEnd + 1);
      return close === -1 ? text.length : close + tag.length;
    }
    tagEnd += 1;
  }
  return from;
}
