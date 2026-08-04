import { createHash } from "node:crypto";
import type { SchemaModel, SchemaObject } from "./types.js";

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

export const MODEL_FORMAT_VERSION = 6;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function fingerprintObjects(objects: SchemaObject[]): string {
  const payload = objects
    .map((object) => ({ hash: object.hash, key: object.key }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return sha256(stableJson(payload));
}

export function fingerprintModel(model: SchemaModel): string {
  return fingerprintObjects(model.objects);
}

function sortJson(value: unknown): JsonLike {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    const sorted: { [key: string]: JsonLike } = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      sorted[key] = sortJson(child);
    }
    return sorted;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  return String(value);
}
