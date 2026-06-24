import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type {
  Expression,
  ImportDeclaration,
  ImportSpecifier,
  Node,
  SourceFile,
  StringLiteral,
  Diagnostic as TypeScriptDiagnostic,
} from "typescript";
import {
  createSourceFile,
  flattenDiagnosticMessageText,
  forEachChild,
  isAsExpression,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
  isTypeAssertionExpression,
  isVariableDeclaration,
  ScriptKind,
  ScriptTarget,
} from "typescript";
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

type GeneratedImportDeclaration = ImportDeclaration & { moduleSpecifier: StringLiteral };

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const skipDirectories = new Set([
  ".git",
  ".supaschema",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
]);
const runtimeExportRoots = new Set([
  "CompositeTypes",
  "Constants",
  "Enums",
  "Tables",
  "TablesInsert",
  "TablesUpdate",
  "jsonSchema",
]);

export async function scanGeneratedContractUsage(
  options: GeneratedContractUsageScanOptions
): Promise<Diagnostic[]> {
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, options.root);
  const generatedTargets = generatedContractTargets(cwd, options.config);
  const files = await sourceFiles(root, generatedTargets);
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    diagnostics.push(...(await scanGeneratedContractUsageFile(file, cwd, generatedTargets)));
  }
  return diagnostics;
}

async function scanGeneratedContractUsageFile(
  file: string,
  cwd: string,
  generatedTargets: Set<string>
): Promise<Diagnostic[]> {
  const text = await readFile(file, "utf8");
  const source = createSourceFile(file, text, ScriptTarget.Latest, true, scriptKind(file));
  const parseDiagnostics: Diagnostic[] = sourceParseDiagnostics(source).map((item) =>
    scanDiagnostic(
      "SUPA_SCAN_CONTRACT_USAGE_PARSE",
      source,
      item.start ?? 0,
      `TypeScript source could not be fully parsed: ${flattenDiagnosticMessageText(item.messageText, " ")}`
    )
  );
  const imports = collectGeneratedImports(source, generatedTargets);
  if (!imports.importsGeneratedContracts) {
    return [];
  }
  const diagnostics = [...parseDiagnostics, ...imports.diagnostics];
  collectUsageDiagnostics(source, source, imports.runtimeRoots, diagnostics);
  return diagnostics.map((item) => withRelativeFile(item, cwd));
}

function collectGeneratedImports(
  source: SourceFile,
  generatedTargets: Set<string>
): GeneratedImportState {
  const diagnostics: Diagnostic[] = [];
  const runtimeRoots = new Set<string>();
  let importsGeneratedContracts = false;
  for (const statement of source.statements) {
    if (!isGeneratedImportDeclaration(statement, source, generatedTargets)) {
      continue;
    }
    importsGeneratedContracts = true;
    const clause = statement.importClause;
    const importClauseIsTypeOnly = clause?.isTypeOnly === true;
    const bindings = clause?.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        collectGeneratedImportSpecifier(
          specifier,
          source,
          importClauseIsTypeOnly,
          diagnostics,
          runtimeRoots
        );
      }
    }
  }
  return { diagnostics, importsGeneratedContracts, runtimeRoots };
}

function collectUsageDiagnostics(
  node: Node,
  source: SourceFile,
  runtimeRoots: Set<string>,
  diagnostics: Diagnostic[]
): void {
  if (isAsExpression(node) || isTypeAssertionExpression(node)) {
    diagnostics.push(
      scanDiagnostic(
        "SUPA_SCAN_CONTRACT_ASSERTION",
        source,
        node.getStart(source),
        "TypeScript assertions in files importing generated contracts bypass the generated contract boundary."
      )
    );
  }
  if (isCallExpression(node) && isPropertyAccessExpression(node.expression)) {
    const name = node.expression.name.text;
    if (name === "overrideTypes" || name === "returns") {
      diagnostics.push(
        scanDiagnostic(
          name === "overrideTypes"
            ? "SUPA_SCAN_CONTRACT_OVERRIDE_TYPES"
            : "SUPA_SCAN_CONTRACT_RETURNS",
          source,
          node.expression.name.getStart(source),
          `${name}() overrides generated query response contracts.`
        )
      );
    }
  }
  if (isVariableDeclaration(node) && isIdentifier(node.name) && node.initializer !== undefined) {
    const rootName = expressionRootName(node.initializer);
    if (rootName !== undefined && runtimeRoots.has(rootName)) {
      diagnostics.push(
        scanDiagnostic(
          "SUPA_SCAN_CONTRACT_RUNTIME_COPY",
          source,
          node.name.getStart(source),
          "Local constants initialized from generated runtime roots copy the generated contract."
        )
      );
    }
  }
  forEachChild(node, (child) => collectUsageDiagnostics(child, source, runtimeRoots, diagnostics));
}

function isGeneratedImportDeclaration(
  statement: Node,
  source: SourceFile,
  generatedTargets: Set<string>
): statement is GeneratedImportDeclaration {
  return (
    isImportDeclaration(statement) &&
    isStringLiteral(statement.moduleSpecifier) &&
    isGeneratedContractImport(statement.moduleSpecifier.text, source.fileName, generatedTargets)
  );
}

function collectGeneratedImportSpecifier(
  specifier: ImportSpecifier,
  source: SourceFile,
  importClauseIsTypeOnly: boolean,
  diagnostics: Diagnostic[],
  runtimeRoots: Set<string>
): void {
  if (specifier.propertyName !== undefined) {
    diagnostics.push(
      scanDiagnostic(
        "SUPA_SCAN_CONTRACT_IMPORT_RENAME",
        source,
        specifier.name.getStart(source),
        "Generated contract imports must keep their exported names."
      )
    );
  }
  const importedName = (specifier.propertyName ?? specifier.name).text;
  if (
    runtimeExportRoots.has(importedName) &&
    !importClauseIsTypeOnly &&
    specifier.isTypeOnly !== true
  ) {
    runtimeRoots.add(specifier.name.text);
  }
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

async function sourceFiles(root: string, generatedTargets: Set<string>): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) {
          await walk(path);
        }
        continue;
      }
      if (
        entry.isFile() &&
        sourceExtensions.has(extname(entry.name)) &&
        !generatedTargets.has(normalizePath(path)) &&
        !generatedTargets.has(normalizePath(stripKnownExtension(path)))
      ) {
        files.push(path);
      }
    }
  }
  await walk(root);
  return files;
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

function expressionRootName(expression: Expression): string | undefined {
  if (isIdentifier(expression)) {
    return expression.text;
  }
  if (isPropertyAccessExpression(expression) || isElementAccessExpression(expression)) {
    return expressionRootName(expression.expression);
  }
  return;
}

function scanDiagnostic(
  code: string,
  source: SourceFile,
  position: number,
  message: string
): Diagnostic {
  const location = source.getLineAndCharacterOfPosition(position);
  return diagnostic(
    code,
    "warning",
    `${message} (${location.line + 1}:${location.character + 1})`,
    {
      file: source.fileName,
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

function scriptKind(file: string): ScriptKind {
  if (file.endsWith(".tsx")) {
    return ScriptKind.TSX;
  }
  return ScriptKind.TS;
}

function sourceParseDiagnostics(source: SourceFile): readonly TypeScriptDiagnostic[] {
  const value = Reflect.get(source, "parseDiagnostics");
  return Array.isArray(value) ? value : [];
}
