#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { forEachNode, parseScript, ts } from "../guards/lib/ast-utils.js";
import { dottedName, parseSql, relName, stmtKind } from "../guards/lib/sql-ast.js";
import {
  CACHE_FORMAT,
  CODE_EXTENSIONS,
  createAtlasEnvelope,
  dbObjectId,
  extensionFor,
  fileId,
  languageFor,
  OUTPUT_PATH,
  ROOT,
  ROUTE_OWNERS,
  SCHEMA_VERSION,
  trimExtension,
} from "./lib/config.mjs";
import {
  atomicWriteJson,
  contentDigest,
  existsRel,
  gitFiles,
  gitHead,
  inputFingerprint,
  readText,
  safeJson,
} from "./lib/files.mjs";
import { createAtlasGraph, finalizeAtlas as finalizeGraph } from "./lib/graph.mjs";
import { commandFileTargets, packageNameFromSpecifier, resolveImport } from "./lib/resolve.mjs";

let atlas;
let graph;

export async function buildCodeAtlas({ write = true } = {}) {
  atlas = createAtlasEnvelope();
  graph = createAtlasGraph(atlas);
  const files = gitFiles();
  for (const file of files) {
    addFileNode(atlas, file);
  }
  scanPackageJsons(atlas, files);
  addPythonPackages(atlas, files);
  runTurboQuery(atlas);
  collectTs(atlas, files);
  collectRoutes(atlas, files);
  await collectSql(atlas, files);
  mergePython(atlas, files);
  collectManifests(atlas, files);
  finalizeAtlas(atlas);
  if (write) {
    atomicWriteJson(OUTPUT_PATH, atlas);
  }
  return atlas;
}

async function main() {
  const built = await buildCodeAtlas({ write: true });
  process.stdout.write(
    `CODE_ATLAS_BUILT nodes=${built.nodes.length} edges=${built.edges.length}\n`
  );
}

function addNode(_targetAtlas, node) {
  return graph.addNode(node);
}

function addEdge(_targetAtlas, edge) {
  graph.addEdge(edge);
}

function addFileNode(targetAtlas, file) {
  addNode(targetAtlas, {
    id: fileId(file),
    kind: "file",
    name: path.basename(file),
    path: file,
    extension: extensionFor(file),
    language: languageFor(file),
    contentDigest: contentDigest(file),
  });
}

function scanPackageJsons(targetAtlas, files) {
  const fileSet = new Set(files);
  for (const file of files.filter((candidate) => candidate.endsWith("package.json"))) {
    const parsed = readJson(file);
    if (!parsed?.name) {
      continue;
    }
    const packageId = `package:${parsed.name}`;
    addNode(targetAtlas, {
      id: packageId,
      kind: "package",
      name: parsed.name,
      version: parsed.version,
      path: file,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: packageId,
      type: "declares_package",
      evidence: file,
    });
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, version] of Object.entries(parsed[section] ?? {})) {
        const externalId = `external_package:${name}`;
        addNode(targetAtlas, {
          id: externalId,
          kind: "external_package",
          name,
          version,
          dependencySection: section,
        });
        addEdge(targetAtlas, {
          from: packageId,
          to: externalId,
          type: "depends_on",
          evidence: `${file}#${section}`,
        });
      }
    }
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (typeof command !== "string") {
        continue;
      }
      const scriptId = `package_script:${parsed.name}#${name}`;
      addNode(targetAtlas, {
        id: scriptId,
        kind: "package_script",
        name,
        package: parsed.name,
        path: file,
        command,
      });
      addEdge(targetAtlas, {
        from: packageId,
        to: scriptId,
        type: "defines_script",
        evidence: `${file}#scripts.${name}`,
      });
      for (const target of commandFileTargets(command, fileSet)) {
        addEdge(targetAtlas, {
          from: scriptId,
          to: fileId(target),
          type: "runs_file",
          evidence: `${file}#scripts.${name}`,
        });
      }
    }
  }
}

function addPythonPackages(targetAtlas, files) {
  for (const file of files.filter((candidate) => candidate.endsWith("pyproject.toml"))) {
    const name = readTomlProjectName(file);
    if (!name) {
      continue;
    }
    const packageId = `python_package:${name}`;
    addNode(targetAtlas, {
      id: packageId,
      kind: "python_package",
      name,
      path: file,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: packageId,
      type: "declares_python_package",
      evidence: file,
    });
  }
}

