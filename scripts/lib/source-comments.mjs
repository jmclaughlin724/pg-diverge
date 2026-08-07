import path from "node:path";

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

let scannerPromise;

function loadScanner() {
  if (!scannerPromise) {
    scannerPromise = import("./js-ts-comment-scanner.mjs");
  }
  return scannerPromise;
}

export async function jsTsComments(fileName, text) {
  const { jsTsComments: scan } = await loadScanner();
  return scan(fileName, text);
}
