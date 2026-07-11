import type { Diagnostic, MigrationOperation, ObjectKind, ObjectRef } from "../core.js";
import { diagnostic } from "../diagnostics.js";

const createOrder = new Map<ObjectKind, number>([
  ["schema", 10],
  ["extension", 20],
  ["enum", 30],
  ["type", 40],
  ["domain", 50],
  ["sequence", 60],
  ["foreign-data-wrapper", 70],
  ["foreign-server", 80],
  ["table", 90],
  ["foreign-table", 100],
  ["constraint", 110],
  ["index", 120],
  ["function", 130],
  ["procedure", 140],
  ["view", 150],
  ["materialized-view", 160],
  ["trigger", 170],
  ["rls", 180],
  ["policy", 190],
  ["default-privilege", 200],
  ["grant", 210],
  ["comment", 220],
]);

const dropOrder = new Map<ObjectKind, number>(
  [...createOrder.entries()].map(([kind, rank]) => [kind, 1000 - rank])
);

export function sortOperations(
  operations: MigrationOperation[],
  diagnostics: Diagnostic[]
): MigrationOperation[] {
  const base = [...operations].sort(compareOperations);
  const graph = buildDependencyGraph(base);
  const result = topoSortOperations(base, graph);
  if (result.sorted.length !== base.length) {
    const leftover = cyclicOperationKeys(base, result.remainingIncoming);
    diagnostics.push(
      diagnostic("SUPA_PLAN_DEPENDENCY_CYCLE", "error", "dependency ordering has a cycle", {
        hint: traceCycle(leftover, graph.outgoing) ?? [...leftover].join(", "),
      })
    );
    const sortedKeys = new Set(result.sorted.map((operation) => operation.key));
    return [...result.sorted, ...base.filter((operation) => !sortedKeys.has(operation.key))];
  }
  return result.sorted;
}

interface DependencyGraph {
  constraintDependencies: ConstraintDependencyIndex;
  incomingCount: Map<string, number>;
  operationByKey: Map<string, MigrationOperation>;
  outgoing: Map<string, Set<string>>;
}

function buildDependencyGraph(base: MigrationOperation[]): DependencyGraph {
  const operationByKey = new Map(base.map((operation) => [operation.key, operation]));

  const dropKeyByIdentity = identityIndex(base.filter((operation) => operation.kind === "drop"));
  const upsertKeyByIdentity = identityIndex(base.filter((operation) => operation.kind !== "drop"));
  const constraintDependencies = buildConstraintDependencyIndex(base);
  const outgoing = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  initializeDependencyGraph(base, outgoing, incomingCount);
  for (const operation of base) {
    const index = operation.kind === "drop" ? dropKeyByIdentity : upsertKeyByIdentity;
    addOperationDependencies(
      operation,
      index,
      constraintDependencies,
      operationByKey,
      outgoing,
      incomingCount
    );
  }
  return { constraintDependencies, incomingCount, operationByKey, outgoing };
}

function initializeDependencyGraph(
  operations: MigrationOperation[],
  outgoing: Map<string, Set<string>>,
  incomingCount: Map<string, number>
): void {
  for (const operation of operations) {
    outgoing.set(operation.key, new Set());
    incomingCount.set(operation.key, 0);
  }
}

function addOperationDependencies(
  operation: MigrationOperation,
  index: Map<string, string>,
  constraintDependencies: ConstraintDependencyIndex,
  operationByKey: Map<string, MigrationOperation>,
  outgoing: Map<string, Set<string>>,
  incomingCount: Map<string, number>
): void {
  for (const dependencyKey of operationDependencyKeys(operation, index, constraintDependencies)) {
    if (dependencyKey === operation.key) {
      continue;
    }
    const dependencyOperation = operationByKey.get(dependencyKey);
    if (!dependencyOperation) {
      continue;
    }
    const edge = operationDependencyEdge(operation, dependencyOperation, operationByKey);
    if (!edge) {
      continue;
    }
    const [from, to] = edge;
    addEdge(from, to, outgoing, incomingCount);
  }
  for (const dependencyKey of columnRewriteDependencyKeys(operation, index, operationByKey)) {
    if (dependencyKey !== operation.key && operationByKey.has(dependencyKey)) {
      addEdge(operation.key, dependencyKey, outgoing, incomingCount);
    }
  }
}

