import { deparseSync } from "pgsql-deparser";
import type { SchemaObject } from "../types.js";
import type { AstNode, AstStatement, QualifiedName } from "./ast.js";
import { asRecord, rangeVarName, readArray, readNumber, readString } from "./ast.js";
import { formatQualifiedName, quoteIdent } from "./identifiers.js";
import { isRlsTransitionSubtype } from "./rls.js";
import { splitTopLevel } from "./split.js";
import { fromByteString, makeObject, toByteString } from "./statements.js";
import { allocateDefaultConstraintName, constraintMetadata } from "./table-constraints.js";

export function sourceAddConstraintCommand(
  alterTable: AstNode,
  command: AstNode,
  statement: AstStatement,
  existingConstraintNames: Iterable<string> = []
): { command: AstNode; statement: string } | undefined {
  const constraint = asRecord(asRecord(command.def)?.Constraint);
  const constraintLocation = readNumber(constraint?.location);
  const relation = rangeVarName(alterTable.relation);
  if (!(constraint && relation && constraintLocation !== undefined)) {
    return;
  }
  const declaredName = readString(constraint.conname);
  const constraintName =
    declaredName ??
    allocateDefaultConstraintName(relation.name, constraint, [], existingConstraintNames);
  if (!constraintName) {
    return;
  }
  const relativeLocation = constraintLocation - statement.byteStart;
  const statementBytes = toByteString(statement.text);
  if (relativeLocation < 0 || relativeLocation >= statementBytes.length) {
    return;
  }
  const constraintClause = splitTopLevel(fromByteString(statementBytes.slice(relativeLocation)))[0];
  if (!constraintClause) {
    return;
  }
  const sourceConstraintClause = declaredName
    ? constraintClause
    : `CONSTRAINT ${quoteIdent(constraintName)} ${constraintClause}`;
  const relationNode =
    asRecord(asRecord(alterTable.relation)?.RangeVar) ?? asRecord(alterTable.relation);
  const only = relationNode?.inh === true ? "" : " ONLY";
  const ifExists = alterTable.missing_ok === true ? " IF EXISTS" : "";
  const relationKind =
    readString(alterTable.objtype) === "OBJECT_FOREIGN_TABLE" ? "FOREIGN TABLE" : "TABLE";
  const sourceCommand = structuredClone(command);
  if (!declaredName) {
    sourceCommand.def = {
      ...(asRecord(sourceCommand.def) ?? {}),
      Constraint: { ...structuredClone(constraint), conname: constraintName },
    };
  }
  return {
    command: sourceCommand,
    statement: `ALTER ${relationKind}${ifExists}${only} ${formatQualifiedName(
      relation.schema,
      relation.name
    )} ADD ${sourceConstraintClause}`,
  };
}

export function alterTableObjects(
  node: AstNode,
  statement: string,
  ordinal: number,
  file: string | undefined,
  existingConstraintNames: Iterable<string> = [],
  sourceSqlMatchesAst = true
): SchemaObject[] | undefined {
  const table = rangeVarName(node.relation);
  if (!table) {
    return;
  }
  const commands = readArray(node.cmds)
    .map((item) => asRecord(asRecord(item)?.AlterTableCmd))
    .filter((item): item is AstNode => item !== undefined);
  const objects: SchemaObject[] = [];
  const allocatedConstraintNames = new Set(existingConstraintNames);
  let unsupported = false;
  for (const command of commands) {
    const object = alterTableCommandObject(
      command,
      node,
      table,
      statement,
      ordinal,
      file,
      allocatedConstraintNames,
      commands.length === 1 && sourceSqlMatchesAst
    );
    if (object) {
      objects.push(object);
      if (object.ref.kind === "constraint") {
        allocatedConstraintNames.add(object.ref.name);
      }
    } else {
      unsupported = true;
    }
  }
  return objects.length > 0 && !unsupported ? objects : undefined;
}

