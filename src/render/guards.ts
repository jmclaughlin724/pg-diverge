import { formatQualifiedName, quoteIdent } from "../sql/identifiers.js";
import {
  builtinPublicDefault,
  mergePrivilegeMetadata,
  type PrivilegeMetadata,
  renderPrivilegeList,
} from "../sql/privileges.js";
import type { MigrationOperation, ObjectRef, SchemaObject } from "../types.js";

export function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function qualifiedRef(ref: ObjectRef): string {
  return formatQualifiedName(ref.schema, ref.name);
}

export function qualifiedTableRef(ref: ObjectRef): string {
  return formatQualifiedName(ref.schema, ref.table ?? ref.name);
}

export function renderRename(operation: MigrationOperation): string {
  const before = requiredBefore(operation);
  const after = requiredAfter(operation);
  const oldExists = existsExpression(before);
  const newExists = existsExpression(after);
  const renameSql = renderRenameStatement(before.ref, after.ref);
  const conflict = quoteLiteral(
    `supaschema rename conflict: both ${before.key} and ${after.key} exist`
  );
  return `DO $supaschema$
BEGIN
  IF ${oldExists} AND ${newExists} THEN
    RAISE EXCEPTION ${conflict};
  ELSIF ${oldExists} THEN
    ${renameSql}
  END IF;
END
$supaschema$;`;
}

function renderRenameStatement(before: ObjectRef, after: ObjectRef): string {
  switch (after.kind) {
    case "schema":
      return `ALTER SCHEMA ${quoteIdent(before.name)} RENAME TO ${quoteIdent(after.name)};`;
    case "table":
      return `ALTER TABLE ${qualifiedRef(before)} RENAME TO ${quoteIdent(after.name)};`;
    case "sequence":
      return `ALTER SEQUENCE ${qualifiedRef(before)} RENAME TO ${quoteIdent(after.name)};`;
    case "index":
      return `ALTER INDEX ${qualifiedRef(before)} RENAME TO ${quoteIdent(after.name)};`;
    case "view":
      return `ALTER VIEW ${qualifiedRef(before)} RENAME TO ${quoteIdent(after.name)};`;
    case "materialized-view":
      return `ALTER MATERIALIZED VIEW ${qualifiedRef(before)} RENAME TO ${quoteIdent(after.name)};`;
    case "function":
      return `ALTER FUNCTION ${qualifiedRef(before)}(${before.signature ?? ""}) RENAME TO ${quoteIdent(after.name)};`;
    case "procedure":
      return `ALTER PROCEDURE ${qualifiedRef(before)}(${before.signature ?? ""}) RENAME TO ${quoteIdent(after.name)};`;
    default:
      throw new Error(`unsupported rename operation for ${after.kind}`);
  }
}

function existsExpression(object: SchemaObject): string {
  const ref = object.ref;
  if (ref.kind === "schema") {
    return `EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${quoteLiteral(ref.name)})`;
  }
  if (ref.kind === "function" || ref.kind === "procedure") {
    return `pg_catalog.to_regprocedure(${quoteLiteral(`${qualifiedRef(ref)}(${ref.signature ?? ""})`)}) IS NOT NULL`;
  }
  return `pg_catalog.to_regclass(${quoteLiteral(qualifiedRef(ref))}) IS NOT NULL`;
}

export function renderTypeGuard(object: SchemaObject): string {
  const schema = object.ref.schema ?? "public";
  const name = object.ref.name;
  const catalogCheck = `SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = ${quoteLiteral(schema)} AND t.typname = ${quoteLiteral(name)}`;
  return `DO $supaschema$
BEGIN
  IF NOT EXISTS (${catalogCheck}) THEN
    ${ensureSemicolon(object.sql)}
  END IF;
END
$supaschema$;`;
}

export function renderFdwGuard(object: SchemaObject): string {
  const catalogCheck = `SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper WHERE fdwname = ${quoteLiteral(object.ref.name)}`;
  return `DO $supaschema$
BEGIN
  IF NOT EXISTS (${catalogCheck}) THEN
    ${ensureSemicolon(object.sql)}
  END IF;
END
$supaschema$;`;
}

export function renderConstraintGuard(object: SchemaObject): string {
  const schema = object.ref.schema ?? "public";
  const table = object.ref.table ?? object.ref.name;
  return renderConstraintSqlGuard(schema, table, object.ref.name, object.sql);
}

export function renderConstraintSqlGuard(
  schema: string,
  table: string,
  name: string,
  sql: string
): string {
  return `DO $supaschema$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = ${quoteLiteral(schema)}
      AND r.relname = ${quoteLiteral(table)}
      AND c.conname = ${quoteLiteral(name)}
  ) THEN
    ${ensureSemicolon(sql)}
  END IF;
END
$supaschema$;`;
}

interface GrantRenderMetadata extends PrivilegeMetadata {
  grantee: string;
  kindPhrase: string;
  target: string;
  verb: "GRANT" | "REVOKE";
}

