import type { ObjectKind, ObjectRef, SchemaObject } from "../types.js";

const grantableKinds = new Set<ObjectKind>([
  "domain",
  "enum",
  "foreign-data-wrapper",
  "foreign-server",
  "foreign-table",
  "function",
  "materialized-view",
  "procedure",
  "schema",
  "sequence",
  "table",
  "type",
  "view",
]);

export const relationOwnerKinds = new Set<ObjectKind>([
  "foreign-table",
  "materialized-view",
  "table",
  "view",
]);

export function grantTargetIdentity(ref: ObjectRef): string | undefined {
  if (!grantableKinds.has(ref.kind)) {
    return;
  }
  if (ref.kind === "schema") {
    return ref.name;
  }
  if (ref.kind === "function" || ref.kind === "procedure") {
    return `${ref.schema ?? "public"}.${ref.name}(${ref.signature ?? ""})`;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

export function isGrantForTargets(
  object: SchemaObject,
  targetIdentities: ReadonlySet<string>
): boolean {
  if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
    return false;
  }
  const targetIdentity = object.metadata.targetIdentity;
  return typeof targetIdentity === "string" && targetIdentities.has(targetIdentity);
}

export function isCommentForRefs(object: SchemaObject, refs: Iterable<ObjectRef>): boolean {
  if (object.ref.kind !== "comment" || typeof object.metadata.descriptor !== "string") {
    return false;
  }
  const { descriptor } = object.metadata;
  for (const ref of refs) {
    if (commentTargetsRef(descriptor, ref)) {
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
    case "foreign-table":
      return (
        descriptor === `foreign table ${identity}` || descriptor.startsWith(`column ${identity}.`)
      );
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
    case "schema":
      return descriptor === `schema ${ref.name}`;
    case "extension":
      return descriptor === `extension ${ref.name}`;
    case "sequence":
      return descriptor === `sequence ${identity}`;
    case "function":
      return descriptor === `function ${identity}(${ref.signature ?? ""})`;
    case "procedure":
      return descriptor === `procedure ${identity}(${ref.signature ?? ""})`;
    case "enum":
    case "type":
      return descriptor === `type ${identity}`;
    case "domain":
      return descriptor === `domain ${identity}`;
    case "policy":
      return descriptor === `policy ${tableRefIdentity(ref)}.${ref.name}`;
    case "trigger":
      return descriptor === `trigger ${tableRefIdentity(ref)}.${ref.name}`;
    default:
      return false;
  }
}

export function refIdentity(ref: ObjectRef): string {
  if (ref.kind === "schema") {
    return ref.name;
  }
  return `${ref.schema ?? "public"}.${ref.name}`;
}

export function tableRefIdentity(ref: ObjectRef): string | undefined {
  return ref.table ? `${ref.schema ?? "public"}.${ref.table}` : undefined;
}
