import { stringArray } from "../catalog/tables.js";
import { grantTargetIdentity } from "../sql/dependents.js";
import type { ObjectKind, SchemaObject } from "../types.js";

const kindPhraseToDefaultObjectType = new Map([
  ["DOMAIN", "TYPES"],
  ["FUNCTION", "FUNCTIONS"],
  ["PROCEDURE", "FUNCTIONS"],
  ["SCHEMA", "SCHEMAS"],
  ["SEQUENCE", "SEQUENCES"],
  ["TABLE", "TABLES"],
  ["TYPE", "TYPES"],
]);

const objectKindToDefaultObjectType = new Map<ObjectKind, string>([
  ["domain", "TYPES"],
  ["enum", "TYPES"],
  ["foreign-table", "TABLES"],
  ["function", "FUNCTIONS"],
  ["materialized-view", "TABLES"],
  ["procedure", "FUNCTIONS"],
  ["schema", "SCHEMAS"],
  ["sequence", "SEQUENCES"],
  ["table", "TABLES"],
  ["type", "TYPES"],
  ["view", "TABLES"],
]);

interface DefaultPrivilegeTransition {
  grantOptionPrivileges: string[];
  ordinal: number;
  privileges: string[];
  sequence: number;
  verb: "GRANT" | "REVOKE";
}

export function suppressDefaultAclImpliedGrants(objects: SchemaObject[]): SchemaObject[] {
  const targetOrdinals = collectTargetOrdinals(objects);
  const defaults = new Map<string, DefaultPrivilegeTransition[]>();
  for (const [sequence, object] of objects.entries()) {
    if (
      object.ref.kind !== "default-privilege" ||
      (object.metadata.verb !== "GRANT" && object.metadata.verb !== "REVOKE") ||
      typeof object.metadata.forRole === "string"
    ) {
      continue;
    }
    const key = [
      String(object.metadata.objectType ?? ""),
      String(object.metadata.schema ?? ""),
      String(object.metadata.grantee ?? ""),
    ].join("|");
    const transitions = defaults.get(key) ?? [];
    transitions.push({
      grantOptionPrivileges: stringArray(object.metadata.grantOptionPrivileges) ?? [],
      ordinal: object.ordinal,
      privileges: stringArray(object.metadata.privileges) ?? [],
      sequence,
      verb: object.metadata.verb,
    });
    defaults.set(key, transitions);
  }
  if (defaults.size === 0) {
    return objects;
  }
  for (const transitions of defaults.values()) {
    transitions.sort(
      (left, right) => left.ordinal - right.ordinal || left.sequence - right.sequence
    );
  }
  return objects.filter((object) => {
    if (object.ref.kind !== "grant" || object.metadata.verb !== "GRANT") {
      return true;
    }
    const objectType = kindPhraseToDefaultObjectType.get(String(object.metadata.kindPhrase ?? ""));
    if (!objectType) {
      return true;
    }
    const transitions = defaults.get(
      [objectType, String(object.ref.schema ?? ""), String(object.metadata.grantee ?? "")].join("|")
    );
    if (!transitions) {
      return true;
    }
    const targetIdentity = object.metadata.targetIdentity;
    if (typeof targetIdentity !== "string") {
      return true;
    }
    const targetOrdinal = singleTargetOrdinal(
      targetOrdinals.get(targetKey(objectType, targetIdentity))
    );
    if (targetOrdinal === undefined) {
      return true;
    }
    const privileges = stringArray(object.metadata.privileges) ?? [];
    const grantOptionPrivileges = stringArray(object.metadata.grantOptionPrivileges) ?? [];
    return !(
      privileges.every((privilege) =>
        privilegeCoveredAtCreation(transitions, privilege, targetOrdinal, false)
      ) &&
      grantOptionPrivileges.every((privilege) =>
        privilegeCoveredAtCreation(transitions, privilege, targetOrdinal, true)
      )
    );
  });
}

function collectTargetOrdinals(objects: SchemaObject[]): Map<string, Set<number>> {
  const ordinals = new Map<string, Set<number>>();
  for (const object of objects) {
    const objectType = objectKindToDefaultObjectType.get(object.ref.kind);
    const identity = grantTargetIdentity(object.ref);
    if (!(objectType && identity)) {
      continue;
    }
    const key = targetKey(objectType, identity);
    const targetOrdinals = ordinals.get(key) ?? new Set<number>();
    targetOrdinals.add(object.ordinal);
    ordinals.set(key, targetOrdinals);
  }
  return ordinals;
}

function targetKey(objectType: string, identity: string): string {
  return `${objectType}|${identity}`;
}

function singleTargetOrdinal(ordinals: Set<number> | undefined): number | undefined {
  if (ordinals?.size !== 1) {
    return;
  }
  return ordinals.values().next().value;
}

function privilegeCoveredAtCreation(
  transitions: DefaultPrivilegeTransition[],
  privilege: string,
  targetOrdinal: number,
  grantOption: boolean
): boolean {
  let covered = false;
  for (const transition of transitions) {
    if (transition.ordinal > targetOrdinal) {
      break;
    }
    if (transition.verb === "GRANT") {
      const granted = grantOption ? transition.grantOptionPrivileges : transition.privileges;
      if (includesPrivilege(granted, privilege)) {
        covered = true;
      }
      continue;
    }
    if (transition.grantOptionPrivileges.length > 0) {
      if (grantOption && includesPrivilege(transition.grantOptionPrivileges, privilege)) {
        covered = false;
      }
      continue;
    }
    if (includesPrivilege(transition.privileges, privilege)) {
      covered = false;
    }
  }
  return covered;
}

function includesPrivilege(privileges: string[], privilege: string): boolean {
  return privileges.includes(privilege) || privileges.includes("ALL");
}
