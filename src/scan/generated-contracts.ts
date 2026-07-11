import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript-compiler-api";
import type { Diagnostic, SupaschemaConfig } from "../core.js";
import { diagnostic } from "../diagnostics.js";

interface GeneratedContractUsageScanOptions {
  config: SupaschemaConfig;
  cwd?: string;
  root: string;
}

interface GeneratedImportState {
  diagnostics: Diagnostic[];
  importsGeneratedContracts: boolean;
  runtimeRoots: Set<string>;
}

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const skipDirectories = new Set([
  ".git",
  ".supaschema",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
]);

export async function scanGeneratedContractUsage(
  options: GeneratedContractUsageScanOptions
): Promise<Diagnostic[]> {
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, options.root);
  const generatedTargets = generatedContractTargets(cwd, options.config);
  const files = await sourceFiles(root, generatedTargets);
  const diagnostics = await Promise.all(
    files.map((file) => scanGeneratedContractUsageFile(file, cwd, generatedTargets))
  );
  return diagnostics.flat();
}

async function scanGeneratedContractUsageFile(
  file: string,
  cwd: string,
  generatedTargets: Set<string>
): Promise<Diagnostic[]> {
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(file)
  );
  const imports = collectGeneratedImports(sourceFile, text, file, generatedTargets);
  if (!imports.importsGeneratedContracts) {
    return [];
  }
  const diagnostics = [...imports.diagnostics];
  collectUsageDiagnostics(sourceFile, text, file, imports.runtimeRoots, diagnostics);
  return diagnostics.map((item) => withRelativeFile(item, cwd));
}

function collectGeneratedImports(
  sourceFile: ts.SourceFile,
  text: string,
  file: string,
  generatedTargets: Set<string>
): GeneratedImportState {
  const diagnostics: Diagnostic[] = [];
  const runtimeRoots = new Set<string>();
  let importsGeneratedContracts = false;
  for (const statement of sourceFile.statements) {
    if (
      !(
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        isGeneratedContractImport(statement.moduleSpecifier.text, file, generatedTargets)
      )
    ) {
      continue;
    }
    importsGeneratedContracts = true;
    const clause = statement.importClause;
    if (clause === undefined) {
      continue;
    }
    const namedBindings = clause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
      continue;
    }
    for (const specifier of namedBindings.elements) {
      const renamed = specifier.propertyName !== undefined;
      if (renamed) {
        diagnostics.push(
          scanDiagnostic(
            "SUPA_SCAN_CONTRACT_IMPORT_RENAME",
            text,
            file,
            specifier.name.getStart(sourceFile),
            "Generated contract imports must keep their exported names."
          )
        );
      }
      if (!(clause.isTypeOnly || specifier.isTypeOnly)) {
        runtimeRoots.add(specifier.name.text);
      }
    }
  }
  return { diagnostics, importsGeneratedContracts, runtimeRoots };
}

function collectUsageDiagnostics(
  sourceFile: ts.SourceFile,
  text: string,
  file: string,
  runtimeRoots: Set<string>,
  diagnostics: Diagnostic[]
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      return;
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      diagnostics.push(
        scanDiagnostic(
          "SUPA_SCAN_CONTRACT_ASSERTION",
          text,
          file,
          node.getStart(sourceFile),
          "TypeScript assertions in files importing generated contracts bypass the generated contract boundary."
        )
      );
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "overrideTypes" || node.name.text === "returns")
    ) {
      diagnostics.push(
        scanDiagnostic(
          node.name.text === "overrideTypes"
            ? "SUPA_SCAN_CONTRACT_OVERRIDE_TYPES"
            : "SUPA_SCAN_CONTRACT_RETURNS",
          text,
          file,
          node.name.getStart(sourceFile),
          `${node.name.text}() overrides generated query response contracts.`
        )
      );
    }
    if (
      runtimeRoots.size > 0 &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      rootIdentifier(node.initializer) !== undefined &&
      runtimeRoots.has(rootIdentifier(node.initializer) ?? "")
    ) {
      diagnostics.push(
        scanDiagnostic(
          "SUPA_SCAN_CONTRACT_RUNTIME_COPY",
          text,
          file,
          node.name.getStart(sourceFile),
          "Local constants initialized from generated runtime roots copy the generated contract."
        )
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  let cursor = expression;
  while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
    cursor = cursor.expression;
  }
  return ts.isIdentifier(cursor) ? cursor.text : undefined;
}

function generatedContractTargets(cwd: string, config: SupaschemaConfig): Set<string> {
  return new Set(
    [config.typesFile, config.zodFile].flatMap((file) => {
      const absolute = resolve(cwd, file);
      const base = basename(file);
      return [
        normalizePath(absolute),
        normalizePath(stripKnownExtension(absolute)),
        normalizePath(base),
        normalizePath(stripKnownExtension(base)),
      ];
    })
  );
}

function sourceFiles(root: string, generatedTargets: Set<string>): Promise<string[]> {
  async function walk(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const batches: Array<Promise<string[]> | string[]> = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) {
          batches.push(walk(path));
        }
        continue;
      }
      if (
        entry.isFile() &&
        sourceExtensions.has(extname(entry.name)) &&
        !generatedTargets.has(normalizePath(path)) &&
        !generatedTargets.has(normalizePath(stripKnownExtension(path)))
      ) {
        batches.push([path]);
      }
    }
    return (await Promise.all(batches)).flat();
  }
  return walk(root);
}

function isGeneratedContractImport(
  specifier: string,
  importer: string,
  generatedTargets: Set<string>
): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const resolved = resolve(dirname(importer), specifier);
    return (
      generatedTargets.has(normalizePath(resolved)) ||
      generatedTargets.has(normalizePath(stripKnownExtension(resolved)))
    );
  }
  const name = basename(specifier);
  return (
    generatedTargets.has(normalizePath(name)) ||
    generatedTargets.has(normalizePath(stripKnownExtension(name)))
  );
}

function scanDiagnostic(
  code: string,
  text: string,
  file: string,
  position: number,
  message: string
): Diagnostic {
  const location = lineAndCharacter(text, position);
  return diagnostic(
    code,
    "warning",
    `${message} (${location.line + 1}:${location.character + 1})`,
    {
      file,
    }
  );
}

function withRelativeFile(item: Diagnostic, cwd: string): Diagnostic {
  if (item.file === undefined) {
    return item;
  }
  return {
    ...item,
    file: normalizePath(relative(cwd, item.file)),
  };
}

function stripKnownExtension(path: string): string {
  const extension = extname(path);
  return sourceExtensions.has(extension) || extension === ".js" || extension === ".jsx"
    ? path.slice(0, -extension.length)
    : path;
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function scriptKindForFile(file: string): ts.ScriptKind {
  const extension = extname(file);
  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  return extension === ".cts" || extension === ".mts" || extension === ".ts"
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
}

function lineAndCharacter(text: string, position: number): { character: number; line: number } {
  const bounded = Math.max(0, Math.min(position, text.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < bounded; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { character: bounded - lineStart, line };
}
