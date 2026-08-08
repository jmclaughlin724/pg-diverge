import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let loadedTypescript;

function loadTypescript() {
  if (loadedTypescript === undefined) {
    loadedTypescript = require("typescript");
  }
  return loadedTypescript;
}

export const ts = new Proxy(
  {},
  {
    get(_target, property) {
      return loadTypescript()[property];
    },
  }
);

export function parse(text, { fileName = "inline.ts", scriptKind } = {}) {
  const tsApi = loadTypescript();
  return tsApi.createSourceFile(
    fileName,
    text,
    tsApi.ScriptTarget.Latest,
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
    loadTypescript().forEachChild(node, visit);
  }
  visit(sourceFile);
}

function scriptKindForFile(fileName) {
  const tsApi = loadTypescript();
  if (fileName.endsWith(".tsx")) {
    return tsApi.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return tsApi.ScriptKind.JSX;
  }
  if (fileName.endsWith(".json")) {
    return tsApi.ScriptKind.JSON;
  }
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) {
    return tsApi.ScriptKind.JS;
  }
  return tsApi.ScriptKind.TS;
}
