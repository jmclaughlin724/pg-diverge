import type { Diagnostic, SchemaObject } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { finalizeObject } from "./sql/facts.js";
import { shapeHash, stripLocations } from "./sql/object-hash.js";
import {
  buildDefaultPrivilegeObject,
  buildGrantObject,
  builtinPublicDefault,
  isBuiltinDefaultGrant,
} from "./sql/privileges.js";
import { makeObject } from "./sql/statements.js";
import { canonicalizeRegclassLiterals } from "./sql/table-shape.js";

export interface SourceNormalizeOptions {
  normalize?: boolean;
}

export async function normalizeSourceObjects(
  objects: SchemaObject[],
  diagnostics: Diagnostic[],
  options: SourceNormalizeOptions = {},
): Promise<SchemaObject[]> {
  const afterDefaults = applyColumnDefaultAmendments(objects, diagnostics);
  const afterOwnedBy = applySequenceOwnedByAmendments(afterDefaults, diagnostics);
  const afterRls = await mergeRlsFacets(afterOwnedBy, options);
  const merged = await mergeSplitPrivileges(afterRls, options);
  return suppressDefaultAclImpliedGrants(suppressDefaultEqualPrivileges(merged));
}

const kindPhraseToDefaultObjectType = new Map([
  ["DOMAIN", "TYPES"],
  ["FUNCTION", "FUNCTIONS"],
  ["PROCEDURE", "FUNCTIONS"],
  ["SCHEMA", "SCHEMAS"],
  ["SEQUENCE", "SEQUENCES"],
  ["TABLE", "TABLES"],
  ["TYPE", "TYPES"],
]);

/**
 * Postgres applies in-model ALTER DEFAULT PRIVILEGES to every later object,
 * and the resulting ACL entry is indistinguishable from an explicit GRANT.
 * A grant fully implied by an in-model default-privilege entry is therefore
 * suppressed on BOTH lanes (catalog models route through this too): trees
 * declare the default once, catalogs materialize it per object.
 */
export function suppressDefaultAclImpliedGrants(objects: SchemaObject[]): SchemaObject[] {
  const defaults = new Map<string, Set<string>>();
  for (const object of objects) {
    if (object.ref.kind !== "default-privilege" || object.metadata.verb !== "GRANT") {
      continue;
    }
    const key = [
      String(object.metadata.objectType ?? ""),
      String(object.metadata.schema ?? ""),
      String(object.metadata.grantee ?? ""),
    ].join("|");
    const privileges = defaults.get(key) ?? new Set<string>();
    for (const privilege of Array.isArray(object.metadata.privileges)
      ? (object.metadata.privileges as string[])
      : []) {
      privileges.add(privilege);
    }
    defaults.set(key, privileges);
  }
  if (defaults.size === 0) {
    return objects;
  }
  return objects.filter((object) => {
    if (object.ref.kind !== "grant" || object.metadata.verb !== "GRANT") {
      return true;
    }
    const objectType = kindPhraseToDefaultObjectType.get(String(object.metadata.kindPhrase ?? ""));
    if (!objectType) {
      return true;
    }
    const implied = defaults.get(
      [objectType, String(object.ref.schema ?? ""), String(object.metadata.grantee ?? "")].join(
        "|",
      ),
    );
    if (!implied) {
      return true;
    }
    const privileges = Array.isArray(object.metadata.privileges)
      ? (object.metadata.privileges as string[])
      : [];
    return !privileges.every((privilege) => implied.has(privilege) || implied.has("ALL"));
  });
}

/**
 * acldefault delta on the source lane, mirroring the catalog lane: a GRANT
 * that restates PostgreSQL's built-in default (PUBLIC EXECUTE on routines,
 * PUBLIC USAGE on types) and a REVOKE aimed at a grantee that holds neither
 * a built-in default nor a granted privilege in this model are semantic
 * no-ops the catalog can never reproduce; keeping them would be permanent
 * false drift.
 */
