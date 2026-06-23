import { resolveConfig } from "../config/schema.js";
import type { CheckOptions, Diagnostic } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstNode, AstStatement } from "../sql/ast.js";
import {
  asRecord,
  astStatements,
  readArray,
  readBoolean,
  readString,
  stringList,
} from "../sql/ast.js";
import { deparseFidelityDiagnostics } from "../sql/normalize-deparse.js";
import { parseSqlAst } from "../sql/parser.js";
import { runConfiguredValidators } from "../validators.js";
import {
  enumValueUseDiagnostics,
  escalateNontransactional,
  newEnumAdditionState,
  recordEnumAdditions,
} from "./hazards.js";

const guardedCreateChecks: { code: string; kind: string; tag: string }[] = [
  { code: "SUPA_CHECK_CREATE_SCHEMA_GUARD", kind: "SCHEMA", tag: "CreateSchemaStmt" },
  { code: "SUPA_CHECK_CREATE_EXTENSION_GUARD", kind: "EXTENSION", tag: "CreateExtensionStmt" },
  { code: "SUPA_CHECK_CREATE_TABLE_GUARD", kind: "TABLE", tag: "CreateStmt" },
  { code: "SUPA_CHECK_CREATE_SEQUENCE_GUARD", kind: "SEQUENCE", tag: "CreateSeqStmt" },
  { code: "SUPA_CHECK_CREATE_INDEX_GUARD", kind: "INDEX", tag: "IndexStmt" },
];

const volatileDefaultFunctions = new Set([
  "clock_timestamp",
  "gen_random_uuid",
  "nextval",
  "random",
  "timeofday",
  "uuid_generate_v1",
  "uuid_generate_v4",
]);

type StatementCheck = (
  node: AstNode,
  statement: AstStatement,
  previous: AstStatement | undefined
) => Diagnostic[];

const statementChecks: Partial<Record<string, StatementCheck>> = {
  AlterTableStmt: (node, statement) => checkAlterTableStatement(node, statement.text),
  CompositeTypeStmt: (_node, statement) => checkTypeCreationStatement(statement.text),
  CreateDomainStmt: (_node, statement) => checkTypeCreationStatement(statement.text),
  CreateEnumStmt: (_node, statement) => checkTypeCreationStatement(statement.text),
  CreateFunctionStmt: (node, statement) => checkFunctionStatement(node, statement.text),
  CreatePolicyStmt: (_node, statement, previous) => checkPolicyStatement(previous, statement.text),
  CreateRangeStmt: (_node, statement) => checkTypeCreationStatement(statement.text),
  CreateTableAsStmt: (node, statement) => checkMaterializedViewStatement(node, statement.text),
  CreateTrigStmt: (node, statement, previous) =>
    checkTriggerStatement(node, previous, statement.text),
  DeleteStmt: (_node, statement) => checkDmlStatement(statement.text),
  DropStmt: (node, statement) => checkDropStatement(node, statement.text),
  IndexStmt: (node, statement) => checkConcurrentStatement(node, statement.text, "index"),
  InsertStmt: (node, statement) => checkInsertStatement(node, statement.text),
  RefreshMatViewStmt: (node, statement) =>
    checkConcurrentStatement(node, statement.text, "refresh"),
  UpdateStmt: (_node, statement) => checkDmlStatement(statement.text),
  VariableSetStmt: (node, statement) => checkVariableSetStatement(node, statement.text),
  ViewStmt: (node, statement) => checkViewStatement(node, statement.text),
};

export async function checkMigrationSql(
  sql: string,
  options: CheckOptions = {}
): Promise<Diagnostic[]> {
  const config = resolveConfig(options.config);
  const diagnostics: Diagnostic[] = [];
  if (options.parse ?? true) {
    const parsed = await parseSqlAst(sql);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.ast !== undefined) {
      const statements = astStatements(parsed.ast, sql);
      const enumAdditions = newEnumAdditionState();
      for (const [index, statement] of statements.entries()) {
        diagnostics.push(
          ...escalateNontransactional(checkStatement(statement, statements[index - 1]), config),
          ...enumValueUseDiagnostics(statement, enumAdditions, config)
        );
        recordEnumAdditions(statement, enumAdditions);
      }
      diagnostics.push(...(await deparseFidelityDiagnostics(sql)));
    }
  }
  const validatorOptions: CheckOptions = {};
  if (options.config !== undefined) {
    validatorOptions.config = options.config;
  }
  if (options.cwd !== undefined) {
    validatorOptions.cwd = options.cwd;
  }
  diagnostics.push(...(await runConfiguredValidators(sql, validatorOptions)));
  return diagnostics;
}

