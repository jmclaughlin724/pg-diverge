import type { MigrationOperation, SchemaObject, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { stableJson } from "../hash.js";

export function destructiveAllowedDisposition(
  key: string,
  config: SupaschemaConfig
): "destructive-config" | "destructive-hint" | undefined {
  if (config.destructiveChanges === "allow") {
    return "destructive-config";
  }
  if (config.destructiveChanges === "block") {
    return;
  }
  const hints = config.hints.destructive ?? [];
  return hints.includes("*") || hints.includes(key) ? "destructive-hint" : undefined;
}

export function isDestructiveAllowed(key: string, config: SupaschemaConfig): boolean {
  return destructiveAllowedDisposition(key, config) !== undefined;
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
    operation.diagnostics = operation.diagnostics.filter(
      (item) => item.code !== "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED"
    );
    return markDropRequired(operation, config, "viewDropRequired", {
      code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
      hint: `This view's output columns cannot be verified. Add an explicit column alias list to the view, or add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
      message:
        "view replacement cannot be proven column-compatible; CREATE OR REPLACE VIEW may be rejected by PostgreSQL",
    });
  }
  operation.diagnostics = operation.diagnostics.filter(
    (item) => item.code !== "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED"
  );
  const prefixCompatible =
    after.length >= before.length && before.every((column, index) => after[index] === column);
  if (!prefixCompatible) {
    return markDropRequired(operation, config, "viewDropRequired", {
      code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
      hint: `Add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
      message:
        "view replacement drops, renames, or reorders output columns; CREATE OR REPLACE VIEW cannot apply it",
    });
  }
  const castChangedColumn = castTypeChangedColumn(operation.before, operation.after, before);
  if (castChangedColumn !== undefined) {
    return markDropRequired(operation, config, "viewDropRequired", {
      code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
      hint: `Add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
      message: `view replacement changes the cast type of output column "${castChangedColumn}"; CREATE OR REPLACE VIEW cannot change a column's data type`,
    });
  }
  if ((config.hints.destructive ?? []).includes(operation.key)) {
    return markDropRequired(operation, config, "viewDropRequired", {
      code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
      hint: `Remove "${operation.key}" from hints.destructive to render CREATE OR REPLACE VIEW instead.`,
      message:
        "view replacement is hinted destructive; rendering a guarded DROP VIEW + CREATE instead of CREATE OR REPLACE VIEW",
    });
  }
  return operation;
}

function castTypeChangedColumn(
  before: SchemaObject | undefined,
  after: SchemaObject | undefined,
  sharedColumns: string[]
): string | undefined {
  const beforeCasts = viewColumnCastTypes(before);
  const afterCasts = viewColumnCastTypes(after);
  if (!(beforeCasts && afterCasts)) {
    return;
  }
  for (let index = 0; index < sharedColumns.length; index += 1) {
    const beforeCast = beforeCasts[index];
    const afterCast = afterCasts[index];
    if (
      typeof beforeCast === "string" &&
      typeof afterCast === "string" &&
      beforeCast !== afterCast
    ) {
      return sharedColumns[index];
    }
  }
}

function viewColumnCastTypes(object: SchemaObject | undefined): (string | null)[] | undefined {
  const casts = object?.metadata.viewColumnCastTypes;
  if (!Array.isArray(casts)) {
    return;
  }
  const values = casts.filter(
    (value): value is string | null => value === null || typeof value === "string"
  );
  return values.length === casts.length ? values : undefined;
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
  const disposition = destructiveAllowedDisposition(operation.key, config);
  if (!disposition) {
    operation.blocked = true;
    operation.diagnostics.push(
      diagnostic(failure.code, "error", failure.message, {
        hint: failure.hint,
        ref: operation.ref,
      })
    );
  }
  operation.metadata.destructiveDisposition = disposition ?? "blocked";
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
