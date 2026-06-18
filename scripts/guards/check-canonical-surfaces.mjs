#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parse as parseShell } from "sh-syntax";
import { parse as parseJsTs, ts } from "./lib/ast-utils.js";
import { assert, exists, gitFiles, ok, ROOT, readJson, readText, run } from "./lib/guard-utils.js";

const codeRoots = [
  ".agents/skills/",
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
const forbiddenSurfaceNameTerms = [
  "alias",
  "compat",
  "compatibility",
  "deprecated",
  "dto",
  "facade",
  "legacy",
  "shim",
  "view-model",
  "viewmodel",
  "wrapper",
];
const deferredMarkerTerms = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["T", "BD"].join(""),
  ["place", "holder"].join(""),
];
const externalContractExportOnlyFiles = new Map([
  ["src/index.ts", "npm package public API entry point"],
]);
const monetizationOwnerFiles = new Set(["src/license.ts"]);
const monetizationTerms = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_MAP",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CATALOG_APPROVED",
  "STRIPE_LIVE_APPROVED",
  "SUPASCHEMA_LICENSE_PRIVATE_KEY",
  "GITHUB_MARKETPLACE_WEBHOOK_SECRET",
  "checkout/sessions",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "marketplace_purchase",
  "marketplace_listing_plan_id",
  "X-Hub-Signature-256",
  "x-hub-signature-256",
  "api.stripe.com",
];

const packageJson = readJson("package.json");
const files = gitFiles().filter((file) => exists(file));
const codeFiles = files.filter(isSourceCodeFile);
const jsTsFiles = codeFiles.filter((file) => jsTsExtensions.has(path.extname(file)));
const pythonFiles = codeFiles.filter((file) => pythonExtensions.has(path.extname(file)));
const shellFiles = codeFiles.filter((file) => shellExtensions.has(path.extname(file)));
const violations = [
  ...forbiddenFileNameViolations(codeFiles),
  ...exportOnlyModuleViolations(jsTsFiles),
  ...jsTsCommentViolations(jsTsFiles),
  ...jsTsAstGrepPatternEngineViolations(jsTsFiles),
  ...jsTsPatternEngineViolations(jsTsFiles),
  ...jsTsRegexStringContractViolations(jsTsFiles),
  ...jsTsTypeAssertionViolations(jsTsFiles),
  ...jsTsCopiedEnumTupleViolations(jsTsFiles),
  ...jsTsDeferredMarkerViolations(jsTsFiles),
  ...pythonCommentViolations(pythonFiles),
  ...pythonPatternEngineViolations(pythonFiles),
  ...pythonDeferredMarkerViolations(pythonFiles),
  ...(await shellCommentViolations(shellFiles)),
  ...(await shellPatternEngineViolations(shellFiles)),
  ...shellDeferredMarkerViolations(shellFiles),
  ...monetizationSurfaceViolations(jsTsFiles),
  ...packageScriptViolations(packageJson.scripts ?? {}),
];

assert(
  violations.length === 0,
  `canonical surfaces guard failed:\n${violations.map((item) => `- ${item}`).join("\n")}`
);

ok("CANONICAL_SURFACES_OK");

function isSourceCodeFile(file) {
  return (
    (codeRoots.some((root) => file.startsWith(root)) || codeRootFiles.includes(file)) &&
    codeExtensions.has(path.extname(file)) &&
    !file.endsWith(".d.ts")
  );
}

function forbiddenFileNameViolations(candidates) {
  return candidates
    .filter((file) => {
      const base = path.basename(file).toLowerCase();
      return forbiddenSurfaceNameTerms.some((term) => base.includes(term));
    })
    .map(
      (file) =>
        `${file} has a forbidden compatibility or parallel-contract module name; rename or delete it in the canonical owner.`
    );
}

function exportOnlyModuleViolations(candidates) {
  return candidates.flatMap((file) => {
    if (!isExportOnlyModule(file)) {
      return [];
    }
    const externalContract = externalContractExportOnlyFiles.get(file);
    if (externalContract !== undefined) {
      return [];
    }
    return [
      `${file} is export-only; move the exported symbols to the canonical owner and delete this surface.`,
    ];
  });
}

function jsTsCommentViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const ranges = new Map();
    collectJsTsCommentRanges(source, text, ranges);
    return [...ranges.values()]
      .sort((left, right) => left.pos - right.pos)
      .map((range) => {
        const location = source.getLineAndCharacterOfPosition(range.pos);
        const kind = range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block";
        return `${file}:${location.line + 1}:${location.character + 1} contains a ${kind} comment; move durable explanation to the owning rule, test, or docs surface.`;
      });
  });
}

function jsTsPatternEngineViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const found = [];
    collectJsTsPatternEngineViolations(source, source, found);
    return found.map((node) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains pattern-engine syntax; use parser or AST helpers.`;
    });
  });
}

function jsTsAstGrepPatternEngineViolations(candidates) {
  if (candidates.length === 0) {
    return [];
  }
  const inlineRules = [
    astGrepRule("no-regex-literal-ts", "TypeScript", "/$A/"),
    astGrepRule("no-regexp-new-ts", "TypeScript", "new RegExp($A)"),
    astGrepRule("no-regexp-call-ts", "TypeScript", "RegExp($A)"),
    astGrepRule("no-regex-literal-js", "JavaScript", "/$A/"),
    astGrepRule("no-regexp-new-js", "JavaScript", "new RegExp($A)"),
    astGrepRule("no-regexp-call-js", "JavaScript", "RegExp($A)"),
  ].join("\n---\n");
  const result = spawnSync(
    astGrepBinary(),
    ["scan", "--inline-rules", inlineRules, "--json=compact", "--max-results", "20", ...candidates],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    return [`ast-grep regex discovery failed:\n${childProcessDiagnostics(result)}`];
  }
  const matches = JSON.parse(result.stdout || "[]");
  return matches.map(
    (match) =>
      `${match.file}:${match.range.start.line + 1}:${match.range.start.column + 1} contains pattern-engine syntax found by ast-grep; use parser or AST helpers.`
  );
}

function astGrepRule(id, language, pattern) {
  return [`id: ${id}`, `language: ${language}`, "rule:", `  pattern: ${pattern}`].join("\n");
}

function astGrepBinary() {
  return path.join(
    ROOT,
    "node_modules",
    "@ast-grep",
    "cli",
    process.platform === "win32" ? "ast-grep.exe" : "ast-grep"
  );
}

function childProcessDiagnostics(result) {
  return (
    [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n") ||
    "no child-process diagnostics"
  );
}

function collectJsTsPatternEngineViolations(node, source, found) {
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral || isRegExpConstructorCall(node)) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => collectJsTsPatternEngineViolations(child, source, found));
}

function isRegExpConstructorCall(node) {
  return (
    (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "RegExp"
  );
}

function jsTsRegexStringContractViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const found = [];
    collectJsTsRegexStringContractViolations(source, source, found);
    return found.map((node) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains a regex-shaped string contract; move validation to the canonical scanner or parser owner.`;
    });
  });
}

function collectJsTsRegexStringContractViolations(node, source, found) {
  const value = jsTsStringValue(node);
  if (value !== undefined && isRegexShapedString(value)) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => collectJsTsRegexStringContractViolations(child, source, found));
}

function isRegexShapedString(value) {
  if (value.length === 0) {
    return false;
  }
  const groupStart = ["(", "?", ":"].join("");
  const lookaheadStart = ["(", "?", "="].join("");
  const namedStart = ["(", "?", "<"].join("");
  const startsLikePattern =
    value.startsWith("^") ||
    value.startsWith(groupStart) ||
    value.startsWith(lookaheadStart) ||
    value.startsWith(namedStart);
  if (!startsLikePattern) {
    return false;
  }
  const slash = "\\";
  const tokenTerms = [
    [slash, "d"].join(""),
    [slash, "w"].join(""),
    [slash, "s"].join(""),
    [".", "*"].join(""),
    [".", "+"].join(""),
    ["?", ":"].join(""),
    ["(", "?"].join(""),
    "$",
  ];
  return tokenTerms.some((token) => value.includes(token));
}

function jsTsTypeAssertionViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const found = [];
    collectJsTsTypeAssertionViolations(source, source, found);
    return found.map((node) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains a TypeScript assertion; use the generated contract, parser, or scanner owner instead.`;
    });
  });
}

function collectJsTsTypeAssertionViolations(node, source, found) {
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => collectJsTsTypeAssertionViolations(child, source, found));
}

function jsTsCopiedEnumTupleViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const found = [];
    collectJsTsCopiedEnumTupleViolations(source, source, found);
    return found.map((node) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains an inline z.enum tuple; use the canonical enum owner.`;
    });
  });
}

function collectJsTsCopiedEnumTupleViolations(node, source, found) {
  if (isInlineZodEnumTuple(node)) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => collectJsTsCopiedEnumTupleViolations(child, source, found));
}

function isInlineZodEnumTuple(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "z" &&
    node.expression.name.text === "enum" &&
    node.arguments.length > 0 &&
    ts.isArrayLiteralExpression(node.arguments[0])
  );
}

function jsTsDeferredMarkerViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    const source = parseJsTs(text, { fileName: file });
    const found = [];
    collectJsTsDeferredMarkerViolations(source, source, found);
    return found.map(({ node, term }) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains deferred marker ${term}; resolve it in the canonical owner.`;
    });
  });
}

function collectJsTsDeferredMarkerViolations(node, source, found) {
  const value = jsTsSearchableValue(node);
  if (value !== undefined) {
    const term = deferredMarkerTerms.find((candidate) => value.includes(candidate));
    if (term !== undefined) {
      found.push({ node, term });
    }
  }
  ts.forEachChild(node, (child) => collectJsTsDeferredMarkerViolations(child, source, found));
}

function jsTsSearchableValue(node) {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return jsTsStringValue(node);
}

function jsTsStringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
  }
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

function monetizationSurfaceViolations(candidates) {
  return candidates.flatMap((file) => {
    if (
      file.startsWith("tests/") ||
      file === "scripts/guards/check-canonical-surfaces.mjs" ||
      monetizationOwnerFiles.has(file)
    ) {
      return [];
    }
    const source = parseJsTs(readText(file), { fileName: file });
    const found = [];
    collectMonetizationTerms(source, source, found);
    return found.map(({ node, term }) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${file}:${location.line + 1}:${location.character + 1} contains monetization term ${term}; keep checkout, Stripe, GitHub Marketplace, and license issuance implementation outside the public repository.`;
    });
  });
}

function collectMonetizationTerms(node, source, found) {
  const value = jsTsSearchableValue(node);
  if (value !== undefined) {
    const term = monetizationTerms.find((candidate) => value.includes(candidate));
    if (term !== undefined) {
      found.push({ node, term });
    }
  }
  ts.forEachChild(node, (child) => collectMonetizationTerms(child, source, found));
}

function pythonCommentViolations(candidates) {
  if (candidates.length === 0) {
    return [];
  }
  const source = [
    "import json, sys, tokenize",
    "hits = []",
    "for path in sys.argv[1:]:",
    "    with open(path, 'rb') as stream:",
    "        for token in tokenize.tokenize(stream.readline):",
    "            if token.type == tokenize.COMMENT and not (token.start[0] == 1 and token.string.startswith('#!')):",
    "                hits.append(f'{path}:{token.start[0]}:{token.start[1] + 1}')",
    "print(json.dumps(hits))",
  ].join("\n");
  const result = runPythonCommentTokenizer(source, candidates);
  return JSON.parse(result).map(
    (location) =>
      `${location} contains a Python comment; move durable explanation to the owning rule, test, or docs surface.`
  );
}

function pythonPatternEngineViolations(candidates) {
  if (candidates.length === 0) {
    return [];
  }
  const source = [
    "import ast, json, sys",
    "hits = []",
    "for path in sys.argv[1:]:",
    "    tree = ast.parse(open(path, encoding='utf8').read(), filename=path)",
    "    aliases = set()",
    "    for node in ast.walk(tree):",
    "        if isinstance(node, ast.Import):",
    "            for alias in node.names:",
    "                if alias.name == 're':",
    "                    aliases.add(alias.asname or alias.name)",
    "        if isinstance(node, ast.ImportFrom) and node.module == 're':",
    "            hits.append(f'{path}:{node.lineno}:{node.col_offset + 1}')",
    "        if isinstance(node, ast.Call):",
    "            fn = node.func",
    "            if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id in aliases:",
    "                hits.append(f'{path}:{node.lineno}:{node.col_offset + 1}')",
    "print(json.dumps(hits))",
  ].join("\n");
  return JSON.parse(run("python3", ["-c", source, ...candidates]).stdout).map(
    (location) => `${location} contains pattern-engine usage; use parser or AST helpers.`
  );
}

function pythonDeferredMarkerViolations(candidates) {
  if (candidates.length === 0) {
    return [];
  }
  const source = [
    "import ast, json, sys",
    `terms = ${JSON.stringify(deferredMarkerTerms)}`,
    "hits = []",
    "for path in sys.argv[1:]:",
    "    tree = ast.parse(open(path, encoding='utf8').read(), filename=path)",
    "    for node in ast.walk(tree):",
    "        value = None",
    "        if isinstance(node, ast.Name):",
    "            value = node.id",
    "        elif isinstance(node, ast.Constant) and isinstance(node.value, str):",
    "            value = node.value",
    "        if value:",
    "            for term in terms:",
    "                if term in value:",
    "                    hits.append(f'{path}:{node.lineno}:{node.col_offset + 1}:{term}')",
    "                    break",
    "print(json.dumps(hits))",
  ].join("\n");
  return JSON.parse(run("python3", ["-c", source, ...candidates]).stdout).map((entry) => {
    const [file, line, column, term] = entry.split(":");
    return `${file}:${line}:${column} contains deferred marker ${term}; resolve it in the canonical owner.`;
  });
}

