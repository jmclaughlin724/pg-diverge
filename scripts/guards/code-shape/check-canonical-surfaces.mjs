#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { exists, gitFiles, ROOT, readJson } from "../lib/repository.js";
import { changeDisciplineViolations } from "./check-change-discipline.mjs";
import { packageScriptViolations } from "./check-package-scripts.mjs";
import { patternEngineViolations } from "./check-pattern-engine.mjs";

const codeRoots = [
  ".agents/skills/",
  ".claude/hooks/",
  ".claude/skills/",
  "benchmarks/",
  "bin/",
  "cloudflare/",
  "scripts/",
  "services/",
  "src/",
  "tests/",
];
const codeRootFiles = ["prettier.config.mjs", "vitest.config.ts"];
const jsTsExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const pythonExtensions = new Set([".py"]);
const shellExtensions = new Set([".bash", ".sh", ".zsh"]);
const codeExtensions = new Set([...jsTsExtensions, ...pythonExtensions, ...shellExtensions]);

export async function check(root = ROOT) {
  const packageJson = readJson("package.json", root);
  const files = gitFiles(root).filter((file) => exists(file, root));
  const codeFiles = files.filter(isSourceCodeFile);
  const jsTsFiles = codeFiles.filter((file) => jsTsExtensions.has(path.extname(file)));
  const pythonFiles = codeFiles.filter((file) => pythonExtensions.has(path.extname(file)));
  const shellFiles = codeFiles.filter((file) => shellExtensions.has(path.extname(file)));
  const violations = [
    ...(await changeDisciplineViolations(codeFiles, jsTsFiles, pythonFiles, shellFiles, root)),
    ...(await patternEngineViolations(jsTsFiles, pythonFiles, shellFiles, root)),
    ...packageScriptViolations(packageJson.scripts ?? {}),
  ];

  assert(
    violations.length === 0,
    `canonical surfaces guard failed:\n${violations.map((item) => `- ${item}`).join("\n")}`
  );
}

function isSourceCodeFile(file) {
  return (
    (codeRoots.some((root) => file.startsWith(root)) || codeRootFiles.includes(file)) &&
    codeExtensions.has(path.extname(file)) &&
    !file.endsWith(".d.ts")
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check().then(() => ok("CANONICAL_SURFACES_OK"));
}
