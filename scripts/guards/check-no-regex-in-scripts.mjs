#!/usr/bin/env node
import { forEachNode, parse, ts } from "./lib/ast-utils.js";
import { assert, ok, readText } from "./lib/guard-utils.js";

const guarded = [
  "scripts/code-atlas/build.mjs",
  "scripts/code-atlas/query.mjs",
  "scripts/guards/lib/ast-utils.js",
  "scripts/guards/lib/sql-ast.js",
];

for (const file of guarded) {
  const source = parse(readText(file), { fileName: file });
  forEachNode(source, (node) => {
    assert(
      node.kind !== ts.SyntaxKind.RegularExpressionLiteral,
      `${file} contains a regex literal; atlas structure must use AST/model helpers`
    );
  });
}

ok("NO_REGEX_IN_SCRIPTS_OK");