export function renderGrantCreate(object: SchemaObject): string {
  const metadata = grantRenderMetadata(object);
  if (!metadata) {
    return ensureSemicolon(object.sql);
  }
  const keyword = metadata.verb === "GRANT" ? "TO" : "FROM";
  const suffix = metadata.verb === "GRANT" && metadata.withGrantOption ? " WITH GRANT OPTION" : "";
  return `${metadata.verb} ${renderPrivilegeList(metadata.privileges, metadata.columnPrivileges)} ON ${metadata.kindPhrase} ${metadata.target} ${keyword} ${renderRole(metadata.grantee)}${suffix};`;
}

export function renderGrantDrop(object: SchemaObject): string {
  const metadata = grantRenderMetadata(object);
  if (!metadata) {
    return `-- Manual privilege removal required for ${object.key}`;
  }
  const direction = metadata.verb === "GRANT" ? "REVOKE" : "GRANT";
  const reversePrivileges = renderReverseGrantPrivileges(metadata);
  if (!reversePrivileges) {
    return manualPrivilegeDropComment(object);
  }
  const keyword = direction === "GRANT" ? "TO" : "FROM";
  return `${direction} ${reversePrivileges} ON ${metadata.kindPhrase} ${metadata.target} ${keyword} ${renderRole(metadata.grantee)};`;
}

function grantRenderMetadata(object: SchemaObject): GrantRenderMetadata | undefined {
  const verb = object.metadata.verb;
  const kindPhrase = object.metadata.kindPhrase;
  const target = object.metadata.target;
  const grantee = object.metadata.grantee;
  if (
    (verb !== "GRANT" && verb !== "REVOKE") ||
    typeof kindPhrase !== "string" ||
    typeof target !== "string" ||
    typeof grantee !== "string"
  ) {
    return;
  }
  const privilegeMetadata = mergePrivilegeMetadata([
    {
      columnPrivileges: object.metadata.columnPrivileges,
      privileges: object.metadata.privileges,
      withGrantOption: object.metadata.withGrantOption === true,
    },
  ]);
  if (!privilegeMetadata) {
    return;
  }
  return { ...privilegeMetadata, grantee, kindPhrase, target, verb };
}

export function renderDefaultPrivilegeDrop(object: SchemaObject): string {
  const verb = object.metadata.verb;
  const privileges = object.metadata.privileges;
  const objectType = object.metadata.objectType;
  const grantee = object.metadata.grantee;
  if (
    (verb !== "GRANT" && verb !== "REVOKE") ||
    !Array.isArray(privileges) ||
    typeof objectType !== "string" ||
    typeof grantee !== "string"
  ) {
    return `-- Manual privilege removal required for ${object.key}`;
  }
  const forRole = typeof object.metadata.forRole === "string" ? object.metadata.forRole : undefined;
  const schema = typeof object.metadata.schema === "string" ? object.metadata.schema : undefined;
  const direction = verb === "GRANT" ? "REVOKE" : "GRANT";
  const reversePrivileges = renderReversePrivileges(privileges, objectType, grantee);
  if (!reversePrivileges) {
    return manualPrivilegeDropComment(object);
  }
  const keyword = direction === "GRANT" ? "TO" : "FROM";
  const clauses = [
    "ALTER DEFAULT PRIVILEGES",
    forRole ? `FOR ROLE ${quoteIdent(forRole)}` : "",
    schema ? `IN SCHEMA ${quoteIdent(schema)}` : "",
    `${direction} ${reversePrivileges} ON ${objectType} ${keyword} ${renderRole(grantee)}`,
  ].filter(Boolean);
  return `${clauses.join(" ")};`;
}

function renderReversePrivileges(
  privileges: unknown[],
  kindPhrase: string,
  grantee: string
): string | undefined {
  if (grantee === "PUBLIC" && privileges.map(String).includes("ALL")) {
    return builtinPublicDefault(kindPhrase)?.join(", ");
  }
  return privileges.map(String).join(", ");
}

function renderReverseGrantPrivileges(metadata: GrantRenderMetadata): string | undefined {
  if (
    metadata.grantee === "PUBLIC" &&
    metadata.columnPrivileges === undefined &&
    metadata.privileges.includes("ALL")
  ) {
    return builtinPublicDefault(metadata.kindPhrase)?.join(", ");
  }
  return renderPrivilegeList(metadata.privileges, metadata.columnPrivileges);
}

function manualPrivilegeDropComment(object: SchemaObject): string {
  return `-- Manual privilege reversal required for ${object.key}`;
}

function renderRole(role: string): string {
  return role === "PUBLIC" ? "PUBLIC" : quoteIdent(role);
}

function requiredBefore(operation: MigrationOperation): SchemaObject {
  if (!operation.before) {
    throw new Error(`operation ${operation.key} has no before object`);
  }
  return operation.before;
}

function requiredAfter(operation: MigrationOperation): SchemaObject {
  if (!operation.after) {
    throw new Error(`operation ${operation.key} has no after object`);
  }
  return operation.after;
}