function topoSortOperations(
  base: MigrationOperation[],
  graph: DependencyGraph
): { remainingIncoming: Map<string, number>; sorted: MigrationOperation[] } {
  const remainingIncoming = new Map(graph.incomingCount);
  const ready = base.filter((operation) => remainingIncoming.get(operation.key) === 0);
  const sorted: MigrationOperation[] = [];
  while (ready.length > 0) {
    ready.sort(compareOperations);
    const operation = ready.shift();
    if (!operation) {
      break;
    }
    sorted.push(operation);
    for (const target of graph.outgoing.get(operation.key) ?? []) {
      const nextCount = (remainingIncoming.get(target) ?? 0) - 1;
      remainingIncoming.set(target, nextCount);
      if (nextCount === 0) {
        const targetOperation = graph.operationByKey.get(target);
        if (targetOperation) {
          ready.push(targetOperation);
        }
      }
    }
  }
  return { remainingIncoming, sorted };
}

function cyclicOperationKeys(
  operations: MigrationOperation[],
  incomingCount: Map<string, number>
): Set<string> {
  return new Set(
    operations
      .filter((operation) => (incomingCount.get(operation.key) ?? 0) > 0)
      .map((operation) => operation.key)
  );
}

function identityIndex(operations: MigrationOperation[]): Map<string, string> {
  const index = new Map<string, string>();
  const owners = new Set<string>();
  for (const operation of operations) {
    for (const object of [operation.before, operation.after]) {
      if (!object) {
        continue;
      }
      const identity = refIdentity(object.ref);
      const owner = isDependencyOwner(object.ref);
      if (!index.has(identity) || (owner && !owners.has(identity))) {
        index.set(identity, operation.key);
      }
      if (owner) {
        owners.add(identity);
      }
    }
  }
  return index;
}

function isDependencyOwner(ref: ObjectRef): boolean {
  switch (ref.kind) {
    case "schema":
    case "extension":
    case "enum":
    case "type":
    case "domain":
    case "sequence":
    case "foreign-data-wrapper":
    case "foreign-server":
    case "table":
    case "foreign-table":
    case "function":
    case "procedure":
    case "view":
    case "materialized-view":
      return true;
    default:
      return false;
  }
}

interface ConstraintDependencyIndex {
  keyConstraintsByTableColumns: Map<string, Set<string>>;
  primaryConstraintsByTable: Map<string, Set<string>>;
}

function buildConstraintDependencyIndex(
  operations: MigrationOperation[]
): ConstraintDependencyIndex {
  const keyConstraintsByTableColumns = new Map<string, Set<string>>();
  const primaryConstraintsByTable = new Map<string, Set<string>>();
  for (const operation of operations) {
    const object =
      operation.kind === "drop" ? operation.before : (operation.after ?? operation.before);
    if (object?.ref.kind !== "constraint") {
      continue;
    }
    const constraintType =
      typeof object.metadata.constraintType === "string"
        ? object.metadata.constraintType
        : undefined;
    if (constraintType !== "CONSTR_PRIMARY" && constraintType !== "CONSTR_UNIQUE") {
      continue;
    }
    const table = tableIdentity(object.ref);
    if (!table) {
      continue;
    }
    const columns = stringMetadataArray(object.metadata.constraintColumns);
    addConstraintDependency(
      keyConstraintsByTableColumns,
      tableColumnsIdentity(table, columns),
      operation.key
    );
    if (constraintType === "CONSTR_PRIMARY") {
      addConstraintDependency(primaryConstraintsByTable, table, operation.key);
    }
  }
  return { keyConstraintsByTableColumns, primaryConstraintsByTable };
}

function addConstraintDependency(
  index: Map<string, Set<string>>,
  key: string,
  operationKey: string
): void {
  const existing = index.get(key);
  if (existing) {
    existing.add(operationKey);
    return;
  }
  index.set(key, new Set([operationKey]));
}

function refIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

function operationDependencyKeys(
  operation: MigrationOperation,
  operationKeyByIdentity: Map<string, string>,
  constraintDependencies: ConstraintDependencyIndex
): string[] {
  const source =
    operation.kind === "drop" ? operation.before : (operation.after ?? operation.before);
  if (!source) {
    return [];
  }
  const keys = new Set<string>();
  for (const reference of source.dependencies) {
    const operationKey = operationKeyByIdentity.get(reference);
    if (operationKey) {
      keys.add(operationKey);
    }
    const schemaOperationKey = operationKeyByIdentity.get(reference.split(".")[0] ?? "");
    if (schemaOperationKey) {
      keys.add(schemaOperationKey);
    }
  }
  const ownSchema = source.ref.schema;
  if (ownSchema) {
    const schemaOperationKey = operationKeyByIdentity.get(ownSchema);
    if (schemaOperationKey) {
      keys.add(schemaOperationKey);
    }
  }
  const ownTable = tableIdentity(source.ref);
  if (ownTable) {
    const tableOperationKey = operationKeyByIdentity.get(ownTable);
    if (tableOperationKey) {
      keys.add(tableOperationKey);
    }
  }
  if (source.ref.kind === "constraint") {
    for (const dependencyKey of constraintOperationDependencyKeys(source, constraintDependencies)) {
      keys.add(dependencyKey);
    }
  }
  return [...keys];
}