function checkStatement(statement: AstStatement, previous: AstStatement | undefined): Diagnostic[] {
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return [];
  }
  const diagnostics = statementChecks[statement.tag]?.(node, statement, previous) ?? [];
  diagnostics.push(...checkGuardedCreateStatement(statement.tag, node, statement.text));
  return diagnostics;
}

function checkGuardedCreateStatement(tag: string, node: AstNode, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const guarded of guardedCreateChecks) {
    if (tag === guarded.tag && !readBoolean(node.if_not_exists)) {
      diagnostics.push(
        diagnostic(
          guarded.code,
          "error",
          `${guarded.kind} creation must use IF NOT EXISTS or a catalog guard`,
          { statement: text }
        )
      );
    }
  }
  return diagnostics;
}

function checkVariableSetStatement(node: AstNode, text: string): Diagnostic[] {
  if (readString(node.name) !== "search_path") {
    return [];
  }
  return [
    diagnostic(
      "SUPA_CHECK_SEARCH_PATH",
      "error",
      "migrations must not depend on session search_path",
      {
        hint: "Use schema-qualified object references and function-level SET search_path where needed.",
        statement: text,
      }
    ),
  ];
}

function checkViewStatement(node: AstNode, text: string): Diagnostic[] {
  if (readBoolean(node.replace)) {
    return [];
  }
  return [
    diagnostic("SUPA_CHECK_CREATE_VIEW_REPLACE", "error", "VIEW creation must use OR REPLACE", {
      statement: text,
    }),
  ];
}

function checkTypeCreationStatement(text: string): Diagnostic[] {
  return [
    diagnostic(
      "SUPA_CHECK_CREATE_TYPE_GUARD",
      "error",
      "TYPE and DOMAIN creation must be wrapped in a catalog guard",
      { statement: text }
    ),
  ];
}

function checkMaterializedViewStatement(node: AstNode, text: string): Diagnostic[] {
  if (
    readString(node.objtype) !== "OBJECT_MATVIEW" ||
    readBoolean(node.if_not_exists) ||
    readBoolean(asRecord(node.into)?.if_not_exists)
  ) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_CHECK_CREATE_MATERIALIZED_VIEW_GUARD",
      "error",
      "MATERIALIZED VIEW creation must use IF NOT EXISTS or a catalog guard",
      { statement: text }
    ),
  ];
}

function checkPolicyStatement(previous: AstStatement | undefined, text: string): Diagnostic[] {
  if (previousDrops(previous, "OBJECT_POLICY")) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_CHECK_POLICY_REPLACEMENT",
      "error",
      "CREATE POLICY has no OR REPLACE form and must be preceded by DROP POLICY IF EXISTS",
      { statement: text }
    ),
  ];
}

function checkTriggerStatement(
  node: AstNode,
  previous: AstStatement | undefined,
  text: string
): Diagnostic[] {
  if (readBoolean(node.replace) || previousDrops(previous, "OBJECT_TRIGGER")) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_CHECK_CREATE_TRIGGER_REPLACEMENT",
      "error",
      "CREATE TRIGGER must be preceded by DROP TRIGGER IF EXISTS",
      { statement: text }
    ),
  ];
}

function checkConcurrentStatement(
  node: AstNode,
  text: string,
  kind: "index" | "refresh"
): Diagnostic[] {
  if (!readBoolean(node.concurrent)) {
    return [];
  }
  const isIndex = kind === "index";
  return [
    diagnostic(
      isIndex ? "SUPA_CHECK_NONTRANSACTIONAL_INDEX" : "SUPA_CHECK_NONTRANSACTIONAL_REFRESH",
      "warning",
      isIndex
        ? "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"
        : "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block",
      {
        hint: "Run this migration with transaction wrapping disabled.",
        statement: text,
      }
    ),
  ];
}

function checkInsertStatement(node: AstNode, text: string): Diagnostic[] {
  if (asRecord(node.onConflictClause) !== undefined) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_CHECK_INSERT_ON_CONFLICT",
      "error",
      "INSERT statements in migrations must use ON CONFLICT for replay safety",
      { statement: text }
    ),
  ];
}

