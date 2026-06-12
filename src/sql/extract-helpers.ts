import type { Diagnostic, SchemaObject, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import type { AstNode } from "./ast.js";
import { asRecord, rangeVarName, readArray, readString, stringList } from "./ast.js";
import { makeObject } from "./statements.js";

export type ParseStatementResult = {
  diagnostics: Diagnostic[];
  objects: SchemaObject[];
};

export function alterTableObjects(
  node: AstNode,
  statement: string,
  ordinal: number,
  file: string | undefined,
): SchemaObject[] | undefined {
  const table = rangeVarName(node.relation);
  if (!table) {
    return undefined;
  }
  const command = readArray(node.cmds)
    .map((item) => asRecord(asRecord(item)?.AlterTableCmd))
    .find((item) => item !== undefined);
  const subtype = readString(command?.subtype);
  if (subtype === "AT_AddConstraint") {
    const constraint = asRecord(asRecord(command?.def)?.Constraint);
    const name = readString(constraint?.conname);
    if (!name) {
      return undefined;
    }
    return [
      makeObject(
        {
          kind: "constraint",
          name,
          schema: table.schema,
          table: table.name,
        },
        statement,
        ordinal,
        file,
      ),
    ];
  }
  if (
    subtype === "AT_EnableRowSecurity" ||
    subtype === "AT_DisableRowSecurity" ||
    subtype === "AT_ForceRowSecurity" ||
    subtype === "AT_NoForceRowSecurity"
  ) {
    return [
      makeObject(
        { kind: "rls", name: table.name, schema: table.schema, table: table.name },
        statement,
        ordinal,
        file,
        { rlsSubtype: subtype },
      ),
    ];
  }
  if (subtype === "AT_ColumnDefault") {
    const column = readString(command?.name);
    if (!column) {
      return undefined;
    }

    return [
      makeObject(
        { kind: "table", name: table.name, schema: table.schema },
        statement,
        ordinal,
        file,
        {
          columnDefaultAmendment: { column, expression: command?.def ?? null },
        },
      ),
    ];
  }
  return undefined;
}

/**
 * Reads the OWNED BY target from ALTER SEQUENCE options: `null` for
 * OWNED BY NONE, the dotted column path otherwise, `undefined` when the
 * statement carries no owned_by option (other ALTER SEQUENCE forms stay
 * unsupported).
 */
export function sequenceOwnedByOption(options: unknown): string | null | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "owned_by") {
      continue;
    }
    const parts = stringList(defElem?.arg);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.at(-1) === "none" ? null : parts.join(".");
  }
  return undefined;
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
  return undefined;
}

export function withManagedSchemaDiagnostics(
  objects: SchemaObject[],
  statement: string,
  config: SupaschemaConfig,
  file: string | undefined,
): ParseStatementResult {
  const diagnostics: Diagnostic[] = [];
  for (const object of objects) {
    diagnostics.push(...managedSchemaDiagnostics(object, statement, config, file));
  }
  return { diagnostics, objects };
}

export function supabaseViewSecurityDiagnostics(
  objects: SchemaObject[],
  config: SupaschemaConfig,
): Diagnostic[] {
  if (config.adapter !== "supabase-auto") {
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
        },
      ),
    );
  }
  return diagnostics;
}

function managedSchemaDiagnostics(
  object: SchemaObject,
  statement: string,
  config: SupaschemaConfig,
  file?: string,
): Diagnostic[] {
  if (config.adapter !== "supabase-auto") {
    return [];
  }
  const refSchema = object.ref.kind === "schema" ? object.ref.name : object.ref.schema;
  const metadataSchema =
    typeof object.metadata.schema === "string" ? object.metadata.schema : undefined;
  const schema = [refSchema, metadataSchema].find(
    (candidate) => candidate !== undefined && config.managedSchemas.includes(candidate),
  );
  if (!schema) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_SUPABASE_MANAGED_SCHEMA",
      "error",
      `schema "${schema}" is managed by Supabase and is not a declarative source owner`,
      {
        file,
        hint: `Move this statement out of the declarative tree, or exclude the schema with config schemas.exclude: ["${schema}"].`,
        ref: object.ref,
        statement,
      },
    ),
  ];
}
