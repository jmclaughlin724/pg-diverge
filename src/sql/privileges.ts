import type { ObjectRef, SchemaObject } from "../core.js";
import { sha256 } from "../hash.js";
import type { AstNode } from "./ast.js";
import {
  asRecord,
  listItems,
  objectWithArgsIdentity,
  qualifiedName,
  rangeVarName,
  readArray,
  readBoolean,
  readString,
  roleSpecName,
  stringList,
  stringValue,
  typeNameToSql,
} from "./ast.js";
import { formatQualifiedName, normalizeSql, quoteIdent } from "./identifiers.js";
import { makeObject } from "./statements.js";

const grantObjectKinds = new Map([
  ["OBJECT_DATABASE", "DATABASE"],
  ["OBJECT_DOMAIN", "DOMAIN"],
  ["OBJECT_FDW", "FOREIGN DATA WRAPPER"],
  ["OBJECT_FOREIGN_SERVER", "FOREIGN SERVER"],
  ["OBJECT_FUNCTION", "FUNCTION"],
  ["OBJECT_LANGUAGE", "LANGUAGE"],
  ["OBJECT_LARGEOBJECT", "LARGE OBJECT"],
  ["OBJECT_PROCEDURE", "PROCEDURE"],
  ["OBJECT_ROUTINE", "ROUTINE"],
  ["OBJECT_SCHEMA", "SCHEMA"],
  ["OBJECT_SEQUENCE", "SEQUENCE"],
  ["OBJECT_TABLE", "TABLE"],
  ["OBJECT_TABLESPACE", "TABLESPACE"],
  ["OBJECT_TYPE", "TYPE"],
]);

const allInSchemaKinds = new Map([
  ["OBJECT_FUNCTION", "ALL FUNCTIONS IN SCHEMA"],
  ["OBJECT_PROCEDURE", "ALL PROCEDURES IN SCHEMA"],
  ["OBJECT_ROUTINE", "ALL ROUTINES IN SCHEMA"],
  ["OBJECT_SEQUENCE", "ALL SEQUENCES IN SCHEMA"],
  ["OBJECT_TABLE", "ALL TABLES IN SCHEMA"],
]);

const defaultPrivilegeKinds = new Map([
  ["OBJECT_FUNCTION", "FUNCTIONS"],
  ["OBJECT_PROCEDURE", "ROUTINES"],
  ["OBJECT_ROUTINE", "ROUTINES"],
  ["OBJECT_SCHEMA", "SCHEMAS"],
  ["OBJECT_SEQUENCE", "SEQUENCES"],
  ["OBJECT_TABLE", "TABLES"],
  ["OBJECT_TYPE", "TYPES"],
]);

interface GrantTarget {
  identity: string;
  rendered: string;
  schema?: string;
}

const fullPrivilegeSets = new Map<string, string[]>([
  ["DATABASE", ["CONNECT", "CREATE", "TEMPORARY"]],
  ["DOMAIN", ["USAGE"]],
  ["FOREIGN DATA WRAPPER", ["USAGE"]],
  ["FOREIGN SERVER", ["USAGE"]],
  ["FUNCTION", ["EXECUTE"]],
  ["FUNCTIONS", ["EXECUTE"]],
  ["LANGUAGE", ["USAGE"]],
  ["LARGE OBJECT", ["SELECT", "UPDATE"]],
  ["PROCEDURE", ["EXECUTE"]],
  ["ROUTINE", ["EXECUTE"]],
  ["ROUTINES", ["EXECUTE"]],
  ["SCHEMA", ["CREATE", "USAGE"]],
  ["SCHEMAS", ["CREATE", "USAGE"]],
  ["SEQUENCE", ["SELECT", "UPDATE", "USAGE"]],
  ["SEQUENCES", ["SELECT", "UPDATE", "USAGE"]],
  ["TABLE", ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]],
  ["TABLES", ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]],
  ["TABLESPACE", ["CREATE"]],
  ["TYPE", ["USAGE"]],
  ["TYPES", ["USAGE"]],
]);

const builtinPublicDefaults = new Map<string, string[]>([
  ["DOMAIN", ["USAGE"]],
  ["FUNCTION", ["EXECUTE"]],
  ["FUNCTIONS", ["EXECUTE"]],
  ["LANGUAGE", ["USAGE"]],
  ["PROCEDURE", ["EXECUTE"]],
  ["ROUTINE", ["EXECUTE"]],
  ["ROUTINES", ["EXECUTE"]],
  ["TYPE", ["USAGE"]],
  ["TYPES", ["USAGE"]],
]);

