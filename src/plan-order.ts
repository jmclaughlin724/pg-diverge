import type { Diagnostic, MigrationOperation, ObjectKind, ObjectRef } from "./core.js";
import { diagnostic } from "./diagnostics.js";

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
  [...createOrder.entries()].map(([kind, rank]) => [kind, 1000 - rank]),
);

export function sortOperations(
  operations: MigrationOperation[],
  diagnostics: Diagnostic[],
): MigrationOperation[] {
  const base = [...operations].sort(compareOperations);
  const operationByKey = new Map(base.map((operation) => [operation.key, operation]));
  const operationKeyByIdentity = identityIndex(base);
  const outgoing = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  for (const operation of base) {
    outgoing.set(operation.key, new Set());
    incomingCount.set(operation.key, 0);
  }
  for (const operation of base) {
    for (const dependencyKey of operationDependencyKeys(operation, operationKeyByIdentity)) {
      if (dependencyKey === operation.key || !operationByKey.has(dependencyKey)) {
        continue;
      }
      if (operation.kind === "drop") {
        addEdge(operation.key, dependencyKey, outgoing, incomingCount);
      } else {
        addEdge(dependencyKey, operation.key, outgoing, incomingCount);
      }
    }
  }
  const remainingIncoming = new Map(incomingCount);
  const ready = base.filter((operation) => remainingIncoming.get(operation.key) === 0);
  const sorted: MigrationOperation[] = [];
  while (ready.length > 0) {
    ready.sort(compareOperations);
    const operation = ready.shift();
    if (!operation) {
      break;
    }
    sorted.push(operation);
    for (const target of outgoing.get(operation.key) ?? []) {
      const nextCount = (remainingIncoming.get(target) ?? 0) - 1;
      remainingIncoming.set(target, nextCount);
      if (nextCount === 0) {
        const targetOperation = operationByKey.get(target);
        if (targetOperation) {
          ready.push(targetOperation);
        }
      }
    }
  }
  if (sorted.length !== base.length) {
    const leftover = new Set(
      base
        .filter((operation) => (remainingIncoming.get(operation.key) ?? 0) > 0)
        .map((operation) => operation.key),
    );
    diagnostics.push(
      diagnostic("PD_PLAN_DEPENDENCY_CYCLE", "error", "dependency ordering has a cycle", {
        hint: traceCycle(leftover, outgoing) ?? [...leftover].join(", "),
      }),
    );
    return base;
  }
  return sorted;
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

function refIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

function operationDependencyKeys(
  operation: MigrationOperation,
  operationKeyByIdentity: Map<string, string>,
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
  return [...keys];
}

function addEdge(
  from: string,
  to: string,
  outgoing: Map<string, Set<string>>,
  incomingCount: Map<string, number>,
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
  return undefined;
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
