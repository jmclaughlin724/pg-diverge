import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MigrationIntent } from "../core.js";
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

interface ReadMigrationIntentOptions {
  cwd?: string;
}

export async function readMigrationIntent(
  migrationsDir: string,
  options: ReadMigrationIntentOptions = {}
): Promise<MigrationIntent> {
  const cwd = options.cwd ?? process.cwd();
  const directory = resolve(cwd, migrationsDir);
  const files = await migrationFiles(directory);
  const intent: MigrationIntent = {
    destructiveKeys: [],
    diagnostics: [],
    tableColumnDrops: [],
  };
  const destructiveKeys = new Set<string>();
  const tableColumnDrops = new Set<string>();
  for (const file of files) {
    await readMigrationFileIntent(file, destructiveKeys, tableColumnDrops, intent);
  }
  intent.destructiveKeys = [...destructiveKeys].sort((left, right) => left.localeCompare(right));
  intent.tableColumnDrops = [...tableColumnDrops].sort((left, right) => left.localeCompare(right));
  return intent;
}

async function readMigrationFileIntent(
  file: string,
  destructiveKeys: Set<string>,
  tableColumnDrops: Set<string>,
  intent: MigrationIntent
): Promise<void> {
  const sql = await readFile(file, "utf8");
  const parsed = await parseSqlAst(sql, file);
  intent.diagnostics.push(...migrationIntentParseDiagnostics(parsed.diagnostics, file));
  if (parsed.ast === undefined) {
    return;
  }
  for (const statement of astStatements(parsed.ast, sql)) {
    const node = asRecord(statement.node[statement.tag]);
    if (!node) {
      continue;
    }
    if (statement.tag === "DropStmt") {
      collectDropStmtIntent(node, destructiveKeys);
    }
    if (statement.tag === "AlterTableStmt") {
      collectAlterTableStmtIntent(node, tableColumnDrops);
    }
  }
}

function migrationIntentParseDiagnostics(
  diagnostics: MigrationIntent["diagnostics"],
  file: string
) {
  return diagnostics.map((item) =>
    diagnostic(
      "SUPA_MIGRATION_INTENT_PARSE_SKIPPED",
      item.severity === "error" ? "warning" : item.severity,
      `Could not fully read migration source intent: ${item.message}`,
      {
        file,
        hint: "Existing destructive changes in this migration may still require explicit hints.",
      }
    )
  );
}

function collectDropStmtIntent(node: Record<string, unknown>, destructiveKeys: Set<string>): void {
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
      destructiveKeys.add(`${kind}:${identity.schema}.${identity.name}(${identity.signature})`);
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

function collectAlterTableStmtIntent(
  node: Record<string, unknown>,
  tableColumnDrops: Set<string>
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
    if (readString(command?.subtype) !== "AT_DropColumn") {
      continue;
    }
    const column = readString(command?.name);
    if (column) {
      tableColumnDrops.add(`${tableKey}.${column}`);
    }
  }
}