function runTurboQuery(targetAtlas) {
  if (!existsRel("turbo.json")) {
    return;
  }
  const result = spawnSync("npx", ["--no", "turbo", "query", "ls", "--output=json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    targetAtlas.diagnostics.push({
      collector: "runTurboQuery",
      message: "turbo query unavailable; skipped",
      detail: (result.stderr || result.stdout || "").slice(0, 2000),
    });
    return;
  }
  const parsed = safeJson(result.stdout);
  const packages = Array.isArray(parsed) ? parsed : parsed?.packages;
  for (const item of Array.isArray(packages) ? packages : []) {
    const name = item.name ?? item.packageName ?? item.path;
    if (!name) {
      continue;
    }
    const packageId = `package:${name}`;
    addNode(targetAtlas, {
      id: packageId,
      kind: "package",
      name,
      path: item.path,
    });
    addEdge(targetAtlas, {
      from: fileId("turbo.json"),
      to: packageId,
      type: "turbo_lists_package",
      evidence: "turbo query ls",
    });
  }
}

function collectTs(targetAtlas, files) {
  const fileSet = new Set(files);
  for (const file of files.filter((candidate) => CODE_EXTENSIONS.has(path.extname(candidate)))) {
    const text = readText(file);
    const sourceFile = parseScript(text, file);
    const moduleId = `module:${file}`;
    addNode(targetAtlas, {
      id: moduleId,
      kind: "module",
      name: trimExtension(path.basename(file)),
      path: file,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: moduleId,
      type: "declares_module",
      evidence: file,
    });
    collectImports(targetAtlas, file, sourceFile, fileSet);
    collectExports(targetAtlas, file, sourceFile);
    collectDbUsage(targetAtlas, file, sourceFile);
    collectFileReferences(targetAtlas, file, sourceFile, fileSet);
  }
}

function collectImports(targetAtlas, file, sourceFile, fileSet) {
  for (const statement of sourceFile.statements) {
    const specifier = moduleSpecifierValue(statement);
    if (!specifier) {
      continue;
    }
    const moduleId = `module:${specifier}`;
    addNode(targetAtlas, {
      id: moduleId,
      kind: "module",
      name: specifier,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: moduleId,
      type: "imports_module",
      evidence: file,
    });
    const resolved = resolveImport(file, specifier, fileSet);
    if (resolved) {
      addEdge(targetAtlas, {
        from: fileId(file),
        to: fileId(resolved),
        type: "imports_file",
        evidence: specifier,
      });
      addEdge(targetAtlas, {
        from: moduleId,
        to: fileId(resolved),
        type: "resolves_to_file",
        evidence: specifier,
      });
    } else if (!specifier.startsWith(".")) {
      const packageName = packageNameFromSpecifier(specifier);
      addNode(targetAtlas, {
        id: `external_package:${packageName}`,
        kind: "external_package",
        name: packageName,
      });
      addEdge(targetAtlas, {
        from: fileId(file),
        to: `external_package:${packageName}`,
        type: "imports_package",
        evidence: specifier,
      });
    }
  }
}

function collectExports(targetAtlas, file, sourceFile) {
  for (const statement of sourceFile.statements) {
    collectDirectExport(targetAtlas, file, statement);
    collectVariableExports(targetAtlas, file, statement);
    collectNamedReexports(targetAtlas, file, statement);
  }
}

function collectDirectExport(targetAtlas, file, statement) {
  if (!isExported(statement)) {
    return;
  }
  const name = declaredName(statement);
  if (name) {
    addTsSymbol(targetAtlas, file, name, "exported_symbol");
  }
}

function collectVariableExports(targetAtlas, file, statement) {
  if (!(ts.isVariableStatement(statement) && isExported(statement))) {
    return;
  }
  for (const declaration of statement.declarationList.declarations) {
    for (const name of bindingNames(declaration.name)) {
      addTsSymbol(targetAtlas, file, name, "exported_symbol");
    }
  }
}

