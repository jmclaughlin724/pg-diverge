import type {
  CommentTarget,
  CommentTargetKind,
  ObjectKind,
  ObjectRef,
  SchemaObject,
} from "../types.js";

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

const relationCommentKinds = new Map<ObjectKind, CommentTarget["kind"]>([
  ["foreign-table", "foreign-table"],
  ["materialized-view", "materialized-view"],
  ["table", "table"],
  ["view", "view"],
]);

const directCommentKinds = new Map<ObjectKind, CommentTarget["kind"]>([
  ["domain", "domain"],
  ["enum", "type"],
  ["extension", "extension"],
  ["index", "index"],
  ["schema", "schema"],
  ["sequence", "sequence"],
  ["type", "type"],
]);

const tableScopedCommentKinds = new Map<ObjectKind, CommentTarget["kind"]>([
  ["constraint", "constraint"],
  ["policy", "policy"],
  ["trigger", "trigger"],
]);

const commentTargetKinds: ReadonlySet<string> = new Set([
  "column",
  "constraint",
  "domain",
  "extension",
  "foreign-table",
  "function",
  "index",
  "materialized-view",
  "policy",
  "procedure",
  "schema",
  "sequence",
  "table",
  "trigger",
  "type",
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
  const target = commentTarget(object);
  if (object.ref.kind !== "comment" || !target) {
    return false;
  }
  for (const ref of refs) {
    if (commentTargetsRef(target, ref)) {
      return true;
    }
  }
  return false;
}

function commentTargetsRef(target: CommentTarget, ref: ObjectRef): boolean {
  if (
    ref.kind !== "schema" &&
    ref.kind !== "extension" &&
    (target.schema ?? "public") !== (ref.schema ?? "public")
  ) {
    return false;
  }
  const relationKind = relationCommentKinds.get(ref.kind);
  if (relationKind) {
    return (
      (target.kind === relationKind && target.name === ref.name) ||
      (target.kind === "column" && target.table === ref.name)
    );
  }
  const directKind = directCommentKinds.get(ref.kind);
  if (directKind) {
    return target.kind === directKind && target.name === ref.name;
  }
  if (ref.kind === "function" || ref.kind === "procedure") {
    return routineCommentTargetsRef(target, ref);
  }
  const tableScopedKind = tableScopedCommentKinds.get(ref.kind);
  if (tableScopedKind) {
    return (
      target.kind === tableScopedKind && target.table === ref.table && target.name === ref.name
    );
  }
  return false;
}

function routineCommentTargetsRef(target: CommentTarget, ref: ObjectRef): boolean {
  return (
    target.kind === ref.kind &&
    target.name === ref.name &&
    (target.signature ?? "") === (ref.signature ?? "")
  );
}

export function commentTarget(object: SchemaObject): CommentTarget | undefined {
  const value = object.metadata.commentTarget;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  const kind = Reflect.get(value, "kind");
  const name = Reflect.get(value, "name");
  const schema = optionalStringProperty(value, "schema");
  const signature = optionalStringProperty(value, "signature");
  const table = optionalStringProperty(value, "table");
  if (
    !isCommentTargetKind(kind) ||
    typeof name !== "string" ||
    schema === null ||
    signature === null ||
    table === null
  ) {
    return;
  }
  return {
    kind,
    name,
    ...(schema === undefined ? {} : { schema }),
    ...(signature === undefined ? {} : { signature }),
    ...(table === undefined ? {} : { table }),
  };
}

function isCommentTargetKind(value: unknown): value is CommentTargetKind {
  return typeof value === "string" && commentTargetKinds.has(value);
}

function optionalStringProperty(value: object, key: string): string | null | undefined {
  const property = Reflect.get(value, key);
  return property === undefined || typeof property === "string" ? property : null;
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

export function objectSchema(object: SchemaObject): string {
  if (object.ref.kind === "schema") {
    return object.ref.name;
  }
  const target = commentTarget(object);
  if (target?.kind === "schema") {
    return target.name;
  }
  if (
    (object.ref.kind === "extension" || target?.kind === "extension") &&
    typeof object.metadata.schema === "string"
  ) {
    return object.metadata.schema;
  }
  return object.ref.schema ?? "public";
}