function alterTableCommandObject(
  command: AstNode,
  alterTable: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined,
  existingConstraintNames: Iterable<string>,
  singleCommand: boolean
): SchemaObject | undefined {
  const subtype = readString(command.subtype);
  if (subtype === "AT_AddConstraint") {
    return addConstraintObject(
      command,
      alterTable,
      table,
      statement,
      ordinal,
      file,
      existingConstraintNames,
      singleCommand
    );
  }
  if (isRlsTransitionSubtype(subtype)) {
    return makeObject(
      { kind: "rls", name: table.name, schema: table.schema, table: table.name },
      statement,
      ordinal,
      file,
      { rlsTransition: subtype }
    );
  }
  if (subtype === "AT_ColumnDefault") {
    return columnDefaultObject(command, table, statement, ordinal, file);
  }
  if (subtype === "AT_SetExpression" || subtype === "AT_DropExpression") {
    return columnGeneratedObject(command, table, statement, ordinal, file, subtype);
  }
  if (
    subtype === "AT_AddIdentity" ||
    subtype === "AT_SetIdentity" ||
    subtype === "AT_DropIdentity"
  ) {
    return columnIdentityObject(command, table, statement, ordinal, file, subtype);
  }
  if (subtype === "AT_AttachPartition") {
    const partition = asRecord(asRecord(command.def)?.PartitionCmd);
    const child = rangeVarName(partition?.name);
    return child
      ? makeObject(
          { kind: "table", name: child.name, schema: child.schema },
          statement,
          ordinal,
          file,
          {
            tablePartitionAmendment: {
              bound: partition?.bound ?? null,
              parent: { name: table.name, schema: table.schema },
            },
          }
        )
      : undefined;
  }
}

function addConstraintObject(
  command: AstNode,
  alterTable: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined,
  existingConstraintNames: Iterable<string>,
  singleCommand: boolean
): SchemaObject | undefined {
  const constraint = asRecord(asRecord(command.def)?.Constraint);
  const declaredName = readString(constraint?.conname);
  const name =
    declaredName ??
    (constraint
      ? allocateDefaultConstraintName(table.name, constraint, [], existingConstraintNames)
      : undefined);
  let sql: string | undefined;
  if (constraint && name) {
    sql =
      declaredName && singleCommand
        ? statement
        : canonicalAddConstraintSql(alterTable, command, constraint, name);
  }
  return constraint && name && sql
    ? makeObject(
        { kind: "constraint", name, schema: table.schema, table: table.name },
        sql,
        ordinal,
        file,
        constraintMetadata(constraint)
      )
    : undefined;
}

function canonicalAddConstraintSql(
  alterTable: AstNode,
  command: AstNode,
  constraint: AstNode,
  name: string
): string | undefined {
  try {
    const relation = asRecord(alterTable.relation);
    const namedCommand = {
      ...command,
      def: {
        ...(asRecord(command.def) ?? {}),
        Constraint: { ...constraint, conname: name },
      },
    };
    const node = {
      ...alterTable,
      cmds: [{ AlterTableCmd: namedCommand }],
      ...(relation === undefined ? {} : { relation: { ...relation, inh: false } }),
    };
    return deparseSync(JSON.parse(JSON.stringify({ AlterTableStmt: node })));
  } catch {
    // Unsupported parser fragments are reported by the caller as ambiguous ALTER TABLE input.
  }
}

function columnDefaultObject(
  command: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined
): SchemaObject | undefined {
  const column = readString(command.name);
  return column
    ? makeObject(
        { kind: "table", name: table.name, schema: table.schema },
        statement,
        ordinal,
        file,
        { columnDefaultAmendment: { column, expression: command.def ?? null } }
      )
    : undefined;
}

function columnGeneratedObject(
  command: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined,
  subtype: string
): SchemaObject | undefined {
  const column = readString(command.name);
  return column
    ? makeObject(
        { kind: "table", name: table.name, schema: table.schema },
        statement,
        ordinal,
        file,
        {
          columnGeneratedAmendment: {
            action: subtype === "AT_DropExpression" ? "drop" : "set",
            column,
            expression: command.def ?? null,
          },
        }
      )
    : undefined;
}

function columnIdentityObject(
  command: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined,
  subtype: string
): SchemaObject | undefined {
  const column = readString(command.name);
  let action: "add" | "drop" | "set" = "add";
  if (subtype === "AT_DropIdentity") {
    action = "drop";
  } else if (subtype === "AT_SetIdentity") {
    action = "set";
  }
  return column
    ? makeObject(
        { kind: "table", name: table.name, schema: table.schema },
        statement,
        ordinal,
        file,
        {
          columnIdentityAmendment: {
            action,
            column,
            identity: identityGeneration(command),
          },
        }
      )
    : undefined;
}

function identityGeneration(command: AstNode): string | undefined {
  const constraint = asRecord(asRecord(command.def)?.Constraint);
  const generatedWhen = readString(constraint?.generated_when);
  if (generatedWhen === "a" || generatedWhen === "d") {
    return generatedWhen;
  }
  const list = asRecord(command.def)?.List;
  for (const item of readArray(list ? asRecord(list)?.items : [])) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "generated") {
      continue;
    }
    const value = readNumber(asRecord(asRecord(defElem?.arg)?.Integer)?.ival);
    if (value === 97) {
      return "a";
    }
    if (value === 100) {
      return "d";
    }
  }
}