function runPythonCommentTokenizer(source, candidates) {
  return run("python3", ["-c", source, ...candidates]).stdout;
}

async function shellCommentViolations(candidates) {
  return (
    await Promise.all(
      candidates.map(async (file) => {
        const tree = await parseShell(readText(file), { filepath: file });
        const comments = [];
        collectShellComments(tree, comments);
        return comments
          .filter((comment) => !(comment.Pos?.Line === 1 && comment.Text.startsWith("!")))
          .map(
            (comment) =>
              `${file}:${comment.Pos.Line}:${comment.Pos.Col} contains a shell comment; move durable explanation to the owning rule, test, or docs surface.`
          );
      })
    )
  ).flat();
}

async function shellPatternEngineViolations(candidates) {
  return (
    await Promise.all(
      candidates.map(async (file) => {
        const tree = await parseShell(readText(file), { filepath: file });
        const found = [];
        collectShellPatternEngineUse(tree, found);
        return found.map(
          (node) =>
            `${file}:${node.Pos?.Line ?? 1}:${node.Pos?.Col ?? 1} contains shell pattern-engine usage; use parser or AST helpers.`
        );
      })
    )
  ).flat();
}

function collectShellPatternEngineUse(value, found) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectShellPatternEngineUse(item, found);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (value.Op === "=~" || value.Value === "=~") {
    found.push(value);
  }
  for (const item of Object.values(value)) {
    collectShellPatternEngineUse(item, found);
  }
}

function shellDeferredMarkerViolations(candidates) {
  return candidates.flatMap((file) => {
    const text = readText(file);
    return deferredMarkerTerms
      .filter((term) => text.includes(term))
      .map(
        (term) => `${file} contains deferred marker ${term}; resolve it in the canonical owner.`
      );
  });
}

function collectShellComments(value, comments) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectShellComments(item, comments);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value.Comments)) {
    comments.push(...value.Comments);
  }
  for (const item of Object.values(value)) {
    collectShellComments(item, comments);
  }
}

function isExportOnlyModule(file) {
  const source = parseJsTs(readText(file), { fileName: file });
  const statements = source.statements.filter((statement) => !isEmptyStatement(statement));
  if (statements.length === 0) {
    return false;
  }
  const nonImports = statements.filter((statement) => !ts.isImportDeclaration(statement));
  return nonImports.length > 0 && nonImports.every(isReExportStatement);
}

function isEmptyStatement(statement) {
  return statement.kind === ts.SyntaxKind.EmptyStatement;
}

function isReExportStatement(statement) {
  if (ts.isExportDeclaration(statement)) {
    return statement.moduleSpecifier !== undefined;
  }
  if (ts.isExportAssignment(statement)) {
    return false;
  }
  return false;
}

function packageScriptViolations(scripts) {
  return Object.entries(scripts).flatMap(([name, command]) => {
    if (typeof command !== "string") {
      return [];
    }
    const shellDeleteViolation = packageScriptShellDeleteViolation(name, command);
    if (shellDeleteViolation !== undefined) {
      return [shellDeleteViolation];
    }
    const commandPath = commandPathFromScript(command);
    if (commandPath === undefined) {
      return [];
    }
    const base = path.basename(commandPath).toLowerCase();
    if (!forbiddenSurfaceNameTerms.some((term) => base.includes(term))) {
      return [];
    }
    return [
      `package script ${name} runs ${commandPath}, which has a forbidden compatibility or parallel-contract module name.`,
    ];
  });
}

function packageScriptShellDeleteViolation(name, command) {
  if (!command.includes("rm")) {
    return;
  }
  const tokens = command.split(" ").filter(Boolean);
  const rmIndex = tokens.findIndex((token) => token === "rm" || token.endsWith("/rm"));
  if (rmIndex === -1) {
    return;
  }
  const flags = tokens
    .slice(rmIndex + 1)
    .filter((token) => token.startsWith("-"))
    .join("");
  return flags.includes("r") && flags.includes("f")
    ? `package script ${name} uses recursive force deletion; delete the script or move cleanup into a guarded owner.`
    : undefined;
}

function commandPathFromScript(command) {
  const parts = command.split(" ").filter(Boolean);
  return parts.find((part) => codeExtensions.has(path.extname(part)));
}
