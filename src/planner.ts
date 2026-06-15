import { resolveConfig } from "./config.js";
import type {
  Diagnostic,
  MigrationOperation,
  MigrationOperationKind,
  MigrationPlan,
  ObjectKind,
  ObjectRef,
  RenderOptions,
  SchemaModel,
  SchemaObject,
  SupaschemaConfig,
} from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { sha256, stableJson } from "./hash.js";
import { sortOperations } from "./plan-order.js";
import { isDestructiveAllowed, refineReplaceOperation } from "./planner-replace.js";
import { makeTableAlterOperation } from "./planner-table.js";

type DiffOptions = Pick<RenderOptions, "config">;

export function planSchemaDiff(
  from: SchemaModel,
  to: SchemaModel,
  options: DiffOptions = {},
): MigrationPlan {
  const config = resolveConfig(options.config);
  const operations: MigrationOperation[] = [];
  const diagnostics: Diagnostic[] = [...from.diagnostics, ...to.diagnostics];
  const fromMap = objectMap(from.objects);
  const toMap = objectMap(to.objects);
  const consumedFrom = new Set<string>();
  const consumedTo = new Set<string>();
  if (config.renameDetection === "hints-only") {
    for (const hint of config.hints.renames ?? []) {
      const before = fromMap.get(hint.from);
      const after = toMap.get(hint.to);
      if (!before || !after) {
        diagnostics.push(
          diagnostic(
            "SUPA_PLAN_RENAME_HINT_UNMATCHED",
            "error",
            "rename hint does not match both source and target objects",
            {
              hint: `from=${hint.from} to=${hint.to}`,
            },
          ),
        );
        continue;
      }
      const operation = makeRenameOperation(before, after);
      operations.push(operation);
      consumedFrom.add(before.key);
      consumedTo.add(after.key);
    }
  }
  for (const [key, before] of fromMap) {
    if (consumedFrom.has(key)) {
      continue;
    }
    const after = toMap.get(key);
    if (!after) {
      operations.push(makeOperation("drop", key, before, undefined, config));
      continue;
    }
    if (before.hash !== after.hash) {
      operations.push(
        makeEnumAddValuesOperation(before, after) ??
          makeTableAlterOperation(before, after, config) ??
          refineReplaceOperation(makeOperation("replace", key, before, after, config), config),
      );
    }
  }
  for (const [key, after] of toMap) {
    if (consumedTo.has(key)) {
      continue;
    }
    if (!fromMap.has(key)) {
      operations.push(makeOperation("create", key, undefined, after, config));
    }
  }
  appendReplacedRelationDependents(operations, from, to, config);
  const sortedOperations = sortOperations(operations, diagnostics);
  for (const operation of operations) {
    diagnostics.push(...operation.diagnostics);
  }
  if (sortedOperations.length === 0 && from.fingerprint !== to.fingerprint) {
    diagnostics.push(emptyPlanDriftDiagnostic(fromMap, toMap, from, to));
  }
  return {
    diagnostics,
    fingerprint: sha256(
      stableJson({
        from: from.fingerprint,
        operations: sortedOperations.map((operation) => ({
          key: operation.key,
          kind: operation.kind,
        })),
        to: to.fingerprint,
      }),
    ),
    from: from.source,
    fromFingerprint: from.fingerprint,
    operations: sortedOperations,
    to: to.source,
    toFingerprint: to.fingerprint,
  };
}
function objectMap(objects: SchemaObject[]): Map<string, SchemaObject> {
  return new Map(objects.map((object) => [object.key, object]));
}

const replacedRelationKinds = new Set<ObjectKind>(["table", "materialized-view"]);
const relationDependentKinds = new Set<ObjectKind>([
  "constraint",
  "index",
  "rls",
  "policy",
  "trigger",
]);
const blockingRelationDependentKinds = new Set<ObjectKind>(["view", "materialized-view"]);

/**
 * A relation replace renders DROP + CREATE, which destroys every dependent
 * object in the target database even when that dependent is unchanged
 * between the two models (equal hashes produce no operation). Re-create the
 * to-state dependents alongside the replace so the rebuilt relation keeps
 * its constraints, indexes, RLS state, policies, triggers, grants, blocking
 * views/materialized views, and comments.
 */
