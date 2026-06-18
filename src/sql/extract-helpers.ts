import type { Diagnostic, SchemaObject, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstNode, QualifiedName } from "./ast.js";
import { asRecord, rangeVarName, readArray, readString, stringList } from "./ast.js";
import { makeObject } from "./statements.js";

export interface ParseStatementResult {
  diagnostics: Diagnostic[];
  objects: SchemaObject[];
}

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
  let sawUnsupported = false;
  for (const command of commands) {
    const object = alterTableCommandObject(command, table, statement, ordinal, file);
    if (object) {
      objects.push(object);
    } else {
      sawUnsupported = true;
    }
  }
  if (objects.length > 0 && !sawUnsupported) {
    return objects;
  }
  return;
}

function alterTableCommandObject(
  command: AstNode,
  table: QualifiedName,
  statement: string,
  ordinal: number,
  file: string | undefined
): SchemaObject | undefined {
  const subtype = readString(command?.subtype);
  if (subtype === "AT_AddConstraint") {
    const constraint = asRecord(asRecord(command?.def)?.Constraint);
    const name = readString(constraint?.conname);
    if (!name) {
      return;
    }
    return makeObject(
      {
        kind: "constraint",
        name,
        schema: table.schema,
        table: table.name,
      },
      statement,
      ordinal,
      file
    );
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
    const column = readString(command?.name);
    if (!column) {
      return;
    }

    return makeObject(
      { kind: "table", name: table.name, schema: table.schema },
      statement,
      ordinal,
      file,
      {
        columnDefaultAmendment: { column, expression: command?.def ?? null },
      }
    );
  }
  return;
}

export function sequenceOwnedByOption(options: unknown): string | null | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "owned_by") {
      continue;
    }
    const parts = stringList(defElem?.arg);
    if (parts.length === 0) {
      return;
    }
    return parts.at(-1) === "none" ? null : parts.join(".");
  }
  return;
}

export function extensionSchemaOption(options: unknown): string | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "schema") {
      continue;
    }
    const value = readString(asRecord(asRecord(defElem?.arg)?.String)?.sval);
    if (value) {
      return value;
    }
  }
  return;
}

export function withManagedSchemaDiagnostics(
  objects: SchemaObject[],
  statement: string,
  config: SupaschemaConfig,
  file: string | undefined
): ParseStatementResult {
  const diagnostics: Diagnostic[] = [];
  for (const object of objects) {
    diagnostics.push(...managedSchemaDiagnostics(object, statement, config, file));
  }
  return { diagnostics, objects };
}

export function supabaseViewSecurityDiagnostics(
  objects: SchemaObject[],
  config: SupaschemaConfig
): Diagnostic[] {
  if (!hasSupabaseManagedSurface(config)) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  for (const object of objects) {
    if (object.ref.kind !== "view" || (object.ref.schema ?? "public") !== "public") {
      continue;
    }
    if (object.metadata.securityInvoker === true) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        "SUPA_SUPABASE_VIEW_SECURITY_INVOKER",
        "warning",
        `view "public"."${object.ref.name}" in an exposed schema does not set security_invoker`,
        {
          file: object.file,
          hint: "Add WITH (security_invoker = true) so row level security applies to the querying role.",
          ref: object.ref,
        }
      )
    );
  }
  return diagnostics;
}

function managedSchemaDiagnostics(
  object: SchemaObject,
  statement: string,
  config: SupaschemaConfig,
  file?: string
): Diagnostic[] {
  if (config.managedSchemas.length === 0) {
    return [];
  }
  const refSchema = object.ref.kind === "schema" ? object.ref.name : object.ref.schema;
  const metadataSchema =
    typeof object.metadata.schema === "string" ? object.metadata.schema : undefined;
  const schema = [refSchema, metadataSchema].find(
    (candidate) => candidate !== undefined && config.managedSchemas.includes(candidate)
  );
  if (!schema) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_SUPABASE_MANAGED_SCHEMA",
      "error",
      `schema "${schema}" is configured as managed and is not a declarative source owner`,
      {
        file,
        hint: `Move this statement out of the declarative tree, or remove "${schema}" from managedSchemas only if this project owns it.`,
        ref: object.ref,
        statement,
      }
    ),
  ];
}

function hasSupabaseManagedSurface(config: SupaschemaConfig): boolean {
  const managed = new Set(config.managedSchemas);
  return managed.has("auth") && managed.has("storage");
}
