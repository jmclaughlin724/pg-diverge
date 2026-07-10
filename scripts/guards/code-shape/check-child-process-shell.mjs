#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { exists, ROOT, readText } from "../lib/repository.js";
import { forEachNode, parseScript, ts } from "../lib/typescript-ast.js";

const lifecycleActionRunners = [
  "scripts/install-hooks.mjs",
  "scripts/actions/run-supaschema-action.mjs",
];

function isChildProcessCall(expression) {
  if (ts.isIdentifier(expression)) {
    return ["execFile", "execFileSync", "spawn", "spawnSync"].includes(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return ["execFile", "execFileSync", "spawn", "spawnSync"].includes(expression.name.text);
  }
  return false;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return;
}

function objectHasShellTrue(expression) {
  if (!ts.isObjectLiteralExpression(expression)) {
    return false;
  }
  return expression.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "shell" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

function assertNoShellTrueWithArgs(file, root) {
  const source = parseScript(readText(file, root), file);
  forEachNode(source, (node) => {
    if (!(ts.isCallExpression(node) && isChildProcessCall(node.expression))) {
      return;
    }
    if (node.arguments.length < 3 || !objectHasShellTrue(node.arguments[2])) {
      return;
    }
    assert(
      false,
      `${file} must not pass child_process args with shell: true; use argv arrays with shell: false`
    );
  });
}

export function check(root = ROOT) {
  for (const file of lifecycleActionRunners) {
    if (exists(file, root)) {
      assertNoShellTrueWithArgs(file, root);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("CHILD_PROCESS_SHELL_OK");
}
