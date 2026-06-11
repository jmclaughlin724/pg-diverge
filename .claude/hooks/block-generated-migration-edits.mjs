#!/usr/bin/env node
import { readFileSync } from "node:fs";

const lineageMarker = "-- pg-diverge: lineage ";
const editTools = new Set(["Edit", "MultiEdit", "Write"]);

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const filePath =
    typeof payload?.tool_input?.file_path === "string" ? payload.tool_input.file_path : "";
  if (!editTools.has(toolName) || !filePath.endsWith(".sql")) {
    process.exit(0);
  }
  let existing = "";
  try {
    existing = readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }
  if (!existing.includes(lineageMarker)) {
    process.exit(0);
  }
  process.stderr.write(
    `${filePath} is a pg-diverge-generated migration (lineage marker present). ` +
      "Do not hand-edit it: change the declarative schema tree, delete this file if it is stale, " +
      "and regenerate with `pg-diverge diff`. See .claude/rules/pg-diverge.md.\n",
  );
  process.exit(2);
} catch {
  process.exit(0);
}