function checkDmlStatement(text: string): Diagnostic[] {
  return [
    diagnostic(
      "SUPA_CHECK_DML_REVIEW",
      "warning",
      "data-modifying statements in migrations require explicit idempotency review",
      { statement: text }
    ),
  ];
}

function checkDropStatement(node: AstNode, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (readString(node.behavior) === "DROP_CASCADE") {
    diagnostics.push(
      diagnostic("SUPA_CHECK_CASCADE", "error", "implicit CASCADE is forbidden", {
        hint: "Drop dependent objects explicitly in dependency order.",
        statement: text,
      })
    );
  }
  if (!readBoolean(node.missing_ok)) {
    diagnostics.push(
      diagnostic("SUPA_CHECK_DROP_IF_EXISTS", "error", "DROP statements must use IF EXISTS", {
        statement: text,
      })
    );
  }
  return diagnostics;
}

function checkFunctionStatement(node: AstNode, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!readBoolean(node.replace)) {
    diagnostics.push(
      diagnostic(
        "SUPA_CHECK_CREATE_ROUTINE_REPLACE",
        "error",
        "FUNCTION and PROCEDURE creation must use OR REPLACE",
        { statement: text }
      )
    );
  }
  let securityDefiner = false;
  let setsSearchPath = false;
  for (const item of readArray(node.options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    const name = readString(defElem?.defname);
    if (name === "security" && readBoolean(defElem?.arg)) {
      securityDefiner = true;
    }
    if (name === "set") {
      const setStmt = asRecord(asRecord(defElem?.arg)?.VariableSetStmt);
      if (readString(setStmt?.name) === "search_path") {
        setsSearchPath = true;
      }
    }
  }
  if (securityDefiner && !setsSearchPath) {
    diagnostics.push(
      diagnostic(
        "SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH",
        "warning",
        "SECURITY DEFINER functions should set a safe function-local search_path",
        { statement: text }
      )
    );
  }
  return diagnostics;
}

function checkAlterTableStatement(node: AstNode, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const item of readArray(node.cmds)) {
    const command = asRecord(asRecord(item)?.AlterTableCmd);
    const subtype = readString(command?.subtype);
    if (subtype === "AT_AddConstraint") {
      diagnostics.push(
        diagnostic(
          "SUPA_CHECK_ADD_CONSTRAINT_GUARD",
          "error",
          "ADD CONSTRAINT must be wrapped in a catalog guard",
          { statement: text }
        )
      );
    }
    if (subtype === "AT_AlterColumnType") {
      diagnostics.push(
        diagnostic(
          "SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE",
          "warning",
          "ALTER COLUMN TYPE can rewrite the table under an ACCESS EXCLUSIVE lock",
          {
            hint: "Verify the rewrite window is acceptable for populated tables.",
            statement: text,
          }
        )
      );
    }
    if (subtype === "AT_SetNotNull") {
      diagnostics.push(
        diagnostic(
          "SUPA_CHECK_SET_NOT_NULL_SCAN",
          "warning",
          "SET NOT NULL scans the full table unless a validated CHECK constraint already proves it",
          { statement: text }
        )
      );
    }
    if (subtype === "AT_AddColumn") {
      const columnDef = asRecord(asRecord(command?.def)?.ColumnDef);
      if (columnDef && hasVolatileDefault(columnDef)) {
        diagnostics.push(
          diagnostic(
            "SUPA_CHECK_VOLATILE_DEFAULT_REWRITE",
            "warning",
            "ADD COLUMN with a volatile default rewrites the whole table",
            {
              hint: "Add the column without a default, backfill in batches, then set the default.",
              statement: text,
            }
          )
        );
      }
    }
  }
  return diagnostics;
}

function hasVolatileDefault(columnDef: AstNode): boolean {
  for (const item of readArray(columnDef.constraints)) {
    const constraint = asRecord(asRecord(item)?.Constraint);
    if (readString(constraint?.contype) !== "CONSTR_DEFAULT") {
      continue;
    }
    const funcCall = asRecord(asRecord(constraint?.raw_expr)?.FuncCall);
    const names = stringList(funcCall?.funcname);
    const callee = names.at(-1);
    if (callee && volatileDefaultFunctions.has(callee.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function previousDrops(previous: AstStatement | undefined, removeType: string): boolean {
  if (previous?.tag !== "DropStmt") {
    return false;
  }
  const node = asRecord(previous.node.DropStmt);
  return readString(node?.removeType) === removeType && readBoolean(node?.missing_ok);
}
