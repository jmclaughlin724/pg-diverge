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
  options: DiffOptions = {}
): MigrationPlan {
  const config = resolveConfig(options.config);
  const operations: MigrationOperation[] = [];
  const diagnostics: Diagnostic[] = [...from.diagnostics, ...to.diagnostics];
  const fromMap = objectMap(from.objects);
  const toMap = objectMap(to.objects);
  const consumedFrom = new Set<string>();
  const consumedTo = new Set<string>();
  applyRenameHints(fromMap, toMap, consumedFrom, consumedTo, operations, diagnostics, config);
  appendChangedAndDroppedOperations(fromMap, toMap, consumedFrom, operations, config);
  appendCreatedOperations(fromMap, toMap, consumedTo, operations, config);
  appendReplacedRelationDependents(operations, from, to, config);
  const sortedOperations = sortOperations(operations, diagnostics);
  appendOperationDiagnostics(diagnostics, operations);
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
      })
    ),
    from: from.source,
    fromFingerprint: from.fingerprint,
    operations: sortedOperations,
    to: to.source,
    toFingerprint: to.fingerprint,
  };
}

function applyRenameHints(
  fromMap: Map<string, SchemaObject>,
  toMap: Map<string, SchemaObject>,
  consumedFrom: Set<string>,
  consumedTo: Set<string>,
  operations: MigrationOperation[],
  diagnostics: Diagnostic[],
  config: SupaschemaConfig
): void {
  if (config.renameDetection !== "hints-only") {
    return;
  }
  for (const hint of config.hints.renames ?? []) {
    const before = fromMap.get(hint.from);
    const after = toMap.get(hint.to);
    if (!(before && after)) {
      diagnostics.push(renameHintUnmatchedDiagnostic(hint.from, hint.to));
      continue;
    }
    operations.push(makeRenameOperation(before, after));
    consumedFrom.add(before.key);
    consumedTo.add(after.key);
  }
}

function renameHintUnmatchedDiagnostic(from: string, to: string): Diagnostic {
  return diagnostic(
    "SUPA_PLAN_RENAME_HINT_UNMATCHED",
    "error",
    "rename hint does not match both source and target objects",
    {
      hint: `from=${from} to=${to}`,
    }
  );
}

function appendChangedAndDroppedOperations(
  fromMap: Map<string, SchemaObject>,
  toMap: Map<string, SchemaObject>,
  consumedFrom: Set<string>,
  operations: MigrationOperation[],
  config: SupaschemaConfig
): void {
  for (const [key, before] of fromMap) {
    if (consumedFrom.has(key)) {
      continue;
    }
    const after = toMap.get(key);
    if (!after) {
      operations.push(makeOperation("drop", key, before, undefined, config));
    } else if (before.hash !== after.hash) {
      operations.push(makeChangedOperation(key, before, after, config));
    }
  }
}

function makeChangedOperation(
  key: string,
  before: SchemaObject,
  after: SchemaObject,
  config: SupaschemaConfig
): MigrationOperation {
  return (
    makeEnumAddValuesOperation(before, after) ??
    makeTableAlterOperation(before, after, config) ??
    refineReplaceOperation(makeOperation("replace", key, before, after, config), config)
  );
}

function appendCreatedOperations(
  fromMap: Map<string, SchemaObject>,
  toMap: Map<string, SchemaObject>,
  consumedTo: Set<string>,
  operations: MigrationOperation[],
  config: SupaschemaConfig
): void {
  for (const [key, after] of toMap) {
    if (!(consumedTo.has(key) || fromMap.has(key))) {
      operations.push(makeOperation("create", key, undefined, after, config));
    }
  }
}

function appendOperationDiagnostics(
  diagnostics: Diagnostic[],
  operations: MigrationOperation[]
): void {
  for (const operation of operations) {
    diagnostics.push(...operation.diagnostics);
  }
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

function appendReplacedRelationDependents(
  operations: MigrationOperation[],
  from: SchemaModel,
  to: SchemaModel,
  config: SupaschemaConfig
): void {
  const replacedRelations = replacedRelationRefs(operations);
  if (replacedRelations.length === 0) {
    return;
  }

  const context = replacedDependentContext(from, operations, replacedRelations);
  expandAffectedRelationDependents(to.objects, operations, context, config);
  appendAffectedComments(to.objects, operations, context, config);
}

interface ReplacedDependentContext {
  affectedRefs: Map<string, ObjectRef>;
  fromKeys: Set<string>;
  operationKeys: Set<string>;
  relationIdentities: Set<string>;
}

function replacedRelationRefs(operations: MigrationOperation[]): ObjectRef[] {
  return operations
    .filter(
      (operation) => operation.kind === "replace" && replacedRelationKinds.has(operation.ref.kind)
    )
    .map((operation) => operation.ref);
}

function replacedDependentContext(
  from: SchemaModel,
  operations: MigrationOperation[],
  replacedRelations: ObjectRef[]
): ReplacedDependentContext {
  const context: ReplacedDependentContext = {
    affectedRefs: new Map(),
    fromKeys: new Set(from.objects.map((object) => object.key)),
    operationKeys: new Set(operations.map((operation) => operation.key)),
    relationIdentities: new Set(),
  };
  for (const relation of replacedRelations) {
    rememberAffectedRef(context.affectedRefs, relation);
    context.relationIdentities.add(refIdentity(relation));
  }
  return context;
}

function expandAffectedRelationDependents(
  objects: SchemaObject[],
  operations: MigrationOperation[],
  context: ReplacedDependentContext,
  config: SupaschemaConfig
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of objects) {
      if (appendAffectedRelationDependent(object, operations, context, config)) {
        changed = true;
      }
    }
  }
}