export function builtinPublicDefault(kindPhrase: string): string[] | undefined {
  const lookupKey = kindPhrase.startsWith("ALL ")
    ? (kindPhrase.split(" ")[1] ?? kindPhrase)
    : kindPhrase;
  return builtinPublicDefaults.get(lookupKey);
}

export function isBuiltinDefaultGrant(
  kindPhrase: string,
  grantee: string,
  privileges: string[]
): boolean {
  if (grantee !== "PUBLIC") {
    return false;
  }
  const defaults = builtinPublicDefault(kindPhrase);
  if (!defaults) {
    return false;
  }
  const normalized = normalizePrivileges([...privileges].sort(), kindPhrase);
  return (
    normalized.join(",") === "ALL" ||
    normalized.join(",") === defaults.join(",") ||
    normalizePrivileges(defaults, kindPhrase).join(",") === normalized.join(",")
  );
}

function normalizePrivileges(privileges: string[], kindPhrase: string): string[] {
  const lookupKey = kindPhrase.startsWith("ALL ")
    ? (kindPhrase.split(" ")[1] ?? kindPhrase)
    : kindPhrase;
  const fullSet = fullPrivilegeSets.get(lookupKey);
  if (!fullSet) {
    return privileges;
  }
  const granted = new Set(privileges);
  if (granted.has("ALL") || fullSet.every((privilege) => granted.has(privilege))) {
    return ["ALL"];
  }
  return privileges;
}

export interface GrantObjectInput {
  file?: string | undefined;
  grantee: string;
  kindPhrase: string;
  ordinal: number;
  privileges: string[];
  schema?: string | undefined;
  targetIdentity: string;
  targetRendered: string;
  verb: "GRANT" | "REVOKE";
  withGrantOption?: boolean;
}

export function buildGrantObject(input: GrantObjectInput): SchemaObject {
  const keyword = input.verb === "GRANT" ? "TO" : "FROM";
  const suffix = input.withGrantOption ? " WITH GRANT OPTION" : "";
  const privileges = normalizePrivileges(input.privileges, input.kindPhrase);
  const canonicalSql = `${input.verb} ${privileges.join(", ")} ON ${input.kindPhrase} ${input.targetRendered} ${keyword} ${renderRole(input.grantee)}${suffix}`;
  const ref: ObjectRef = {
    kind: "grant",
    name: `${input.verb.toLowerCase()}:${input.kindPhrase.toLowerCase().replaceAll(" ", "-")}:${input.targetIdentity}:${input.grantee}`,
  };
  if (input.schema) {
    ref.schema = input.schema;
  }
  return makeObject(ref, canonicalSql, input.ordinal, input.file, {
    grantee: input.grantee,
    kindPhrase: input.kindPhrase,
    privileges,
    target: input.targetRendered,
    targetIdentity: input.targetIdentity,
    verb: input.verb,
    withGrantOption: input.withGrantOption === true,
  });
}

export interface DefaultPrivilegeObjectInput {
  file?: string | undefined;
  forRole?: string | undefined;
  grantee: string;
  objectType: string;
  ordinal: number;
  privileges: string[];
  schema?: string | undefined;
  verb: "GRANT" | "REVOKE";
}

export function buildDefaultPrivilegeObject(input: DefaultPrivilegeObjectInput): SchemaObject {
  const scope = input.schema ? `in ${input.schema}` : "";
  const privileges = normalizePrivileges(input.privileges, input.objectType);
  const clauses = [
    "ALTER DEFAULT PRIVILEGES",
    input.forRole ? `FOR ROLE ${renderRole(input.forRole)}` : "",
    input.schema ? `IN SCHEMA ${quoteIdent(input.schema)}` : "",
    `${input.verb} ${privileges.join(", ")} ON ${input.objectType}`,
    `${input.verb === "GRANT" ? "TO" : "FROM"} ${renderRole(input.grantee)}`,
  ].filter(Boolean);
  const ref: ObjectRef = {
    kind: "default-privilege",
    name: `${input.verb.toLowerCase()}:${scope || "global"}:${input.objectType.toLowerCase()}:${input.grantee}`,
  };
  if (input.schema) {
    ref.schema = input.schema;
  }
  return makeObject(ref, clauses.join(" "), input.ordinal, input.file, {
    forRole: input.forRole,
    grantee: input.grantee,
    objectType: input.objectType,
    privileges,
    schema: input.schema,
    verb: input.verb,
  });
}

