#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, ROOT } from "../lib/guard-utils.js";

const roots = [".claude/hooks", ".codex/hooks", "scripts/agent-hooks"];
const allowedBare = new Set([]);

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(file));
    } else if (entry.isFile()) {
      out.push(file);
    }
  }
  return out;
}

function hookFiles(root) {
  return roots.flatMap((r) =>
    walk(path.join(root, r))
      .filter((file) => file.endsWith(".mjs") || file.endsWith(".js"))
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
  );
}

function importSpecifiers(file, root) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const out = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ")) {
      const fromIndex = trimmed.indexOf(" from ");
      const raw = fromIndex === -1 ? trimmed.slice("import ".length) : trimmed.slice(fromIndex + 6);
      let quote = "";
      if (raw.includes('"')) {
        quote = '"';
      } else if (raw.includes("'")) {
        quote = "'";
      }
      if (!quote) {
        continue;
      }
      const start = raw.indexOf(quote);
      const end = raw.indexOf(quote, start + 1);
      if (start !== -1 && end !== -1) {
        out.push(raw.slice(start + 1, end));
      }
    }
  }
  return out;
}

export function check(root = ROOT) {
  for (const file of hookFiles(root)) {
    for (const specifier of importSpecifiers(file, root)) {
      const allowed =
        specifier.startsWith("node:") ||
        specifier.startsWith("./") ||
        specifier.startsWith("../") ||
        allowedBare.has(specifier);
      assert(allowed, `${file} imports non-runtime-safe module ${specifier}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("HOOK_IMPORT_GRAPH_OK");
}
