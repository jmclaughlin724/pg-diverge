import type { Diagnostic, SchemaObject, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";

export function withManagedSchemaDiagnostics(
  objects: SchemaObject[],
  statement: string,
  config: SupaschemaConfig,
  file: string | undefined
): { diagnostics: Diagnostic[]; objects: SchemaObject[] } {
  return {
    diagnostics: objects.flatMap((object) =>
      managedSchemaDiagnostics(object, statement, config, file)
    ),
    objects,
  };
}

export function supabaseViewSecurityDiagnostics(
  objects: SchemaObject[],
  config: SupaschemaConfig
): Diagnostic[] {
  const managed = new Set(config.managedSchemas);
  if (!(managed.has("auth") && managed.has("storage"))) {
    return [];
  }
  return objects.flatMap((object) => {
    if (
      object.ref.kind !== "view" ||
      (object.ref.schema ?? "public") !== "public" ||
      object.metadata.securityInvoker === true
    ) {
      return [];
    }
    return [
      diagnostic(
        "SUPA_SUPABASE_VIEW_SECURITY_INVOKER",
        "warning",
        `view "public"."${object.ref.name}" in an exposed schema does not set security_invoker`,
        {
          file: object.file,
          hint: "Add WITH (security_invoker = true) so row level security applies to the querying role.",
          ref: object.ref,
        }
      ),
    ];
  });
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
  return schema
    ? [
        diagnostic(
          "SUPA_SUPABASE_MANAGED_SCHEMA",
          "error",
          `schema "${schema}" is configured as managed and is not a declarative source owner`,
          {
            file,
            hint: `Move this statement out of the declarative tree, or remove "${schema}" from managedSchemas only if this project owns it.`,
            ref: object.ref,
            schemas: [schema],
            statement,
          }
        ),
      ]
    : [];
}