function collectNamedReexports(targetAtlas, file, statement) {
  if (
    !(
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
  ) {
    return;
  }
  for (const element of statement.exportClause.elements) {
    addTsSymbol(targetAtlas, file, element.name.text, "reexported_symbol");
  }
}

function addTsSymbol(targetAtlas, file, name, symbolKind) {
  const id = `ts_symbol:${file}#${name}`;
  addNode(targetAtlas, {
    id,
    kind: "ts_symbol",
    name,
    symbolKind,
    path: file,
  });
  addEdge(targetAtlas, {
    from: fileId(file),
    to: id,
    type: "declares_symbol",
    evidence: file,
  });
}

function collectDbUsage(targetAtlas, file, sourceFile) {
  forEachNode(sourceFile, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if ((method === "from" || method === "rpc") && isStringLike(node.arguments[0])) {
        const objectName = node.arguments[0].text;
        const schema = schemaFromExpression(node.expression.expression) ?? "public";
        const dbKind = method === "rpc" ? "function" : "relation";
        addDbUsage(targetAtlas, file, dbKind, schema, objectName, method);
      }
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      const usage = databaseTypeUsage(node);
      if (usage) {
        addDbUsage(
          targetAtlas,
          file,
          usage.dbKind,
          usage.schema,
          usage.name,
          "Database indexed type"
        );
      }
    }
  });
}

function addDbUsage(targetAtlas, file, dbKind, schema, name, evidence) {
  const id = dbObjectId(dbKind, schema, name);
  addNode(targetAtlas, {
    id,
    kind: "db_object",
    dbKind,
    schema,
    name,
  });
  addEdge(targetAtlas, {
    from: fileId(file),
    to: id,
    type: "uses_db_object",
    evidence,
  });
}

function collectFileReferences(targetAtlas, file, sourceFile, fileSet) {
  forEachNode(sourceFile, (node) => {
    if (!(isStringLike(node) && fileSet.has(node.text))) {
      return;
    }
    addEdge(targetAtlas, {
      from: fileId(file),
      to: fileId(node.text),
      type: "references_file",
      evidence: "string literal",
    });
  });
}

function collectRoutes(targetAtlas, files) {
  for (const file of files) {
    const parsed = nextRoute(file);
    if (!parsed) {
      continue;
    }
    addNode(targetAtlas, {
      id: parsed.id,
      kind: "next_route",
      name: parsed.route,
      route: parsed.route,
      path: file,
      routeFileKind: parsed.fileKind,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: parsed.id,
      type: ROUTE_OWNERS.has(parsed.fileKind) ? "owns_route" : "wraps_route",
      evidence: file,
    });
  }
}