function appendReplacedRelationDependents(
  operations: MigrationOperation[],
  from: SchemaModel,
  to: SchemaModel,
  config: SupaschemaConfig,
): void {
  const replacedRelations = operations
    .filter(
      (operation) => operation.kind === "replace" && replacedRelationKinds.has(operation.ref.kind),
    )
    .map((operation) => operation.ref);
  if (replacedRelations.length === 0) {
    return;
  }
  // Only objects that already exist get collaterally dropped by the relation
  // replace, so a pre-drop is needed only for them. A dependent that is new in
  // the target (created in this same plan) must not be pre-dropped — that would
  // emit a destructive DROP for an object that does not exist yet.
  const fromKeys = new Set(from.objects.map((object) => object.key));
  const operationKeys = new Set(operations.map((operation) => operation.key));
  const affectedRefs = new Map<string, ObjectRef>();
  const relationIdentities = new Set<string>();
  for (const relation of replacedRelations) {
    rememberAffectedRef(affectedRefs, relation);
    relationIdentities.add(refIdentity(relation));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of to.objects) {
      if (!isRelationDependent(object, relationIdentities)) {
        continue;
      }
      rememberAffectedRef(affectedRefs, object.ref);
      if (blockingRelationDependentKinds.has(object.ref.kind) && fromKeys.has(object.key)) {
        const identity = refIdentity(object.ref);
        if (!relationIdentities.has(identity)) {
          relationIdentities.add(identity);
          changed = true;
        }
        const key = preDropKey(object.key);
        if (!operationKeys.has(key)) {
          operations.push(makePreDropOperation(object, config));
          operationKeys.add(key);
          changed = true;
        }
      }
      if (!operationKeys.has(object.key)) {
        operations.push(makeOperation("create", object.key, undefined, object, config));
        operationKeys.add(object.key);
        changed = true;
      }
    }
  }
  for (const object of to.objects) {
    if (operationKeys.has(object.key) || !isCommentDependent(object, affectedRefs)) {
      continue;
    }
    operations.push(makeOperation("create", object.key, undefined, object, config));
    operationKeys.add(object.key);
  }
}

function isRelationDependent(object: SchemaObject, relationIdentities: Set<string>): boolean {
  const tableIdentity = tableRefIdentity(object.ref);
  if (
    relationDependentKinds.has(object.ref.kind) &&
    tableIdentity !== undefined &&
    relationIdentities.has(tableIdentity)
  ) {
    return true;
  }
  if (
    blockingRelationDependentKinds.has(object.ref.kind) &&
    object.dependencies.some((dependency) => relationIdentities.has(dependency))
  ) {
    return true;
  }
  return (
    object.ref.kind === "grant" &&
    typeof object.metadata.targetIdentity === "string" &&
    relationIdentities.has(object.metadata.targetIdentity)
  );
}

function isCommentDependent(
  object: SchemaObject,
  affectedRefs: ReadonlyMap<string, ObjectRef>,
): boolean {
  if (object.ref.kind !== "comment" || typeof object.metadata.descriptor !== "string") {
    return false;
  }
  for (const ref of affectedRefs.values()) {
    if (commentTargetsRef(object.metadata.descriptor, ref)) {
      return true;
    }
  }
  return false;
}

function commentTargetsRef(descriptor: string, ref: ObjectRef): boolean {
  const schema = ref.schema ?? "public";
  const identity = `${schema}.${ref.name}`;
  switch (ref.kind) {
    case "table":
      return descriptor === `table ${identity}` || descriptor.startsWith(`column ${identity}.`);
    case "view":
      return descriptor === `view ${identity}` || descriptor.startsWith(`column ${identity}.`);
    case "materialized-view":
      return (
        descriptor === `materialized view ${identity}` ||
        descriptor.startsWith(`column ${identity}.`)
      );
    case "constraint":
      return descriptor === `constraint ${tableRefIdentity(ref)}.${ref.name}`;
    case "index":
      return descriptor === `index ${identity}`;
    case "policy":
      return descriptor === `policy ${tableRefIdentity(ref)}.${ref.name}`;
    case "trigger":
      return descriptor === `trigger ${tableRefIdentity(ref)}.${ref.name}`;
    default:
      return false;
  }
}

function refIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

function tableRefIdentity(ref: ObjectRef): string | undefined {
  return ref.table ? `${ref.schema ?? "public"}.${ref.table}` : undefined;
}

function preDropKey(key: string): string {
  return `pre-drop:${key}`;
}

function makePreDropOperation(object: SchemaObject, config: SupaschemaConfig): MigrationOperation {
  return {
    ...makeOperation("drop", object.key, object, undefined, config),
    key: preDropKey(object.key),
  };
}

function rememberAffectedRef(affectedRefs: Map<string, ObjectRef>, ref: ObjectRef): void {
  affectedRefs.set(`${ref.kind}:${ref.schema ?? ""}:${ref.table ?? ""}:${ref.name}`, ref);
}

/**
 * A diff engine's worst failure mode is an empty plan over states that
 * actually differ. Zero operations must imply equal model fingerprints; when
 * it does not, fail loud with the divergence instead of rendering a no-op.
 */