function appendAffectedRelationDependent(
  object: SchemaObject,
  operations: MigrationOperation[],
  context: ReplacedDependentContext,
  config: SupaschemaConfig
): boolean {
  if (!isRelationDependent(object, context.relationIdentities)) {
    return false;
  }
  let changed = false;
  rememberAffectedRef(context.affectedRefs, object.ref);
  if (appendBlockingDependentPreDrop(object, operations, context, config)) {
    changed = true;
  }
  if (!context.operationKeys.has(object.key)) {
    operations.push(makeOperation("create", object.key, undefined, object, config));
    context.operationKeys.add(object.key);
    changed = true;
  }
  return changed;
}

function appendBlockingDependentPreDrop(
  object: SchemaObject,
  operations: MigrationOperation[],
  context: ReplacedDependentContext,
  config: SupaschemaConfig
): boolean {
  if (!(blockingRelationDependentKinds.has(object.ref.kind) && context.fromKeys.has(object.key))) {
    return false;
  }
  let changed = rememberRelationIdentity(context.relationIdentities, object.ref);
  const key = preDropKey(object.key);
  if (!context.operationKeys.has(key)) {
    operations.push(makePreDropOperation(object, config));
    context.operationKeys.add(key);
    changed = true;
  }
  return changed;
}

function rememberRelationIdentity(identities: Set<string>, ref: ObjectRef): boolean {
  const identity = refIdentity(ref);
  if (identities.has(identity)) {
    return false;
  }
  identities.add(identity);
  return true;
}

function appendAffectedComments(
  objects: SchemaObject[],
  operations: MigrationOperation[],
  context: ReplacedDependentContext,
  config: SupaschemaConfig
): void {
  for (const object of objects) {
    if (
      context.operationKeys.has(object.key) ||
      !isCommentDependent(object, context.affectedRefs)
    ) {
      continue;
    }
    operations.push(makeOperation("create", object.key, undefined, object, config));
    context.operationKeys.add(object.key);
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
  affectedRefs: ReadonlyMap<string, ObjectRef>
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

function emptyPlanDriftDiagnostic(
  fromMap: Map<string, SchemaObject>,
  toMap: Map<string, SchemaObject>,
  from: SchemaModel,
  to: SchemaModel
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
    }
  );
}

function makeOperation(
  kind: MigrationOperationKind,
  key: string,
  before: SchemaObject | undefined,
  after: SchemaObject | undefined,
  config: SupaschemaConfig
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
        }
      )
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
        }
      )
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
        }
      )
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
      })
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
        }
      )
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
        }
      )
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
      }
    )
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
  after: SchemaObject
): MigrationOperation | undefined {
  if (before.ref.kind !== "enum" || after.ref.kind !== "enum") {
    return;
  }
  const beforeValues = enumValues(before);
  const afterValues = enumValues(after);
  if (!(beforeValues && afterValues) || afterValues.length <= beforeValues.length) {
    return;
  }
  const isPrefix = beforeValues.every((value, index) => afterValues[index] === value);
  if (!isPrefix) {
    return;
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
    return;
  }
  const strings = values.filter((value): value is string => typeof value === "string");
  return strings.length === values.length ? strings : undefined;
}

function describeReplaceDifference(
  before: SchemaObject | undefined,
  after: SchemaObject | undefined
): string | undefined {
  if (!(before && after)) {
    return;
  }
  const beforeShape = asShape(before.metadata.canonicalShape);
  const afterShape = asShape(after.metadata.canonicalShape);
  if (!(beforeShape && afterShape)) {
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
        (field) => stableJson(column[field]) !== stableJson(other[field])
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
      (field) => stableJson(beforeShape[field]) !== stableJson(afterShape[field])
    );
    parts.push(`table options differ (${changed.join(", ")})`);
  }
  return parts.length > 0 ? parts.join("; ") : "definition differs";
}

function asShape(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return Object.fromEntries(Object.entries(value));
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