function suppressDefaultEqualPrivileges(objects: SchemaObject[]): SchemaObject[] {
  const grantsByTarget = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (
      (object.ref.kind === "grant" || object.ref.kind === "default-privilege") &&
      object.metadata.verb === "GRANT"
    ) {
      const key = privilegeTargetKey(object);
      const group = grantsByTarget.get(key) ?? [];
      group.push(object);
      grantsByTarget.set(key, group);
    }
  }
  // Statement order decides the net ACL: a revoke superseded by a later grant
  // vanishes, and a trailing full-coverage revoke nets the pair to nothing.
  // Two passes — netting decisions must complete before any object is kept.
  const nettedAway = new Set<SchemaObject>();
  for (const object of objects) {
    if (
      (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") ||
      object.metadata.verb !== "REVOKE"
    ) {
      continue;
    }
    const meta = object.metadata;
    const kindPhrase =
      typeof meta.kindPhrase === "string"
        ? meta.kindPhrase
        : typeof meta.objectType === "string"
          ? meta.objectType
          : "";
    const grantee = typeof meta.grantee === "string" ? meta.grantee : "";
    if (builtinPublicDefault(kindPhrase) !== undefined && grantee === "PUBLIC") {
      continue;
    }
    const privileges = Array.isArray(meta.privileges) ? (meta.privileges as string[]) : [];
    const counterparts = grantsByTarget.get(privilegeTargetKey(object)) ?? [];
    if (counterparts.length === 0) {
      nettedAway.add(object);
      continue;
    }
    const latestGrant = Math.max(...counterparts.map((item) => item.ordinal));
    if (object.ordinal < latestGrant) {
      nettedAway.add(object);
      continue;
    }
    if (privileges.includes("ALL") || coversAllGrants(privileges, counterparts)) {
      nettedAway.add(object);
      for (const counterpart of counterparts) {
        nettedAway.add(counterpart);
      }
    }
  }
  return objects.filter((object) => {
    if (nettedAway.has(object)) {
      return false;
    }
    if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
      return true;
    }
    const meta = object.metadata;
    const kindPhrase =
      typeof meta.kindPhrase === "string"
        ? meta.kindPhrase
        : typeof meta.objectType === "string"
          ? meta.objectType
          : "";
    const grantee = typeof meta.grantee === "string" ? meta.grantee : "";
    const privileges = Array.isArray(meta.privileges) ? (meta.privileges as string[]) : [];
    if (meta.verb === "GRANT") {
      return !isBuiltinDefaultGrant(kindPhrase, grantee, privileges);
    }
    return true;
  });
}

function coversAllGrants(revoked: string[], grants: SchemaObject[]): boolean {
  const revokedSet = new Set(revoked);
  return grants.every((grant) => {
    const granted = Array.isArray(grant.metadata.privileges)
      ? (grant.metadata.privileges as string[])
      : [];
    return granted.every((privilege) => revokedSet.has(privilege) || privilege === "ALL");
  });
}

function privilegeTargetKey(object: SchemaObject): string {
  const meta = object.metadata;
  return [
    object.ref.kind,
    typeof meta.kindPhrase === "string" ? meta.kindPhrase : String(meta.objectType ?? ""),
    typeof meta.targetIdentity === "string" ? meta.targetIdentity : String(meta.schema ?? ""),
    typeof meta.forRole === "string" ? meta.forRole : "",
    typeof meta.grantee === "string" ? meta.grantee : "",
  ].join("|");
}

type ColumnDefaultAmendment = {
  column: string;
  expression: unknown;
};

function columnDefaultAmendment(object: SchemaObject): ColumnDefaultAmendment | undefined {
  const raw = object.metadata.columnDefaultAmendment;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const column = (raw as Record<string, unknown>).column;
  if (typeof column !== "string" || column.length === 0) {
    return undefined;
  }
  return { column, expression: (raw as Record<string, unknown>).expression ?? null };
}

function applyColumnDefaultAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[],
): SchemaObject[] {
  const markers = objects.filter((object) => columnDefaultAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const tablesByKey = new Map<string, SchemaObject>();
  for (const object of objects) {
    if (object.ref.kind === "table" && columnDefaultAmendment(object) === undefined) {
      tablesByKey.set(object.key, object);
    }
  }
  for (const marker of markers) {
    const amendment = columnDefaultAmendment(marker);
    const table = tablesByKey.get(marker.key);
    const shape = table?.metadata.canonicalShape as
      | { columns?: { default?: unknown; name: string }[] }
      | undefined;
    const column = shape?.columns?.find((item) => item.name === amendment?.column);
    if (!(table && shape && column && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER COLUMN DEFAULT targets a table or column not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql },
        ),
      );
      continue;
    }
    if (amendment.expression === null) {
      delete column.default;
    } else {
      column.default = canonicalizeRegclassLiterals(stripLocations(amendment.expression));
    }
    table.hash = shapeHash(shape as Record<string, unknown>, table.key, table.ref);
    table.sql = `${table.sql};\n${marker.sql}`;
    table.dependencies = mergedDependencies([table, marker]);
  }
  return objects.filter((object) => columnDefaultAmendment(object) === undefined);
}

type SequenceOwnedByAmendment = {
  ownedBy: string | null;
};

function sequenceOwnedByAmendment(object: SchemaObject): SequenceOwnedByAmendment | undefined {
  const raw = object.metadata.sequenceOwnedByAmendment;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const ownedBy = (raw as Record<string, unknown>).ownedBy;
  if (ownedBy !== null && typeof ownedBy !== "string") {
    return undefined;
  }
  return { ownedBy };
}

function applySequenceOwnedByAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[],
): SchemaObject[] {
  const markers = objects.filter((object) => sequenceOwnedByAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const sequencesByKey = new Map<string, SchemaObject>();
  for (const object of objects) {
    if (object.ref.kind === "sequence" && sequenceOwnedByAmendment(object) === undefined) {
      sequencesByKey.set(object.key, object);
    }
  }
  for (const marker of markers) {
    const amendment = sequenceOwnedByAmendment(marker);
    const sequence = sequencesByKey.get(marker.key);
    const shape = sequence?.metadata.canonicalShape as { ownedBy?: string } | undefined;
    if (!(sequence && shape && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER SEQUENCE ... OWNED BY targets a sequence not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql },
        ),
      );
      continue;
    }
    if (amendment.ownedBy === null) {
      delete shape.ownedBy;
    } else {
      shape.ownedBy = amendment.ownedBy;
    }
    sequence.hash = shapeHash(shape as Record<string, unknown>, sequence.key, sequence.ref);
    sequence.sql = `${sequence.sql};\n${marker.sql}`;
    sequence.dependencies = mergedDependencies([sequence, marker]);
  }
  return objects.filter((object) => sequenceOwnedByAmendment(object) === undefined);
}

const rlsSubtypeOrder = new Map([
  ["AT_EnableRowSecurity", 0],
  ["AT_DisableRowSecurity", 1],
  ["AT_ForceRowSecurity", 2],
  ["AT_NoForceRowSecurity", 3],
]);

/**
 * ENABLE and FORCE ROW LEVEL SECURITY are facets of one table's RLS state
 * sharing one identity; the catalog lane emits them as one multi-statement
 * object, so split source statements merge the same way.
 */
async function mergeRlsFacets(
  objects: SchemaObject[],
  options: SourceNormalizeOptions,
): Promise<SchemaObject[]> {
  const groups = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (object.ref.kind !== "rls" || typeof object.metadata.rlsSubtype !== "string") {
      continue;
    }
    const group = groups.get(object.key) ?? [];
    group.push(object);
    groups.set(object.key, group);
  }
  const replacements = new Map<string, SchemaObject>();
  const removed = new Set<SchemaObject>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const ordered = [...group].sort(
      (left, right) =>
        (rlsSubtypeOrder.get(String(left.metadata.rlsSubtype)) ?? 9) -
        (rlsSubtypeOrder.get(String(right.metadata.rlsSubtype)) ?? 9),
    );
    const first = ordered[0];
    if (!first) {
      continue;
    }
    const merged = makeObject(
      first.ref,
      ordered.map((member) => member.sql).join(";\n"),
      first.ordinal,
      first.file,
    );
    merged.dependencies = mergedDependencies(ordered);
    await finalizeObject(merged, { normalize: options.normalize === true });
    replacements.set(key, merged);
    for (const member of group) {
      removed.add(member);
    }
  }
  return replaceMembers(objects, removed, replacements);
}