function emptyPlanDriftDiagnostic(
  fromMap: Map<string, SchemaObject>,
  toMap: Map<string, SchemaObject>,
  from: SchemaModel,
  to: SchemaModel,
): Diagnostic {
  const differing: string[] = [];
  for (const [key, before] of fromMap) {
    const after = toMap.get(key);
    if (!after) {
      differing.push(`missing in target: ${key}`);
    } else if (before.hash !== after.hash) {
      differing.push(`hash drift: ${key}`);
    }
  }
  for (const key of toMap.keys()) {
    if (!fromMap.has(key)) {
      differing.push(`missing in source: ${key}`);
    }
  }
  const sample = differing.slice(0, 12).join("; ");
  return diagnostic(
    "SUPA_PLAN_EMPTY_WITH_DRIFT",
    "error",
    "plan contains no operations but the model fingerprints differ",
    {
      hint:
        differing.length > 0
          ? `${differing.length} differing object(s): ${sample}`
          : `object sets are identical; fingerprint basis differs (from=${from.fingerprint} to=${to.fingerprint}) — check model format versions`,
    },
  );
}

function makeOperation(
  kind: MigrationOperationKind,
  key: string,
  before: SchemaObject | undefined,
  after: SchemaObject | undefined,
  config: SupaschemaConfig,
): MigrationOperation {
  const object = after ?? before;
  if (!object) {
    throw new Error(`operation ${kind} for ${key} has no object`);
  }
  const diagnostics: Diagnostic[] = [];
  const destructive = isDestructive(kind, object.ref.kind);
  let blocked = false;
  if (destructive && !isDestructiveAllowed(key, config)) {
    blocked = true;
    const difference = kind === "replace" ? describeReplaceDifference(before, after) : undefined;
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED",
        "error",
        `${kind} of ${object.ref.kind} requires an explicit destructive-change hint${difference ? ` — ${difference}` : ""}`,
        {
          hint: `Add "${key}" to hints.destructive only after reviewing the migration.`,
          ref: object.ref,
        },
      ),
    );
  }
  if (kind === "replace" && object.ref.kind === "view") {
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED",
        "warning",
        "PostgreSQL only permits CREATE OR REPLACE VIEW when the replacement shape is compatible",
        {
          hint: "Run supaschema verify against a disposable PostgreSQL database before release.",
          ref: object.ref,
        },
      ),
    );
  }
  if (
    (kind === "create" || kind === "replace") &&
    object.ref.kind === "index" &&
    object.metadata.concurrent === true &&
    config.transactionMode === "per-migration"
  ) {
    blocked = true;
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_CONCURRENT_INDEX_UNSUPPORTED",
        "error",
        "CREATE INDEX CONCURRENTLY cannot run inside a per-migration transaction",
        {
          hint: "Create the index without CONCURRENTLY, or set transactionMode to per-statement and run the concurrent companion through an explicit out-of-transaction operational lane.",
          ref: object.ref,
        },
      ),
    );
  }
  const operation: MigrationOperation = {
    blocked,
    destructive,
    diagnostics,
    key,
    kind,
    metadata: {},
    ref: object.ref,
  };
  if (before) {
    operation.before = before;
  }
  if (after) {
    operation.after = after;
  }
  return operation;
}
function makeRenameOperation(before: SchemaObject, after: SchemaObject): MigrationOperation {
  const diagnostics: Diagnostic[] = [];
  let blocked = false;
  if (before.ref.kind !== after.ref.kind) {
    blocked = true;
    diagnostics.push(
      diagnostic("SUPA_PLAN_RENAME_KIND_MISMATCH", "error", "rename hint changes object kind", {
        hint: `${before.key} -> ${after.key}`,
        ref: after.ref,
      }),
    );
  }
  if (!isSupportedRenameKind(after.ref.kind)) {
    blocked = true;
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_RENAME_UNSUPPORTED",
        "error",
        `${after.ref.kind} renames are not yet rendered safely`,
        {
          hint: "Keep this change hand-authored or model it as an explicit create/drop with hints.",
          ref: after.ref,
        },
      ),
    );
  }
  if (!sameRenameNamespace(before.ref, after.ref)) {
    blocked = true;
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_RENAME_SET_SCHEMA_UNSUPPORTED",
        "error",
        "rename hints cannot move an object between schemas",
        {
          hint: `${before.key} -> ${after.key}`,
          ref: after.ref,
        },
      ),
    );
  }
  diagnostics.push(
    diagnostic(
      "SUPA_PLAN_RENAME_VERIFY_REQUIRED",
      "warning",
      "explicit rename hints must be verified against a disposable PostgreSQL database",
      {
        hint: `${before.key} -> ${after.key}`,
        ref: after.ref,
      },
    ),
  );
  return {
    after,
    before,
    blocked,
    destructive: false,
    diagnostics,
    key: `${before.key}->${after.key}`,
    kind: "rename",
    metadata: {},
    ref: after.ref,
  };
}
function makeEnumAddValuesOperation(
  before: SchemaObject,
  after: SchemaObject,
): MigrationOperation | undefined {
  if (before.ref.kind !== "enum" || after.ref.kind !== "enum") {
    return undefined;
  }
  const beforeValues = enumValues(before);
  const afterValues = enumValues(after);
  if (!beforeValues || !afterValues || afterValues.length <= beforeValues.length) {
    return undefined;
  }
  const isPrefix = beforeValues.every((value, index) => afterValues[index] === value);
  if (!isPrefix) {
    return undefined;
  }
  return {
    after,
    before,
    blocked: false,
    destructive: false,
    diagnostics: [],
    key: after.key,
    kind: "alter",
    metadata: { addEnumValues: afterValues.slice(beforeValues.length) },
    ref: after.ref,
  };
}
function enumValues(object: SchemaObject): string[] | undefined {
  const values = object.metadata.values;
  if (!Array.isArray(values)) {
    return undefined;
  }
  const strings = values.filter((value): value is string => typeof value === "string");
  return strings.length === values.length ? strings : undefined;
}
/**
 * Names what actually differs between the two definitions so a gated replace
 * is reviewable without manually diffing SQL. Tables get a per-column report
 * from their canonical shapes; other kinds report a definition change.
 */
