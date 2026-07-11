import { asRecord, readArray, readString, stringList } from "./ast.js";

export function sequenceOwnedByOption(options: unknown): string | null | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "owned_by") {
      continue;
    }
    const parts = stringList(defElem?.arg);
    if (parts.length === 0) {
      return;
    }
    return parts.at(-1) === "none" ? null : parts.join(".");
  }
}

export function extensionSchemaOption(options: unknown): string | undefined {
  for (const item of readArray(options)) {
    const defElem = asRecord(asRecord(item)?.DefElem);
    if (readString(defElem?.defname) !== "schema") {
      continue;
    }
    const value = readString(asRecord(asRecord(defElem?.arg)?.String)?.sval);
    if (value) {
      return value;
    }
  }
}
