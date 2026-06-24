import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  MigrationCorpus,
  MigrationCorpusOperation,
  MigrationCorpusOperationKind,
} from "../core.js";
import { diagnostic } from "../diagnostics.js";
import {
  asRecord,
  astStatements,
  objectWithArgsIdentity,
  rangeVarName,
  readArray,
  readString,
} from "../sql/ast.js";
import { parseSqlAst } from "../sql/parser.js";
import { migrationFiles } from "./files.js";

interface ReadMigrationCorpusOptions {
  cwd?: string;
}

export async function readMigrationCorpus(
  migrationsDir: string,
  options: ReadMigrationCorpusOptions = {}
): Promise<MigrationCorpus> {
  const cwd = options.cwd ?? process.cwd();
  const directory = resolve(cwd, migrationsDir);
  const files = await migrationFiles(directory);
  const corpus: MigrationCorpus = {
    destructiveKeys: [],
    diagnostics: [],
    operations: [],
    tableColumnDrops: [],
  };
  const destructiveKeys = new Set<string>();
  const tableColumnDrops = new Set<string>();
  for (const file of files) {
    await readMigrationFileCorpus(file, destructiveKeys, tableColumnDrops, corpus);
  }
  corpus.destructiveKeys = [...destructiveKeys].sort((left, right) => left.localeCompare(right));
  corpus.tableColumnDrops = [...tableColumnDrops].sort((left, right) => left.localeCompare(right));
  corpus.operations.sort((left, right) =>
    `${left.file}:${left.kind}:${left.key ?? ""}:${left.statementTag}`.localeCompare(
      `${right.file}:${right.kind}:${right.key ?? ""}:${right.statementTag}`
    )
  );
  return corpus;
}

async function readMigrationFileCorpus(
  file: string,
  destructiveKeys: Set<string>,
  tableColumnDrops: Set<string>,
  corpus: MigrationCorpus
): Promise<void> {
  const sql = await readFile(file, "utf8");
  const parsed = await parseSqlAst(sql, file);
  corpus.diagnostics.push(...migrationCorpusParseDiagnostics(parsed.diagnostics, file));
  if (parsed.ast === undefined) {
    return;
  }
  for (const statement of astStatements(parsed.ast, sql)) {
    const node = asRecord(statement.node[statement.tag]);
    if (!node) {
      continue;
    }
    if (statement.tag === "DropStmt") {
      collectDropStmtCorpus(node, file, destructiveKeys, corpus.operations);
    }
    if (statement.tag === "AlterTableStmt") {
      collectAlterTableStmtCorpus(node, file, tableColumnDrops, corpus.operations);
    }
    collectStatementCorpus(statement.tag, file, corpus.operations);
  }
}

function migrationCorpusParseDiagnostics(
  diagnostics: MigrationCorpus["diagnostics"],
  file: string
) {
  return diagnostics.map((item) =>
    diagnostic(
      "SUPA_MIGRATION_CORPUS_PARSE_SKIPPED",
      item.severity === "error" ? "warning" : item.severity,
      `Could not fully read migration source intent: ${item.message}`,
      {
        file,
        hint: "Existing destructive changes in this migration may still require explicit hints.",
      }
    )
  );
}

function collectDropStmtCorpus(
  node: Record<string, unknown>,
  file: string,
  destructiveKeys: Set<string>,
  operations: MigrationCorpusOperation[]
): void {
  const removeType = readString(node.removeType);
  if (
    removeType !== "OBJECT_FUNCTION" &&
    removeType !== "OBJECT_PROCEDURE" &&
    removeType !== "OBJECT_ROUTINE"
  ) {
    return;
  }
  for (const object of readArray(node.objects)) {
    const identity = objectWithArgsIdentity(object);
    if (!identity) {
      continue;
    }
    for (const kind of dropKindsForRemoveType(removeType)) {
      const key = `${kind}:${identity.schema}.${identity.name}(${identity.signature})`;
      destructiveKeys.add(key);
      operations.push({ file, key, kind: "drop", statementTag: "DropStmt" });
    }
  }
}

function dropKindsForRemoveType(removeType: string): ("function" | "procedure")[] {
  if (removeType === "OBJECT_FUNCTION") {
    return ["function"];
  }
  if (removeType === "OBJECT_PROCEDURE") {
    return ["procedure"];
  }
  return ["function", "procedure"];
}

function collectAlterTableStmtCorpus(
  node: Record<string, unknown>,
  file: string,
  tableColumnDrops: Set<string>,
  operations: MigrationCorpusOperation[]
): void {
  if (readString(node.objtype) !== "OBJECT_TABLE") {
    return;
  }
  const table = rangeVarName(node.relation);
  if (!table) {
    return;
  }
  const tableKey = `table:${table.schema}.${table.name}`;
  for (const item of readArray(node.cmds)) {
    const command = asRecord(asRecord(item)?.AlterTableCmd);
    const subtype = readString(command?.subtype);
    const column = readString(command?.name);
    if (subtype === "AT_DropColumn" && column) {
      const key = `${tableKey}.${column}`;
      tableColumnDrops.add(key);
      operations.push({ file, key, kind: "table-column-drop", statementTag: "AlterTableStmt" });
      continue;
    }
    const kind = alterTableCorpusKind(subtype);
    if (kind) {
      const key = column ? `${tableKey}.${column}` : tableKey;
      operations.push({ file, key, kind, statementTag: "AlterTableStmt" });
    }
  }
}

function collectStatementCorpus(
  statementTag: string,
  file: string,
  operations: MigrationCorpusOperation[]
): void {
  const kind = statementCorpusKind(statementTag);
  if (kind) {
    operations.push({ file, kind, statementTag });
  }
}

function alterTableCorpusKind(
  subtype: string | undefined
): MigrationCorpusOperationKind | undefined {
  switch (subtype) {
    case "AT_AddConstraint":
    case "AT_DropConstraint":
      return "constraint";
    case "AT_AlterColumnType":
      return "table-column-type";
    case "AT_ColumnDefault":
      return "table-column-default";
    case "AT_SetExpression":
    case "AT_DropExpression":
      return "table-column-generated";
    case "AT_AddIdentity":
    case "AT_SetIdentity":
    case "AT_DropIdentity":
      return "table-column-identity";
    default:
      return;
  }
}

function statementCorpusKind(statementTag: string): MigrationCorpusOperationKind | undefined {
  switch (statementTag) {
    case "CreateFunctionStmt":
      return "routine";
    case "DoStmt":
      return "do-block";
    case "IndexStmt":
      return "index";
    case "InsertStmt":
    case "UpdateStmt":
    case "DeleteStmt":
      return "data-statement";
    case "AlterEnumStmt":
      return "enum-rewrite";
    default:
      return;
  }
}
