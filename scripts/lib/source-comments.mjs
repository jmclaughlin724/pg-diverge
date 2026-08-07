import path from "node:path";
import { parse as parseJsTs, ts } from "../guards/lib/typescript-ast.js";

const codeRoots = [
  ".agents/skills/",
  ".claude/hooks/",
  ".claude/skills/",
  "benchmarks/",
  "bin/",
  "scripts/",
  "services/",
  "src/",
  "tests/",
];
const codeRootFiles = ["prettier.config.mjs", "vitest.config.ts"];
export const jsTsExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
export const pythonExtensions = new Set([".py"]);
export const shellExtensions = new Set([".bash", ".sh", ".zsh"]);
const codeExtensions = new Set([...jsTsExtensions, ...pythonExtensions, ...shellExtensions]);

export function isCodeFile(file) {
  return (
    (codeRoots.some((root) => file.startsWith(root)) || codeRootFiles.includes(file)) &&
    codeExtensions.has(path.extname(file)) &&
    !file.endsWith(".d.ts")
  );
}

export function isJsTsCodeFile(file) {
  return isCodeFile(file) && jsTsExtensions.has(path.extname(file));
}

export function jsTsComments(fileName, text) {
  const source = parseJsTs(text, { fileName });
  const ranges = new Map();
  collectJsTsCommentRanges(source, text, ranges);
  return [...ranges.values()]
    .sort((left, right) => left.pos - right.pos)
    .map((range) => {
      const location = source.getLineAndCharacterOfPosition(range.pos);
      return {
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block",
        line: location.line + 1,
        character: location.character + 1,
        text: text.slice(range.pos, range.end),
      };
    });
}

function collectJsTsCommentRanges(node, text, ranges) {
  for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
    addJsTsCommentRange(range, text, ranges);
  }
  for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
    addJsTsCommentRange(range, text, ranges);
  }
  ts.forEachChild(node, (child) => collectJsTsCommentRanges(child, text, ranges));
}

function addJsTsCommentRange(range, text, ranges) {
  if (range.pos === 0 && text.startsWith("#!")) {
    return;
  }
  ranges.set(`${range.pos}:${range.end}`, range);
}
