import { deparseSync } from "pgsql-deparser";
import type { Diagnostic, SchemaObject } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { sha256, stableJson } from "../hash.js";
import type { AstStatement } from "./ast.js";
import { astStatements } from "./ast.js";
import { normalizeSql } from "./identifiers.js";
import { stripLocations } from "./object-hash.js";
import { parseSqlAst } from "./parser.js";

export interface NormalizeResult {
  diagnostics: Diagnostic[];
  sql?: string;
  statements?: AstStatement[];
}

/**
 * Canonical-output normalization: the parse tree supaschema already computed
 * is deparsed back to SQL through PostgreSQL's grammar (pgsql-deparser, the
 * pure-TypeScript companion of the installed libpg-query binding). The
 * normalized text is accepted only when reparsing it yields a
 * location-stripped parse tree identical to the original — a deparser
 * infidelity therefore falls back to the author's text with a warning
 * instead of silently changing semantics.
 */
export async function normalizeObjectSql(
  object: SchemaObject,
  ast: unknown
): Promise<NormalizeResult> {
  let text: string;
  try {
    text = deparseSync(ast as Parameters<typeof deparseSync>[0]);
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

/**
 * Round-trip fidelity proof over rendered migration SQL: every statement
 * must deparse and reparse back to an identical location-stripped parse
 * tree. This is the always-on telemetry that makes `normalize: "deparse"`
 * trustworthy exactly where it would be used.
 */
export async function deparseFidelityDiagnostics(sql: string): Promise<Diagnostic[]> {
  const parsed = await parseSqlAst(sql);
  if (parsed.ast === undefined) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  for (const statement of astStatements(parsed.ast, sql)) {
    let text: string;
    try {
      text = deparseSync({
        stmts: [{ stmt: statement.node }],
        version: 170_004,
      } as unknown as Parameters<typeof deparseSync>[0]);
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
  if (typeof ast !== "object" || ast === null) {
    return [];
  }
  const stmts = (ast as { stmts?: unknown }).stmts;
  if (!Array.isArray(stmts)) {
    return [];
  }
  return stmts.map((item) => (item as { stmt?: unknown }).stmt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
