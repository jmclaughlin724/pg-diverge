import { diagnostic } from "../diagnostics/diagnostics.js";
import type { Diagnostic, SchemaObject, SupaschemaConfig } from "../types.js";
import { objectSchema } from "./dependents.js";

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
  const schema = managedSchema(object, config);
  if (schema === undefined || isManagedSchemaOverlay(object, config)) {
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
        schemas: [schema],
        statement,
      }
    ),
  ];
}

const managedSchemaOverlayKinds = new Set(["comment", "grant", "policy"]);

export function isManagedSchemaOverlay(object: SchemaObject, config: SupaschemaConfig): boolean {
  return (
    managedSchemaOverlayKinds.has(object.ref.kind) &&
    config.managedSchemaOverlays.includes(object.key) &&
    managedSchema(object, config) !== undefined
  );
}

function managedSchema(object: SchemaObject, config: SupaschemaConfig): string | undefined {
  if (config.managedSchemas.length === 0) {
    return;
  }
  const refSchema = object.ref.kind === "schema" ? object.ref.name : object.ref.schema;
  const metadataSchema =
    typeof object.metadata.schema === "string" ? object.metadata.schema : undefined;
  return [refSchema, metadataSchema].find(
    (candidate) => candidate !== undefined && config.managedSchemas.includes(candidate)
  );
}

export function overlayRetainedSchemas(config: SupaschemaConfig): string[] {
  if (config.managedSchemaOverlays.length === 0) {
    return [];
  }
  const retained = config.schemas.exclude.filter((schema) =>
    config.managedSchemas.includes(schema)
  );
  if (config.schemas.include.length > 0) {
    retained.push(
      ...config.managedSchemas.filter(
        (schema) => !(config.schemas.include.includes(schema) || retained.includes(schema))
      )
    );
  }
  return retained;
}

export function retainCatalogOverlayObjects(
  objects: SchemaObject[],
  overlaySchemas: string[],
  config: SupaschemaConfig
): SchemaObject[] {
  if (overlaySchemas.length === 0) {
    return objects;
  }
  return objects.filter(
    (object) =>
      !overlaySchemas.includes(objectSchema(object)) || isManagedSchemaOverlay(object, config)
  );
}
