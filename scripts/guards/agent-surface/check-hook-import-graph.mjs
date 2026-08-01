#!/usr/bin/env node
import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { ROOT } from "../lib/repository.js";
import { forEachNode, parseScript, ts } from "../lib/typescript-ast.js";
import { sessionLifecycleEntrypoints } from "./hook-topology.mjs";

const roots = [".claude/hooks", ".codex/hooks", "scripts/agent-hooks"];
const lifecycleRuntimeFiles = new Set([
  "scripts/agent-hooks/hook-entrypoint.mjs",
  "scripts/agent-hooks/hook-output.mjs",
  "scripts/agent-hooks/session-lifecycle.mjs",
  "scripts/agent-hooks/state.mjs",
]);
const lifecycleBuiltins = new Set(["node:crypto", "node:fs", "node:path", "node:url"]);

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
      node.arguments.length >= 1
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
  const pending = hookFiles(root);
  const visited = new Set();
  const declaredPackages = rootPackageDependencies(root);
  while (pending.length > 0) {
    const file = pending.shift();
    if (file === undefined || visited.has(file)) {
      continue;
    }
    visited.add(file);
    for (const specifier of importSpecifiers(file, root)) {
      if (specifier.startsWith("node:")) {
        assert(isBuiltin(specifier), `${file} imports unknown Node builtin ${specifier}`);
        edges.push({ file, kind: "builtin", specifier });
        continue;
      }
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = relativeDependency(file, specifier, root);
        edges.push({
          file,
          kind: "relative",
          specifier,
          target,
        });
        if ((target.endsWith(".mjs") || target.endsWith(".js")) && !visited.has(target)) {
          pending.push(target);
        }
        continue;
      }
      assert(
        declaredPackages.has(packageName(specifier)),
        `${file} imports undeclared runtime module ${specifier}`
      );
      edges.push({ file, kind: "bare", specifier });
    }
  }
  return edges;
}

function rootPackageDependencies(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function reachableHookDependencies(graph, entrypoint) {
  const adjacency = new Map();
  for (const edge of graph) {
    if (edge.kind !== "relative") {
      continue;
    }
    const targets = adjacency.get(edge.file) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.file, targets);
  }

  const reachable = new Set();
  const visited = new Set([entrypoint]);
  const pending = [entrypoint];
  while (pending.length > 0) {
    const file = pending.shift();
    for (const target of adjacency.get(file) ?? []) {
      if (visited.has(target)) {
        continue;
      }
      visited.add(target);
      reachable.add(target);
      pending.push(target);
    }
  }
  return [...reachable].sort();
}

export function check(root = ROOT) {
  const graph = hookImportGraph(root);
  for (const entrypoint of sessionLifecycleEntrypoints) {
    if (!fs.existsSync(path.join(root, entrypoint))) {
      continue;
    }
    const reachable = reachableHookDependencies(graph, entrypoint);
    const reachableFiles = new Set([entrypoint, ...reachable]);
    const unexpected = [
      ...reachable
        .filter((file) => !lifecycleRuntimeFiles.has(file))
        .map((file) => `relative:${file}`),
      ...graph
        .filter(
          (edge) =>
            edge.kind === "builtin" &&
            reachableFiles.has(edge.file) &&
            !lifecycleBuiltins.has(edge.specifier)
        )
        .map((edge) => `${edge.file} -> ${edge.specifier}`),
    ];
    assert(
      unexpected.length === 0,
      `${entrypoint} reaches non-lifecycle hook runtime:\n${unexpected.join("\n")}`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("HOOK_IMPORT_GRAPH_OK");
}
