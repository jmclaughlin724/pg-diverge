import { deparseSync } from "pgsql-deparser";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { sha256, stableJson } from "../hash.js";
import type { Diagnostic, SchemaObject } from "../types.js";
import type { AstStatement } from "./ast.js";
import { asRecord, astStatements } from "./ast.js";
import { normalizeSql } from "./identifiers.js";
import { stripLocations } from "./object-hash.js";
import { parseSqlAst } from "./parser.js";
import { hasKnownObjectDeparseGap, hasKnownStatementDeparseGap } from "./support.js";

export interface NormalizeResult {
  diagnostics: Diagnostic[];
  sql?: string;
  statements?: AstStatement[];
}

export async function normalizeObjectSql(
  object: SchemaObject,
  ast: unknown
): Promise<NormalizeResult> {
  const originalStatements = astStatements(ast, object.sql);
  if (hasKnownObjectDeparseGap(object, originalStatements)) {
    return { diagnostics: [] };
  }
  let text: string;
  try {
    text = deparseSync(JSON.parse(JSON.stringify(ast)));
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          "SUPA_NORMALIZE_UNSUPPORTED",
          "warning",
          `deparser cannot render ${object.key}; keeping the source text (${errorMessage(error)})`,
          { file: object.file, ref: object.ref }
        ),
      ],
    };
  }
  const cleaned = normalizeSql(text);
  const reparsed = await parseSqlAst(cleaned, object.file);
  const statements = reparsed.ast === undefined ? [] : astStatements(reparsed.ast, cleaned);
  if (statements.length === 0 || !astEquals(ast, reparsed.ast)) {
    return {
      diagnostics: [
        diagnostic(
          "SUPA_NORMALIZE_FIDELITY",
          "warning",
          `deparsed SQL for ${object.key} does not reparse to the same parse tree; keeping the source text`,
          { file: object.file, ref: object.ref }
        ),
      ],
    };
  }
  return { diagnostics: [], sql: cleaned, statements };
}

export async function deparseFidelityDiagnostics(sql: string): Promise<Diagnostic[]> {
  const parsed = await parseSqlAst(sql);
  if (parsed.ast === undefined) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  for (const statement of astStatements(parsed.ast, sql)) {
    if (hasKnownStatementDeparseGap(statement)) {
      continue;
    }
    let text: string;
    try {
      text = deparseSync(
        JSON.parse(
          JSON.stringify({
            stmts: [{ stmt: statement.node }],
            version: 170_004,
          })
        )
      );
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "SUPA_CHECK_DEPARSE_UNSUPPORTED",
          "warning",
          `statement cannot be deparsed for round-trip proof (${errorMessage(error)})`,
          { statement: statement.text }
        )
      );
      continue;
    }
    const reparsed = await parseSqlAst(text);
    const second = reparsed.ast === undefined ? [] : astStatements(reparsed.ast, text);
    if (second.length !== 1 || !nodeEquals(statement.node, second[0]?.node)) {
      diagnostics.push(
        diagnostic(
          "SUPA_CHECK_DEPARSE_MISMATCH",
          "warning",
          "statement does not round-trip through the deparser to an identical parse tree",
          { statement: statement.text }
        )
      );
    }
  }
  return diagnostics;
}

function astEquals(left: unknown, right: unknown): boolean {
  const leftStatements = statementNodes(left);
  const rightStatements = statementNodes(right);
  if (leftStatements.length !== rightStatements.length) {
    return false;
  }
  return leftStatements.every((node, index) => nodeEquals(node, rightStatements[index]));
}

function nodeEquals(left: unknown, right: unknown): boolean {
  return sha256(stableJson(stripLocations(left))) === sha256(stableJson(stripLocations(right)));
}

function statementNodes(ast: unknown): unknown[] {
  const record = asRecord(ast);
  if (!record) {
    return [];
  }
  const stmts = record.stmts;
  if (!Array.isArray(stmts)) {
    return [];
  }
  return stmts.map((item) => asRecord(item)?.stmt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