export function grantObjectsFromAst(
  node: AstNode,
  statement: string,
  ordinal: number,
  file?: string
): SchemaObject[] {
  const isGrant = readBoolean(node.is_grant);
  const verb = isGrant ? "GRANT" : "REVOKE";
  const objtype = readString(node.objtype) ?? "OBJECT_TABLE";
  const allInSchema = readString(node.targtype) === "ACL_TARGET_ALL_IN_SCHEMA";
  const kindPhrase = allInSchema ? allInSchemaKinds.get(objtype) : grantObjectKinds.get(objtype);
  const privileges = grantPrivileges(node.privileges);
  const grantees = readArray(node.grantees)
    .map((item) => roleSpecName(item))
    .filter((role): role is string => role !== undefined);
  const targets = readArray(node.objects)
    .map((item) => grantTarget(item, objtype, allInSchema))
    .filter((target): target is GrantTarget => target !== undefined);
  if (!kindPhrase || grantees.length === 0 || targets.length === 0) {
    return [fallbackPrivilegeObject("grant", statement, ordinal, file)];
  }
  const withGrantOption = isGrant && readBoolean(node.grant_option);
  const objects: SchemaObject[] = [];
  for (const target of targets) {
    for (const grantee of grantees) {
      objects.push(
        buildGrantObject({
          file,
          grantee,
          kindPhrase,
          ordinal: ordinal + objects.length,
          privileges,
          schema: target.schema,
          targetIdentity: target.identity,
          targetRendered: target.rendered,
          verb,
          withGrantOption,
        })
      );
    }
  }
  return objects;
}

export function defaultPrivilegesFromAst(
  node: AstNode,
  statement: string,
  ordinal: number,
  file?: string
): SchemaObject[] {
  const action = asRecord(node.action);
  if (!action) {
    return [fallbackPrivilegeObject("default-privilege", statement, ordinal, file)];
  }
  const isGrant = readBoolean(action.is_grant);
  const verb = isGrant ? "GRANT" : "REVOKE";
  const objectType = defaultPrivilegeKinds.get(readString(action.objtype) ?? "OBJECT_TABLE");
  const privileges = grantPrivileges(action.privileges);
  const grantees = readArray(action.grantees)
    .map((item) => roleSpecName(item))
    .filter((role): role is string => role !== undefined);
  const { forRoles, schemas } = defaultPrivilegeScope(node.options);
  if (!objectType || grantees.length === 0) {
    return [fallbackPrivilegeObject("default-privilege", statement, ordinal, file)];
  }
  const roleScopes: (string | undefined)[] = forRoles.length > 0 ? forRoles : [undefined];
  const schemaScopes: (string | undefined)[] = schemas.length > 0 ? schemas : [undefined];
  const objects: SchemaObject[] = [];
  for (const forRole of roleScopes) {
    for (const schema of schemaScopes) {
      for (const grantee of grantees) {
        objects.push(
          buildDefaultPrivilegeObject({
            file,
            forRole,
            grantee,
            objectType,
            ordinal: ordinal + objects.length,
            privileges,
            schema,
            verb,
          })
        );
      }
    }
  }
  return objects;
}

const commentObjectKinds = new Map([
  ["OBJECT_COLUMN", "column"],
  ["OBJECT_DOMAIN", "domain"],
  ["OBJECT_EXTENSION", "extension"],
  ["OBJECT_FOREIGN_TABLE", "foreign table"],
  ["OBJECT_FUNCTION", "function"],
  ["OBJECT_INDEX", "index"],
  ["OBJECT_MATVIEW", "materialized view"],
  ["OBJECT_POLICY", "policy"],
  ["OBJECT_PROCEDURE", "procedure"],
  ["OBJECT_SCHEMA", "schema"],
  ["OBJECT_SEQUENCE", "sequence"],
  ["OBJECT_TABCONSTRAINT", "constraint"],
  ["OBJECT_TABLE", "table"],
  ["OBJECT_TRIGGER", "trigger"],
  ["OBJECT_TYPE", "type"],
  ["OBJECT_VIEW", "view"],
]);

export function isInitdbDefaultComment(
  descriptor: string,
  description: string | null | undefined
): boolean {
  return descriptor === "schema public" && description === "standard public schema";
}

