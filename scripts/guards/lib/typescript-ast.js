import typescript from "typescript-compiler-api";

export const ts = typescript;

export function parse(text, { fileName = "inline.ts", scriptKind } = {}) {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind ?? scriptKindForFile(fileName)
  );
}

export function parseScript(text, name = "inline.mjs") {
  return parse(text, { fileName: name });
}

export function forEachNode(sourceFile, callback) {
  function visit(node) {
    callback(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function scriptKindForFile(fileName) {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (fileName.endsWith(".json")) {
    return ts.ScriptKind.JSON;
  }
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