async function collectSql(targetAtlas, files) {
  for (const file of files.filter((candidate) => candidate.endsWith(".sql"))) {
    const text = readText(file);
    let parsed;
    try {
      parsed = await parseSql(text);
    } catch (error) {
      targetAtlas.diagnostics.push({
        collector: "collectSql",
        file,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const wrapped of parsed?.stmts ?? []) {
      const stmt = wrapped.stmt ?? wrapped;
      const kind = stmtKind(stmt);
      const node = stmt[kind];
      if (!node) {
        continue;
      }
      if (kind === "CreatePolicyStmt") {
        addPolicy(targetAtlas, file, node);
        continue;
      }
      const object = sqlObjectForStatement(kind, node);
      if (!object) {
        continue;
      }
      const id = dbObjectId(object.dbKind, object.schema, object.name);
      addNode(targetAtlas, {
        id,
        kind: "db_object",
        dbKind: object.dbKind,
        schema: object.schema,
        name: object.name,
        path: file,
      });
      addEdge(targetAtlas, {
        from: fileId(file),
        to: id,
        type: "declares_db_object",
        evidence: kind,
      });
    }
  }
}

function addPolicy(targetAtlas, file, node) {
  const table = relName(node.table);
  const name = node.policy_name;
  if (!table || typeof name !== "string") {
    return;
  }
  const policyId = `db_policy:${table.schema}.${table.name}.${name}`;
  const tableId = dbObjectId("table", table.schema, table.name);
  addNode(targetAtlas, {
    id: tableId,
    kind: "db_object",
    dbKind: "table",
    schema: table.schema,
    name: table.name,
  });
  addNode(targetAtlas, {
    id: policyId,
    kind: "db_policy",
    name,
    schema: table.schema,
    table: table.name,
    command: node.cmd_name,
    path: file,
  });
  addEdge(targetAtlas, {
    from: fileId(file),
    to: policyId,
    type: "declares_db_policy",
    evidence: "CreatePolicyStmt",
  });
  addEdge(targetAtlas, {
    from: policyId,
    to: tableId,
    type: "protects_db_object",
    evidence: file,
  });
}

function mergePython(targetAtlas, files) {
  const pythonFiles = files.filter((file) => file.endsWith(".py"));
  if (pythonFiles.length === 0) {
    return;
  }
  const python = process.env.PYTHON ?? "python3";
  const result = spawnSync(python, ["scripts/code-atlas/build-python.py"], {
    cwd: ROOT,
    input: JSON.stringify({ files: pythonFiles, allFiles: files }),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    targetAtlas.diagnostics.push({
      collector: "mergePython",
      message: "python sidecar failed",
      detail: (result.stderr || result.stdout || "").slice(0, 2000),
    });
    return;
  }
  const payload = safeJson(result.stdout);
  for (const node of payload?.nodes ?? []) {
    addNode(targetAtlas, node);
  }
  for (const edge of payload?.edges ?? []) {
    addEdge(targetAtlas, edge);
  }
  for (const diagnostic of payload?.diagnostics ?? []) {
    targetAtlas.diagnostics.push({ collector: "mergePython", ...diagnostic });
  }
}

function collectManifests(targetAtlas, files) {
  if (files.includes("wrangler.toml")) {
    const wrangler = readSimpleToml("wrangler.toml");
    if (wrangler.name && wrangler.main) {
      const workerId = `worker_job:${wrangler.name}`;
      addNode(targetAtlas, {
        id: workerId,
        kind: "worker_job",
        name: wrangler.name,
        path: "wrangler.toml",
        runtime: "cloudflare-workers",
      });
      addEdge(targetAtlas, {
        from: fileId("wrangler.toml"),
        to: workerId,
        type: "declares_worker_job",
        evidence: "wrangler.toml",
      });
      if (files.includes(wrangler.main)) {
        addEdge(targetAtlas, {
          from: workerId,
          to: fileId(wrangler.main),
          type: "runs_module",
          evidence: "wrangler.toml#main",
        });
        addEdge(targetAtlas, {
          from: fileId(wrangler.main),
          to: workerId,
          type: "owns_worker_job",
          evidence: "wrangler.toml#main",
        });
      }
    }
  }
  for (const file of files.filter(
    (candidate) => candidate.endsWith(".yml") || candidate.endsWith(".yaml")
  )) {
    if (!file.startsWith(".github/workflows/") && file !== "action.yml") {
      continue;
    }
    const parsed = safeYaml(readText(file));
    const name = parsed?.name;
    if (typeof name !== "string") {
      continue;
    }
    const id = `ci_workflow:${file}`;
    addNode(targetAtlas, {
      id,
      kind: "ci_workflow",
      name,
      path: file,
    });
    addEdge(targetAtlas, {
      from: fileId(file),
      to: id,
      type: "declares_ci_workflow",
      evidence: file,
    });
  }
}

function finalizeAtlas(targetAtlas) {
  const files = targetAtlas.nodes
    .filter((node) => node.kind === "file")
    .map((node) => node.path)
    .sort();
  targetAtlas.metadata = {
    cacheFormat: CACHE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    inputDigest: inputFingerprint(files),
    inputCount: files.length,
    gitHead: gitHead(),
    sources: {
      files:
        "git ls-files --cached --others --exclude-standard filtered by scripts/code-atlas/lib/config.mjs",
      typescript: "TypeScript compiler AST via scripts/guards/lib/ast-utils.js",
      sql: "Postgres parse tree via scripts/guards/lib/sql-ast.js",
      python: "Python ast sidecar at scripts/code-atlas/build-python.py",
      manifests:
        "package.json, pyproject.toml, wrangler.toml, GitHub Actions, repo MCP/config files",
    },
  };
  finalizeGraph(targetAtlas);
}

const sqlObjectHandlers = {
  CompositeTypeStmt: (node) => sqlObjectFromRef("type", relName(node.typevar)),
  CreateEnumStmt: (node) => sqlObjectFromRef("enum", dottedName(node.typeName)),
  CreateExtensionStmt: (node) =>
    typeof node.extname === "string"
      ? { dbKind: "extension", name: node.extname, schema: "public" }
      : undefined,
  CreateFunctionStmt: (node) => sqlObjectFromRef("function", dottedName(node.funcname)),
  CreateSchemaStmt: (node) =>
    typeof node.schemaname === "string"
      ? { dbKind: "schema", name: node.schemaname, schema: node.schemaname }
      : undefined,
  CreateStmt: (node) => sqlObjectFromRef("table", relName(node.relation)),
  IndexStmt: (node) => indexSqlObject(node),
  ViewStmt: (node) => sqlObjectFromRef("view", relName(node.view)),
};

function sqlObjectForStatement(kind, node) {
  return sqlObjectHandlers[kind]?.(node);
}

function sqlObjectFromRef(dbKind, ref) {
  return ref ? { dbKind, ...ref } : undefined;
}

function indexSqlObject(node) {
  if (typeof node.idxname !== "string") {
    return;
  }
  const relation = relName(node.relation);
  return {
    dbKind: "index",
    name: node.idxname,
    schema: relation?.schema ?? "public",
  };
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    atlas.diagnostics.push({
      collector: "readJson",
      file,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
}

function safeYaml(text) {
  try {
    return parseYaml(text);
  } catch {
    return;
  }
}

function readTomlProjectName(file) {
  const text = readText(file);
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    if (section === "project" && line.startsWith("name")) {
      return tomlStringValue(line);
    }
  }
  return;
}

function readSimpleToml(file) {
  const out = {};
  for (const rawLine of readText(file).split("\n")) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("[") || line.startsWith("#")) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = tomlStringValue(line);
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

function tomlStringValue(line) {
  const separator = line.indexOf("=");
  if (separator <= 0) {
    return;
  }
  const value = line.slice(separator + 1).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return;
}

function moduleSpecifierValue(statement) {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    isStringLike(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    isStringLike(statement.moduleReference.expression)
  ) {
    return statement.moduleReference.expression.text;
  }
  return;
}

function isExported(node) {
  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

function declaredName(node) {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  return;
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  const out = [];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        out.push(...bindingNames(element.name));
      }
    }
  }
  return out;
}

function isStringLike(node) {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function schemaFromExpression(expression, depth = 0) {
  if (!expression || depth > 8) {
    return;
  }
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "schema" &&
    isStringLike(expression.arguments[0])
  ) {
    return expression.arguments[0].text;
  }
  if (ts.isCallExpression(expression)) {
    return schemaFromExpression(expression.expression, depth + 1);
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return schemaFromExpression(expression.expression, depth + 1);
  }
  return;
}

function databaseTypeUsage(node) {
  const chain = indexedAccessChain(node);
  if (chain?.root !== "Database") {
    return;
  }
  const [schema, group, name] = chain.keys;
  if (!(schema && group && name)) {
    return;
  }
  const dbKind = {
    CompositeTypes: "type",
    Enums: "enum",
    Functions: "function",
    Tables: "table",
    Views: "view",
  }[group];
  return dbKind ? { dbKind, schema, name } : undefined;
}

function indexedAccessChain(node) {
  const keys = [];
  let cursor = node;
  while (ts.isIndexedAccessTypeNode(cursor)) {
    const key = literalTypeText(cursor.indexType);
    if (key) {
      keys.unshift(key);
    }
    cursor = cursor.objectType;
  }
  if (ts.isTypeReferenceNode(cursor) && ts.isIdentifier(cursor.typeName)) {
    return { root: cursor.typeName.text, keys };
  }
  return;
}

function literalTypeText(node) {
  return ts.isLiteralTypeNode(node) && isStringLike(node.literal) ? node.literal.text : undefined;
}

function nextRoute(file) {
  const parts = file.split("/");
  const appIndex = parts.lastIndexOf("app");
  if (appIndex === -1) {
    return;
  }
  const basename = trimExtension(parts.at(-1) ?? "");
  if (!["page", "layout", "route"].includes(basename)) {
    return;
  }
  const segments = parts.slice(appIndex + 1, -1).flatMap((segment) => routeSegment(segment));
  const route = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return {
    id: `next_route:${route}`,
    route,
    fileKind: basename,
  };
}

function routeSegment(segment) {
  if (!segment || (segment.startsWith("(") && segment.endsWith(")")) || segment.startsWith("@")) {
    return [];
  }
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return [`*${segment.slice(5, -2)}?`];
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return [`*${segment.slice(4, -1)}`];
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return [`:${segment.slice(1, -1)}`];
  }
  return [segment];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