function describeReplaceDifference(
  before: SchemaObject | undefined,
  after: SchemaObject | undefined,
): string | undefined {
  if (!before || !after) {
    return undefined;
  }
  const beforeShape = asShape(before.metadata.canonicalShape);
  const afterShape = asShape(after.metadata.canonicalShape);
  if (!beforeShape || !afterShape) {
    return "definition differs";
  }
  const parts: string[] = [];
  const beforeColumns = shapeColumns(beforeShape);
  const afterColumns = shapeColumns(afterShape);
  for (const [name, column] of beforeColumns) {
    const other = afterColumns.get(name);
    if (!other) {
      parts.push(`column "${name}" only in current state`);
      continue;
    }
    if (stableJson(column) !== stableJson(other)) {
      const changed = Object.keys({ ...column, ...other }).filter(
        (field) => stableJson(column[field]) !== stableJson(other[field]),
      );
      parts.push(`column "${name}" differs (${changed.join(", ")})`);
    }
  }
  for (const name of afterColumns.keys()) {
    if (!beforeColumns.has(name)) {
      parts.push(`column "${name}" only in target state`);
    }
  }
  const beforeRest = stableJson({ ...beforeShape, columns: undefined });
  const afterRest = stableJson({ ...afterShape, columns: undefined });
  if (beforeRest !== afterRest) {
    const keys = new Set([...Object.keys(beforeShape), ...Object.keys(afterShape)]);
    keys.delete("columns");
    const changed = [...keys].filter(
      (field) => stableJson(beforeShape[field]) !== stableJson(afterShape[field]),
    );
    parts.push(`table options differ (${changed.join(", ")})`);
  }
  return parts.length > 0 ? parts.join("; ") : "definition differs";
}

function asShape(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shapeColumns(shape: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const columns = Array.isArray(shape.columns) ? shape.columns : [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const column of columns) {
    const record = asShape(column);
    if (record && typeof record.name === "string") {
      byName.set(record.name, record);
    }
  }
  return byName;
}

function isDestructive(kind: MigrationOperationKind, objectKind: ObjectKind): boolean {
  if (kind === "alter" || kind === "create" || kind === "rename") {
    return false;
  }
  if (kind === "drop") {
    return [
      "schema",
      "table",
      "foreign-data-wrapper",
      "foreign-server",
      "foreign-table",
      "type",
      "domain",
      "enum",
      "sequence",
      "materialized-view",
      "grant",
      "default-privilege",
      "rls",
    ].includes(objectKind);
  }
  return [
    "table",
    "foreign-data-wrapper",
    "foreign-server",
    "foreign-table",
    "type",
    "domain",
    "enum",
    "materialized-view",
    "rls",
  ].includes(objectKind);
}
function isSupportedRenameKind(kind: ObjectKind): boolean {
  return [
    "schema",
    "table",
    "sequence",
    "index",
    "function",
    "procedure",
    "view",
    "materialized-view",
  ].includes(kind);
}
function sameRenameNamespace(before: ObjectRef, after: ObjectRef): boolean {
  if (before.kind === "schema" && after.kind === "schema") {
    return true;
  }
  return (before.schema ?? "public") === (after.schema ?? "public");
}
