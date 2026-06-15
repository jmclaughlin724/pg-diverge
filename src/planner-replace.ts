import type { MigrationOperation, SchemaObject, SupaschemaConfig } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { stableJson } from "./hash.js";

export function isDestructiveAllowed(key: string, config: SupaschemaConfig): boolean {
  if (config.destructiveChanges === "allow") {
    return true;
  }
  if (config.destructiveChanges === "block") {
    return false;
  }
  const hints = config.hints.destructive ?? [];
  return hints.includes("*") || hints.includes(key);
}

export function refineReplaceOperation(
  operation: MigrationOperation,
  config: SupaschemaConfig
): MigrationOperation {
  if (operation.ref.kind === "view") {
    return refineViewReplace(operation, config);
  }
  if (operation.ref.kind === "function" || operation.ref.kind === "procedure") {
    return refineRoutineReplace(operation, config);
  }
  return operation;
}

function refineViewReplace(
  operation: MigrationOperation,
  config: SupaschemaConfig
): MigrationOperation {
  const before = viewColumns(operation.before);
  const after = viewColumns(operation.after);
  if (!(before && after)) {
    return operation;
  }
  operation.diagnostics = operation.diagnostics.filter(
    (item) => item.code !== "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED"
  );
  const prefixCompatible =
    after.length >= before.length && before.every((column, index) => after[index] === column);
  if (prefixCompatible) {
    return operation;
  }
  return markDropRequired(operation, config, "viewDropRequired", {
    code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
    hint: `Add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
    message:
      "view replacement drops, renames, or reorders output columns; CREATE OR REPLACE VIEW cannot apply it",
  });
}

function refineRoutineReplace(
  operation: MigrationOperation,
  config: SupaschemaConfig
): MigrationOperation {
  const before = routineShape(operation.before);
  const after = routineShape(operation.after);
  if (before === after) {
    return operation;
  }
  return markDropRequired(operation, config, "routineDropRequired", {
    code: "SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED",
    hint: `Add "${operation.key}" to hints.destructive to render a guarded DROP + CREATE after review.`,
    message:
      "routine replacement changes the return type or OUT parameters; CREATE OR REPLACE cannot apply it",
  });
}

function markDropRequired(
  operation: MigrationOperation,
  config: SupaschemaConfig,
  metadataFlag: "routineDropRequired" | "viewDropRequired",
  failure: { code: string; hint: string; message: string }
): MigrationOperation {
  operation.metadata[metadataFlag] = true;
  operation.destructive = true;
  if (!isDestructiveAllowed(operation.key, config)) {
    operation.blocked = true;
    operation.diagnostics.push(
      diagnostic(failure.code, "error", failure.message, {
        hint: failure.hint,
        ref: operation.ref,
      })
    );
  }
  return operation;
}

function viewColumns(object: SchemaObject | undefined): string[] | undefined {
  const columns = object?.metadata.viewColumns;
  if (!Array.isArray(columns)) {
    return;
  }
  const names = columns.filter((column): column is string => typeof column === "string");
  return names.length === columns.length ? names : undefined;
}

function routineShape(object: SchemaObject | undefined): string {
  return stableJson({
    outParams: object?.metadata.outParams ?? null,
    returns: object?.metadata.returns ?? null,
  });
}
