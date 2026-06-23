import type { SchemaObject } from "../core.js";
import { stringArray } from "../core.js";

const kindPhraseToDefaultObjectType = new Map([
  ["DOMAIN", "TYPES"],
  ["FUNCTION", "FUNCTIONS"],
  ["PROCEDURE", "FUNCTIONS"],
  ["SCHEMA", "SCHEMAS"],
  ["SEQUENCE", "SEQUENCES"],
  ["TABLE", "TABLES"],
  ["TYPE", "TYPES"],
]);

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
    for (const privilege of stringArray(object.metadata.privileges) ?? []) {
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
      [objectType, String(object.ref.schema ?? ""), String(object.metadata.grantee ?? "")].join("|")
    );
    if (!implied) {
      return true;
    }
    const privileges = stringArray(object.metadata.privileges) ?? [];
    return !privileges.every((privilege) => implied.has(privilege) || implied.has("ALL"));
  });
}
