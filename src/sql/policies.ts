import {
  type AstNode,
  asRecord,
  astStatements,
  collectColumnReferences,
  readString,
} from "./ast.js";
import { parseSqlAst } from "./parser.js";

export function policyMetadataFromAst(node: AstNode): Record<string, unknown> {
  const usingColumns = [...collectColumnReferences(node.qual)].sort();
  const checkColumns = [...collectColumnReferences(node.with_check)].sort();
  return {
    command: readString(node.cmd_name)?.toLowerCase() ?? "all",
    hasCheckPredicate: node.with_check !== undefined,
    hasUsingPredicate: node.qual !== undefined,
    ...(checkColumns.length === 0 ? {} : { checkColumns }),
    ...(usingColumns.length === 0 ? {} : { usingColumns }),
  };
}

export async function policyMetadataFromSql(sql: string): Promise<Record<string, unknown>> {
  const parsed = await parseSqlAst(sql);
  for (const statement of astStatements(parsed.ast, sql)) {
    const policy = asRecord(statement.node.CreatePolicyStmt);
    if (policy !== undefined) {
      return policyMetadataFromAst(policy);
    }
  }
  return {};
}