function operationDependencyEdge(
  operation: MigrationOperation,
  dependencyOperation: MigrationOperation,
  operationByKey: ReadonlyMap<string, MigrationOperation>
): [string, string] | undefined {
  if (isTableAlterDependency(dependencyOperation)) {
    const source =
      operation.kind === "drop" ? operation.before : (operation.after ?? operation.before);
    if (isDestructiveTableAlterRewriteDependency(operation, dependencyOperation)) {
      if (
        source &&
        isPreDroppedBlockingColumnDependent(operation, operationByKey) &&
        dependsOnAlteredTableColumns(source, dependencyOperation)
      ) {
        return [dependencyOperation.key, operation.key];
      }
      return [operation.key, dependencyOperation.key];
    }
    if (source && dependsOnAlteredTableColumns(source, dependencyOperation)) {
      return [dependencyOperation.key, operation.key];
    }
    if (source && !dependsOnAddedTableAlterColumns(source, dependencyOperation)) {
      return;
    }
  }
  return operation.kind === "drop"
    ? [operation.key, dependencyOperation.key]
    : [dependencyOperation.key, operation.key];
}

function isPreDroppedBlockingColumnDependent(
  operation: MigrationOperation,
  operationByKey: ReadonlyMap<string, MigrationOperation>
): boolean {
  const object = operation.before ?? operation.after;
  return (
    object !== undefined &&
    blockingColumnDependentKinds.has(object.ref.kind) &&
    operationByKey.has(`pre-drop:${operation.key}`)
  );
}

function columnRewriteDependencyKeys(
  operation: MigrationOperation,
  operationKeyByIdentity: Map<string, string>,
  operationByKey: Map<string, MigrationOperation>
): string[] {
  if (!(operation.kind === "replace" && operation.before)) {
    return [];
  }
  const keys = new Set<string>();
  for (const reference of operation.before.dependencies) {
    const key = operationKeyByIdentity.get(reference);
    const dependencyOperation = key ? operationByKey.get(key) : undefined;
    if (
      key &&
      dependencyOperation &&
      isDestructiveTableAlterRewriteDependency(operation, dependencyOperation)
    ) {
      if (
        operation.after &&
        isPreDroppedBlockingColumnDependent(operation, operationByKey) &&
        dependsOnAlteredTableColumns(operation.after, dependencyOperation)
      ) {
        continue;
      }
      keys.add(key);
    }
  }
  return [...keys];
}

function isTableAlterDependency(operation: MigrationOperation): boolean {
  return operation.kind === "alter" && operation.ref.kind === "table";
}

function isDestructiveTableAlterRewriteDependency(
  operation: MigrationOperation,
  dependencyOperation: MigrationOperation
): boolean {
  if (!(isTableAlterDependency(dependencyOperation) && operation.before)) {
    return false;
  }
  if (!columnDependentKinds.has(operation.before.ref.kind)) {
    return false;
  }
  return hasColumnDependency(
    operation.before,
    destructiveChangedColumnIdentities(dependencyOperation)
  );
}

function dependsOnAddedTableAlterColumns(
  source: NonNullable<MigrationOperation["after"]>,
  dependencyOperation: MigrationOperation
): boolean {
  const addedColumns = addedColumnIdentities(dependencyOperation);
  if (addedColumns.size === 0) {
    return false;
  }
  if (!columnDependentKinds.has(source.ref.kind)) {
    return true;
  }
  const dependencies = columnDependencyIdentities(source);
  return dependencies.length === 0 || dependencies.some((item) => addedColumns.has(item));
}

const columnDependentKinds = new Set<ObjectKind>([
  "function",
  "index",
  "materialized-view",
  "policy",
  "procedure",
  "trigger",
  "view",
]);
const blockingColumnDependentKinds = new Set<ObjectKind>(["index", "materialized-view", "view"]);

function addedColumnIdentities(operation: MigrationOperation): Set<string> {
  const table = refIdentity(operation.ref);
  const identities = new Set<string>();
  for (const column of objectMetadataArray(operation.metadata.addColumns)) {
    if (typeof column.name === "string") {
      identities.add(`${table}.${column.name}`);
    }
  }
  return identities;
}

function destructiveChangedColumnIdentities(operation: MigrationOperation): Set<string> {
  const table = refIdentity(operation.ref);
  const identities = new Set<string>();
  for (const column of stringMetadataArray(operation.metadata.dropColumns)) {
    identities.add(`${table}.${column}`);
  }
  for (const alteration of objectMetadataArray(operation.metadata.alterColumns)) {
    if (typeof alteration.name === "string" && typeof alteration.type === "string") {
      identities.add(`${table}.${alteration.name}`);
    }
  }
  return identities;
}