function replaceMembers(
  objects: SchemaObject[],
  removed: Set<SchemaObject>,
  replacements: Map<string, SchemaObject>,
): SchemaObject[] {
  if (replacements.size === 0) {
    return objects;
  }
  const result: SchemaObject[] = [];
  for (const object of objects) {
    if (!removed.has(object)) {
      result.push(object);
      continue;
    }
    const replacement = replacements.get(object.key);
    if (replacement) {
      result.push(replacement);
      replacements.delete(object.key);
    }
  }
  return result;
}

async function mergeSplitPrivileges(
  objects: SchemaObject[],
  options: SourceNormalizeOptions,
): Promise<SchemaObject[]> {
  const groups = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
      continue;
    }
    const group = groups.get(object.key) ?? [];
    group.push(object);
    groups.set(object.key, group);
  }
  const replacements = new Map<string, SchemaObject>();
  const removed = new Set<SchemaObject>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const merged = await mergePrivilegeGroup(group, options);
    if (!merged) {
      continue;
    }
    replacements.set(key, merged);
    for (const member of group) {
      removed.add(member);
    }
  }
  return replaceMembers(objects, removed, replacements);
}

async function mergePrivilegeGroup(
  group: SchemaObject[],
  options: SourceNormalizeOptions,
): Promise<SchemaObject | undefined> {
  const first = group[0];
  if (!first) {
    return undefined;
  }
  const privileges = unionPrivileges(group);
  if (!privileges) {
    return undefined;
  }
  const meta = first.metadata;
  let merged: SchemaObject | undefined;
  if (first.ref.kind === "grant") {
    const grantOptions = new Set(group.map((item) => item.metadata.withGrantOption === true));
    if (grantOptions.size > 1) {
      return undefined;
    }
    if (
      typeof meta.grantee !== "string" ||
      typeof meta.kindPhrase !== "string" ||
      typeof meta.target !== "string" ||
      typeof meta.targetIdentity !== "string" ||
      (meta.verb !== "GRANT" && meta.verb !== "REVOKE")
    ) {
      return undefined;
    }
    merged = buildGrantObject({
      file: first.file,
      grantee: meta.grantee,
      kindPhrase: meta.kindPhrase,
      ordinal: first.ordinal,
      privileges,
      schema: first.ref.schema,
      targetIdentity: meta.targetIdentity,
      targetRendered: meta.target,
      verb: meta.verb,
      withGrantOption: meta.withGrantOption === true,
    });
  } else {
    if (
      typeof meta.grantee !== "string" ||
      typeof meta.objectType !== "string" ||
      (meta.verb !== "GRANT" && meta.verb !== "REVOKE")
    ) {
      return undefined;
    }
    merged = buildDefaultPrivilegeObject({
      file: first.file,
      forRole: typeof meta.forRole === "string" ? meta.forRole : undefined,
      grantee: meta.grantee,
      objectType: meta.objectType,
      ordinal: first.ordinal,
      privileges,
      schema: typeof meta.schema === "string" ? meta.schema : undefined,
      verb: meta.verb,
    });
  }
  merged.dependencies = mergedDependencies(group);
  await finalizeObject(merged, { normalize: options.normalize === true });
  return merged;
}

function unionPrivileges(group: SchemaObject[]): string[] | undefined {
  const union = new Set<string>();
  for (const member of group) {
    const privileges = member.metadata.privileges;
    if (!Array.isArray(privileges) || privileges.some((item) => typeof item !== "string")) {
      return undefined;
    }
    for (const privilege of privileges as string[]) {
      if (privilege === "ALL") {
        return ["ALL"];
      }
      union.add(privilege);
    }
  }
  return [...union].sort((left, right) => left.localeCompare(right));
}

function mergedDependencies(group: SchemaObject[]): string[] {
  const union = new Set<string>();
  for (const member of group) {
    for (const dependency of member.dependencies) {
      union.add(dependency);
    }
  }
  return [...union].sort((left, right) => left.localeCompare(right));
}
