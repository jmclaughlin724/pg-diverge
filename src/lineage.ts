import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationPlan } from "./core.js";

export interface MigrationLineage {
  file: string;
  from: string;
  to: string;
}

export const lineagePrefix = "-- supaschema: lineage ";
const headerByteLimit = 4096;

export function lineageLine(plan: MigrationPlan): string {
  return `${lineagePrefix}from=${plan.fromFingerprint} to=${plan.toFingerprint}`;
}

export function parseLineage(content: string): { from: string; to: string } | undefined {
  for (const line of content.split("\n")) {
    if (!line.startsWith(lineagePrefix)) {
      continue;
    }
    const fields = new Map<string, string>();
    for (const token of splitWhitespace(line.slice(lineagePrefix.length).trim())) {
      const separator = token.indexOf("=");
      if (separator > 0) {
        fields.set(token.slice(0, separator), token.slice(separator + 1));
      }
    }
    const from = fields.get("from");
    const to = fields.get("to");
    if (from && to) {
      return { from, to };
    }
  }
  return;
}

function splitWhitespace(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

export async function latestLineage(directory: string): Promise<MigrationLineage | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const name of entries) {
    const path = join(directory, name);
    const content = await readFile(path, "utf8");
    const lineage = parseLineage(content.slice(0, headerByteLimit));
    if (lineage) {
      return { file: path, from: lineage.from, to: lineage.to };
    }
  }
  return;
}
