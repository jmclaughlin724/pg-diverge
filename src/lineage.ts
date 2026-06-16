import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationPlan } from "./core.js";

export interface MigrationLineage {
  file: string;
  from: string;
  to: string;
}

const lineagePrefix = "-- supaschema: lineage ";
const headerByteLimit = 4096;
const whitespacePattern = /\s+/;

export function lineageLine(plan: MigrationPlan): string {
  return `${lineagePrefix}from=${plan.fromFingerprint} to=${plan.toFingerprint}`;
}

/**
 * Parses the machine-readable lineage marker supaschema embeds in every
 * rendered migration header. Hand-authored migrations have no marker and are
 * invisible to the chain gate by design.
 */
export function parseLineage(content: string): { from: string; to: string } | undefined {
  for (const line of content.split("\n")) {
    if (!line.startsWith(lineagePrefix)) {
      continue;
    }
    const fields = new Map<string, string>();
    for (const token of line.slice(lineagePrefix.length).trim().split(whitespacePattern)) {
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

/**
 * Finds the newest supaschema-generated migration in a directory by filename
 * order (timestamped names sort chronologically). Returns undefined when no
 * lineage-bearing migration exists, which disables the chain gate.
 */
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
