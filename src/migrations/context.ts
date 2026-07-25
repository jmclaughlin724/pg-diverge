import { readFile, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { diagnostic } from "../diagnostics/diagnostics.js";
import {
  asRecord,
  astStatements,
  objectWithArgsIdentity,
  rangeVarName,
  readArray,
  readString,
} from "../sql/ast.js";
import { parseSqlAst } from "../sql/parser.js";
import type {
  MigrationContext,
  MigrationCorpus,
  MigrationCorpusOperation,
  MigrationCorpusOperationKind,
} from "../types.js";
import { migrationFiles } from "./files.js";
import { parseLineage } from "./lineage.js";
import { migrationFileVersion } from "./status.js";

interface ReadMigrationContextOptions {
  cwd?: string;
  excludeFiles?: readonly string[];
}

export async function readMigrationContext(
  migrationsDir: string,
  options: ReadMigrationContextOptions = {}
): Promise<MigrationContext> {
  const cwd = options.cwd ?? process.cwd();
  const directory = resolve(cwd, migrationsDir);
  const files = await migrationFiles(directory, {
    cwd,
    ...(options.excludeFiles === undefined ? {} : { excludeFiles: options.excludeFiles }),
  });
  const corpus: MigrationCorpus = {
    destructiveKeys: [],
    diagnostics: [],
    operations: [],
    tableColumnDrops: [],
  };
  const destructiveKeys = new Set<string>();
  const tableColumnDrops = new Set<string>();
  const context: MigrationContext = {
    corpus,
    directory: await canonicalPath(directory),
    files,
    unprovenBaselineFiles: [],
  };
  for (const file of files) {
    await readMigrationFileContext(file, migrationsDir, destructiveKeys, tableColumnDrops, context);
  }
  corpus.destructiveKeys = [...destructiveKeys].sort((left, right) => left.localeCompare(right));
  corpus.tableColumnDrops = [...tableColumnDrops].sort((left, right) => left.localeCompare(right));
  corpus.operations.sort((left, right) =>
    `${left.file}:${left.kind}:${left.key ?? ""}:${left.statementTag}`.localeCompare(
      `${right.file}:${right.kind}:${right.key ?? ""}:${right.statementTag}`
    )
  );
  return context;
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function readMigrationFileContext(
  file: string,
  migrationsDir: string,
  destructiveKeys: Set<string>,
  tableColumnDrops: Set<string>,
  context: MigrationContext
): Promise<void> {
  const sql = await readFile(file, "utf8");
  const lineage = parseLineage(sql.slice(0, 4096));
  if (lineage) {
    const version = migrationFileVersion(basename(file));
    context.latestGeneratedBaseline = {
      file,
      fingerprint: lineage.to,
      ...(lineage.modelFormatVersion === undefined
        ? {}
        : { modelFormatVersion: lineage.modelFormatVersion }),
      source: `migration-baseline:${migrationsDir}${version === undefined ? "" : `@${version}`}`,
      ...(version === undefined ? {} : { version }),
    };
    context.unprovenBaselineFiles = [];
  } else {
    context.unprovenBaselineFiles.push(file);
  }
  const parsed = await parseSqlAst(sql, file);
  context.corpus.diagnostics.push(...migrationCorpusParseDiagnostics(parsed.diagnostics, file));
  if (parsed.ast === undefined) {
    return;
  }
  for (const statement of astStatements(parsed.ast, sql)) {
    const node = asRecord(statement.node[statement.tag]);
    if (!node) {
      continue;
    }
    if (statement.tag === "DropStmt") {
      collectDropStmtCorpus(node, file, destructiveKeys, context.corpus.operations);
    }
    if (statement.tag === "AlterTableStmt") {
      collectAlterTableStmtCorpus(node, file, tableColumnDrops, context.corpus.operations);
    }
    collectStatementCorpus(statement.tag, node, file, context.corpus.operations);
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
  node: Record<string, unknown>,
  file: string,
  operations: MigrationCorpusOperation[]
): void {
  const kind = statementCorpusKind(statementTag);
  if (kind) {
    const key = dataStatementTableKey(statementTag, node);
    operations.push(
      key === undefined ? { file, kind, statementTag } : { file, key, kind, statementTag }
    );
  }
}

function dataStatementTableKey(
  statementTag: string,
  node: Record<string, unknown>
): string | undefined {
  if (
    statementTag !== "InsertStmt" &&
    statementTag !== "UpdateStmt" &&
    statementTag !== "DeleteStmt" &&
    statementTag !== "MergeStmt"
  ) {
    return;
  }
  const relation = rangeVarName(node.relation);
  return relation ? `table:${relation.schema}.${relation.name}` : undefined;
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
    case "MergeStmt":
      return "data-statement";
    case "AlterEnumStmt":
      return "enum-rewrite";
    default:
      return;
  }
}