export function commentObjectFromAst(
  node: AstNode,
  statement: string,
  ordinal: number,
  file?: string
): SchemaObject | undefined {
  const objtype = readString(node.objtype);
  const kindWord = objtype ? commentObjectKinds.get(objtype) : undefined;
  if (!kindWord) {
    return;
  }
  const target = commentTarget(node.object, objtype ?? "");
  if (!target) {
    return;
  }
  const descriptor = `${kindWord} ${target.identity}`;
  const ref: ObjectRef = { kind: "comment", name: sha256(descriptor).slice(0, 16) };
  if (target.schema) {
    ref.schema = target.schema;
  }
  return makeObject(ref, statement, ordinal, file, {
    description: readString(node.comment) ?? stringValue(node.comment) ?? null,
    descriptor,
  });
}

function commentTarget(
  object: unknown,
  objtype: string
): { identity: string; schema?: string } | undefined {
  if (objtype === "OBJECT_FUNCTION" || objtype === "OBJECT_PROCEDURE") {
    const identity = objectWithArgsIdentity(object);
    if (!identity) {
      return;
    }
    return {
      identity: `${identity.schema}.${identity.name}(${identity.signature})`,
      schema: identity.schema,
    };
  }
  if (objtype === "OBJECT_TYPE" || objtype === "OBJECT_DOMAIN") {
    const typeNode = asRecord(object);
    const named = qualifiedName(asRecord(typeNode?.TypeName)?.names ?? typeNode?.names);
    if (named) {
      return { identity: `${named.schema}.${named.name}`, schema: named.schema };
    }
    return { identity: normalizeSql(typeNameToSql(object)) };
  }

  const parts = stringList(object);
  if (parts.length === 0) {
    const single = stringValue(object) ?? readString(object);
    return single ? { identity: single } : undefined;
  }
  if (objtype === "OBJECT_SCHEMA") {
    return { identity: parts.join(".") };
  }
  if (parts.length >= 2) {
    return { identity: parts.join("."), schema: parts[0] ?? "" };
  }
  return { identity: `public.${parts[0] ?? ""}`, schema: "public" };
}

function grantPrivileges(value: unknown): string[] {
  const privileges = readArray(value)
    .map((item) => readString(asRecord(asRecord(item)?.AccessPriv)?.priv_name))
    .filter((name): name is string => name !== undefined)
    .map((name) => name.toUpperCase())
    .sort((left, right) => left.localeCompare(right));
  return privileges.length > 0 ? privileges : ["ALL"];
}

function grantTarget(
  value: unknown,
  objtype: string,
  allInSchema: boolean
): GrantTarget | undefined {
  if (allInSchema || objtype === "OBJECT_SCHEMA") {
    const schema = stringValue(value) ?? readString(asRecord(value)?.sval);
    if (!schema) {
      return;
    }
    return { identity: schema, rendered: quoteIdent(schema), schema };
  }
  if (
    objtype === "OBJECT_FUNCTION" ||
    objtype === "OBJECT_PROCEDURE" ||
    objtype === "OBJECT_ROUTINE"
  ) {
    const identity = objectWithArgsIdentity(value);
    if (!identity) {
      return;
    }
    return {
      identity: `${identity.schema}.${identity.name}(${identity.signature})`,
      rendered: `${formatQualifiedName(identity.schema, identity.name)}(${identity.signature})`,
      schema: identity.schema,
    };
  }
  const range = rangeVarName(value);
  if (range) {
    return {
      identity: `${range.schema}.${range.name}`,
      rendered: formatQualifiedName(range.schema, range.name),
      schema: range.schema,
    };
  }
  const named = qualifiedName(value);
  if (named) {
    return {
      identity: `${named.schema}.${named.name}`,
      rendered: formatQualifiedName(named.schema, named.name),
      schema: named.schema,
    };
  }
  return;
}

function defaultPrivilegeScope(options: unknown): { forRoles: string[]; schemas: string[] } {
  const forRoles: string[] = [];
  const schemas: string[] = [];
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    const name = readString(defElem?.defname);
    if (name === "roles") {
      for (const role of listItems(defElem?.arg)) {
        const roleName = roleSpecName(role);
        if (roleName) {
          forRoles.push(roleName);
        }
      }
    }
    if (name === "schemas") {
      for (const schema of stringList(defElem?.arg)) {
        schemas.push(schema.toLowerCase());
      }
    }
  }
  return { forRoles, schemas };
}

function renderRole(role: string): string {
  return role === "PUBLIC" ? "PUBLIC" : quoteIdent(role);
}

function fallbackPrivilegeObject(
  kind: "grant" | "default-privilege",
  statement: string,
  ordinal: number,
  file?: string
): SchemaObject {
  const name = sha256(normalizeSql(statement)).slice(0, 16);
  return makeObject({ kind, name }, statement, ordinal, file);
}