function alteredColumnIdentities(operation: MigrationOperation): Set<string> {
  const table = refIdentity(operation.ref);
  const identities = new Set<string>();
  for (const alteration of objectMetadataArray(operation.metadata.alterColumns)) {
    if (typeof alteration.name === "string" && typeof alteration.type === "string") {
      identities.add(`${table}.${alteration.name}`);
    }
  }
  return identities;
}

function dependsOnAlteredTableColumns(
  source: NonNullable<MigrationOperation["after"]>,
  dependencyOperation: MigrationOperation
): boolean {
  if (!columnDependentKinds.has(source.ref.kind)) {
    return false;
  }
  return hasColumnDependency(source, alteredColumnIdentities(dependencyOperation));
}

function hasColumnDependency(
  source: NonNullable<MigrationOperation["after"]>,
  columns: ReadonlySet<string>
): boolean {
  return columnDependencyIdentities(source).some((dependency) => columns.has(dependency));
}

function columnDependencyIdentities(source: NonNullable<MigrationOperation["after"]>): string[] {
  return [
    ...stringMetadataArray(source.metadata.columnDependencies),
    ...stringMetadataArray(source.metadata.routineColumnDependencies),
  ];
}

function constraintOperationDependencyKeys(
  source: NonNullable<MigrationOperation["after"]>,
  constraintDependencies: ConstraintDependencyIndex
): string[] {
  const keys = new Set<string>();
  const target = foreignKeyTarget(source.metadata.foreignKeyTarget);
  if (!target) {
    return [...keys];
  }
  const targetTable = `${target.schema}.${target.table}`;
  const targetColumns = target.columns;
  const referencedKeyOperations =
    targetColumns.length > 0
      ? constraintDependencies.keyConstraintsByTableColumns.get(
          tableColumnsIdentity(targetTable, targetColumns)
        )
      : constraintDependencies.primaryConstraintsByTable.get(targetTable);
  for (const operationKey of referencedKeyOperations ?? []) {
    keys.add(operationKey);
  }
  return [...keys];
}

function tableIdentity(ref: ObjectRef): string | undefined {
  if (!ref.table) {
    return;
  }
  return `${ref.schema ?? "public"}.${ref.table}`;
}

function tableColumnsIdentity(table: string, columns: readonly string[]): string {
  return `${table}:${columns.join(",")}`;
}

function stringMetadataArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectMetadataArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function foreignKeyTarget(
  value: unknown
): { columns: string[]; schema: string; table: string } | undefined {
  const record = recordFromObject(value);
  if (!record) {
    return;
  }
  if (typeof record.schema !== "string" || typeof record.table !== "string") {
    return;
  }
  return {
    columns: stringMetadataArray(record.columns),
    schema: record.schema,
    table: record.table,
  };
}

function recordFromObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return Object.fromEntries(Object.entries(value));
}

function addEdge(
  from: string,
  to: string,
  outgoing: Map<string, Set<string>>,
  incomingCount: Map<string, number>
): void {
  const targets = outgoing.get(from);
  if (!targets || targets.has(to)) {
    return;
  }
  targets.add(to);
  incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);
}

function traceCycle(leftover: Set<string>, outgoing: Map<string, Set<string>>): string | undefined {
  for (const start of leftover) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      path.push(current);
      current = [...(outgoing.get(current) ?? [])].find((target) => leftover.has(target));
    }
    if (current !== undefined) {
      const cycleStart = path.indexOf(current);
      return [...path.slice(cycleStart), current].join(" -> ");
    }
  }
}

export function compareOperations(left: MigrationOperation, right: MigrationOperation): number {
  const rank = operationRank(left) - operationRank(right);
  if (rank !== 0) {
    return rank;
  }
  const ordinal = operationOrdinal(left) - operationOrdinal(right);
  if (ordinal !== 0) {
    return ordinal;
  }
  return left.key.localeCompare(right.key);
}

function operationRank(operation: MigrationOperation): number {
  if (operation.kind === "drop") {
    return dropOrder.get(operation.ref.kind) ?? 500;
  }
  if (operation.kind === "rename") {
    return 900 + (createOrder.get(operation.ref.kind) ?? 500);
  }
  if (operation.kind === "alter") {
    return 1050 + (createOrder.get(operation.ref.kind) ?? 500);
  }
  return 1000 + (createOrder.get(operation.ref.kind) ?? 500);
}

function operationOrdinal(operation: MigrationOperation): number {
  if (operation.kind === "drop") {
    return -(operation.before?.ordinal ?? 0);
  }
  return operation.after?.ordinal ?? operation.before?.ordinal ?? 0;
}
