#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { ROOT } from "../lib/repository.js";
import { forEachNode, parseScript, ts } from "../lib/typescript-ast.js";

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

export function hookFiles(root = ROOT) {
  return roots
    .flatMap((r) =>
      walk(path.join(root, r))
        .filter((file) => file.endsWith(".mjs") || file.endsWith(".js"))
        .map((file) => path.relative(root, file).split(path.sep).join("/"))
    )
    .sort();
}

function importSpecifiers(file, root) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const sourceFile = parseScript(source, file);
  assert(
    sourceFile.parseDiagnostics.length === 0,
    `${file} has JavaScript parse diagnostics and cannot produce a complete hook import graph`
  );
  const specifiers = new Set();
  forEachNode(sourceFile, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const value = literalModuleSpecifier(node.moduleSpecifier);
      if (value !== undefined) {
        specifiers.add(value);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const value = literalModuleSpecifier(node.arguments[0]);
      if (value !== undefined) {
        specifiers.add(value);
      }
    }
  });
  return [...specifiers].sort();
}

function literalModuleSpecifier(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function relativeDependency(file, specifier, root) {
  const target = path.resolve(path.dirname(path.join(root, file)), specifier);
  const relativeTarget = path.relative(root, target);
  assert(
    relativeTarget !== ".." &&
      !relativeTarget.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeTarget),
    `${file} imports outside the repository hook graph: ${specifier}`
  );
  assert(
    fs.existsSync(target) && fs.statSync(target).isFile(),
    `${file} imports missing relative hook dependency ${specifier}`
  );
  return relativeTarget.split(path.sep).join("/");
}

export function hookImportGraph(root = ROOT) {
  const edges = [];
  for (const file of hookFiles(root)) {
    for (const specifier of importSpecifiers(file, root)) {
      if (specifier.startsWith("node:")) {
        edges.push({ file, kind: "builtin", specifier });
        continue;
      }
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        edges.push({
          file,
          kind: "relative",
          specifier,
          target: relativeDependency(file, specifier, root),
        });
        continue;
      }
      assert(allowedBare.has(specifier), `${file} imports non-runtime-safe module ${specifier}`);
      edges.push({ file, kind: "bare", specifier });
    }
  }
  return edges;
}

export function check(root = ROOT) {
  hookImportGraph(root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("HOOK_IMPORT_GRAPH_OK");
}
