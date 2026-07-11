import type { SchemaObject } from "../core.js";
import type { AstNode, QualifiedName } from "./ast.js";
import { asRecord, rangeVarName, readArray, readNumber, readString } from "./ast.js";
import { makeObject } from "./statements.js";
import { constraintMetadata } from "./table-constraints.js";

export function alterTableObjects(
  node: AstNode,
  statement: string,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const table = rangeVarName(node.relation);
  if (!table) {
    return;
  }
  const commands = readArray(node.cmds)
    .map((item) => asRecord(asRecord(item)?.AlterTableCmd))
    .filter((item): item is AstNode => item !== undefined);
  const objects: SchemaObject[] = [];
  let unsupported = false;
  for (const command of commands) {
    const object = alterTableCommandObject(command, table, statement, ordinal, file);
    if (object) {
      objects.push(object);
    } else {
      unsupported = true;
    }
  }
  return objects.length > 0 && !unsupported ? objects : undefined;
}

function alterTableCommandObject(
  command: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined
): SchemaObject | undefined {
  const subtype = readString(command.subtype);
  if (subtype === "AT_AddConstraint") {
    const constraint = asRecord(asRecord(command.def)?.Constraint);
    const name = readString(constraint?.conname);
    return constraint && name
      ? makeObject(
          { kind: "constraint", name, schema: table.schema, table: table.name },
          statement,
          ordinal,
          file,
          constraintMetadata(constraint)
        )
      : undefined;
  }
  if (
    subtype === "AT_EnableRowSecurity" ||
    subtype === "AT_DisableRowSecurity" ||
    subtype === "AT_ForceRowSecurity" ||
    subtype === "AT_NoForceRowSecurity"
  ) {
    return makeObject(
      { kind: "rls", name: table.name, schema: table.schema, table: table.name },
      statement,
      ordinal,
      file,
      { rlsSubtype: subtype }
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
