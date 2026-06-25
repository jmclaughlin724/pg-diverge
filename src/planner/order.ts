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
    return base;
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
    if (dependencyKey === operation.key || !operationByKey.has(dependencyKey)) {
      continue;
    }
    const [from, to] =
      operation.kind === "drop" ? [operation.key, dependencyKey] : [dependencyKey, operation.key];
    addEdge(from, to, outgoing, incomingCount);
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
  for (const operation of operations) {
    for (const object of [operation.before, operation.after]) {
      if (!object) {
        continue;
      }
      index.set(refIdentity(object.ref), operation.key);
    }
  }
  return index;
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
  if (source.ref.kind === "constraint") {
    for (const dependencyKey of constraintOperationDependencyKeys(
      source,
      operationKeyByIdentity,
      constraintDependencies
    )) {
      keys.add(dependencyKey);
    }
  }
  return [...keys];
}

function constraintOperationDependencyKeys(
  source: NonNullable<MigrationOperation["after"]>,
  operationKeyByIdentity: Map<string, string>,
  constraintDependencies: ConstraintDependencyIndex
): string[] {
  const keys = new Set<string>();
  const ownTable = tableIdentity(source.ref);
  if (ownTable) {
    const tableOperationKey = operationKeyByIdentity.get(ownTable);
    if (tableOperationKey) {
      keys.add(tableOperationKey);
    }
  }
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
  return;
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
