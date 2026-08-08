import { sha256, stableJson } from "../hash.js";
import type { ObjectRef } from "../types.js";

const strippedKeys = new Set([
  "if_not_exists",
  "list_end",
  "list_start",
  "location",
  "replace",
  "rexpr_list_end",
  "rexpr_list_start",
  "stmt_len",
  "stmt_location",
]);

export function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLocations);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (strippedKeys.has(key)) {
        continue;
      }
      result[key] = stripLocations(child);
    }
    return result;
  }
  return value;
}

export function astObjectHash(statementNodes: unknown[], key: string, ref: ObjectRef): string {
  return shapeHash(stripLocations(statementNodes), key, ref);
}

export function shapeHash(shape: unknown, key: string, ref: ObjectRef): string {
  return sha256(stableJson({ ast: shape, key, ref }));
}
