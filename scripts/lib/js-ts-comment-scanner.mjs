import { parse as parseJsTs, ts } from "../guards/lib/typescript-ast.js";

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
