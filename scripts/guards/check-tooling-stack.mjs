#!/usr/bin/env node
import { forEachNode, parseScript, ts } from "./lib/ast-utils.js";
import { assert, exists, gitFiles, ok, readJson, readText } from "./lib/guard-utils.js";

const packageJson = readJson("package.json");
const catalog = readJson("scripts/dependency-catalog.json");
const biome = readJson("biome.jsonc");
const vitestConfig = readText("vitest.config.ts");

assert(catalog.packageManager === "npm", "tooling stack must keep the npm package contract");
assert(exists("package-lock.json"), "npm package-lock.json must exist");
assert(!exists("pnpm-lock.yaml"), "pnpm lockfile must not be introduced");
assert(!exists("yarn.lock"), "Yarn lockfile must not be introduced");
assert(!exists("bun.lockb"), "Bun lockfile must not be introduced");
assert(
  !exists(".npmignore"),
  "package boundary must use package.json files allowlist, not root .npmignore"
);
assert(!exists("biome.json"), "Biome config must be biome.jsonc");
assert(exists("biome.jsonc"), "missing biome.jsonc");
assert(Array.isArray(packageJson.files), "package.json must define a files allowlist");
assert(
  exists("scripts/cclsp-language-id-proxy.mjs"),
  "cclsp language-id proxy must exist for .mjs/.cjs TypeScript LSP support"
);

const complexityCapIncludes = [
  "benchmarks/compare.js",
  "benchmarks/plot-svg.js",
  "scripts/check-docs-standard.mjs",
  "scripts/code-atlas/build.mjs",
  "scripts/code-atlas/query.mjs",
  "src/catalog-foreign.ts",
  "src/check.ts",
  "src/cli-diff.ts",
  "src/diff-score.ts",
  "src/doctor.ts",
  "src/plan-order.ts",
  "src/planner-table.ts",
  "src/planner.ts",
  "src/source-normalize.ts",
  "src/sql/extract.ts",
  "src/sql/facts.ts",
  "src/sql/split.ts",
  "src/sql/statements.ts",
  "src/typegen-model.ts",
  "src/typegen-zod.ts",
  "src/typegen.ts",
  "src/verify.ts",
];

const toolPins = {
  "@biomejs/biome": "2.5.0",
  "@vitest/coverage-v8": "4.1.9",
  ultracite: "7.8.3",
  vitest: "4.1.9",
};

for (const [name, version] of Object.entries(toolPins)) {
  assert(
    packageJson.devDependencies?.[name] === version,
    `package.json must pin ${name}@${version}`
  );
}
assert(
  !("pg-formatter" in (packageJson.devDependencies ?? {})),
  "pg-formatter must not be reintroduced; SQL is governed by supaschema parser/deparser semantics"
);

assert(packageJson.scripts?.lint === "ultracite check .", "lint must run Ultracite check");
assert(packageJson.scripts?.test === "vitest run", "test must run the full Vitest suite");
assert(
  packageJson.scripts?.["test:coverage"] === "vitest run --coverage",
  "test:coverage must run the full Vitest suite with coverage"
);
assert(
  packageJson.scripts?.["test:examples"] === "vitest run tests/examples.test.ts --maxWorkers=1",
  "test:examples must own the examples regression lane"
);
assert(
  packageJson.scripts?.["test:matrix"] === "vitest run --exclude tests/examples.test.ts",
  "test:matrix must exclude the examples lane from DB and OS matrices"
);
assert(
  packageJson.scripts?.["test:matrix:coverage"] ===
    "vitest run --coverage --exclude tests/examples.test.ts",
  "test:matrix:coverage must be the coverage equivalent of test:matrix"
);
assert(
  packageJson.scripts?.format ===
    "npm run format:json && ultracite fix . && npm run format:md && npm run format:toml && npm run format:sh && npm run py:fix",
  "format must be the single write command chaining every writer: sort-package-json (format:json), Ultracite (Biome), Prettier (format:md), taplo (format:toml), shfmt (format:sh), ruff (py:fix)"
);
assert(
  packageJson.scripts?.["format:md"] === 'prettier --write "**/*.{md,mdx,yml,yaml}"',
  "format:md must run Prettier write over MDX/Markdown/YAML"
);
assert(!("format:sql" in packageJson.scripts), "SQL formatter lane must not be reintroduced");
assert(
  packageJson.scripts?.["format:toml"] === "node scripts/format-toml.mjs",
  "format:toml must run the taplo TOML lane"
);
assert(
  packageJson.scripts?.["format:sh"] === "node scripts/format-sh.mjs",
  "format:sh must run the shfmt (sh-syntax) shell lane"
);
assert(
  packageJson.scripts?.["format:json"] === "sort-package-json",
  "format:json must run sort-package-json for canonical package.json key order"
);
assert(
  packageJson.scripts?.["py:fix"] ===
    "uv run --package supaschema-agent-mcp ruff check --fix services/agent-mcp && uv run --package supaschema-agent-mcp ruff format services/agent-mcp",
  "py:fix must run ruff --fix (lint + import sort) then ruff format — the Python write lane"
);
assert(!("lint:fix" in packageJson.scripts), "format must be the only repo-wide write/fix script");
assert(
  packageJson.scripts?.["lint:doctor"] === "ultracite doctor",
  "lint:doctor must run Ultracite doctor"
);
assertNoShellTrueWithArgs("scripts/install-hooks.mjs");
assertNoShellTrueWithArgs("scripts/actions/run-supaschema-action.mjs");

assert(
  biome.$schema === "https://biomejs.dev/schemas/2.5.0/schema.json",
  "biome.jsonc must use the Biome 2.5.0 schema"
);
for (const preset of [
  "ultracite/biome/core",
  "ultracite/biome/type-aware",
  "ultracite/biome/vitest",
]) {
  assert(biome.extends?.includes(preset), `biome.jsonc missing ${preset}`);
}
assert(
  biome.formatter?.lineWidth === 100,
  "biome.jsonc must preserve the 100-column formatter line width"
);
assert(
  !biome.files?.includes?.includes("**"),
  'biome.jsonc must not duplicate Ultracite core\'s "**" include'
);
assert(
  biome.linter?.rules?.correctness?.useImportExtensions?.level === "error",
  "Biome must enforce runtime import extensions"
);
assert(
  biome.linter?.rules?.correctness?.useImportExtensions?.options?.extensionMappings?.ts === "js" &&
    biome.linter?.rules?.correctness?.useImportExtensions?.options?.extensionMappings?.tsx === "js",
  "Biome must preserve emitted .js specifiers for NodeNext TypeScript"
);
assertNoDisabledBiomeRules(biome.linter?.rules ?? {});
assertBiomeOverrides(biome.overrides ?? []);
assertAgentPackageSurface(packageJson.files ?? []);
assertRuntimePackageSurface(packageJson.files ?? []);
assertCclspProxyWiring(readJson(".claude/cclsp.json"));

for (const file of gitFiles().filter(
  (candidate) => candidate.endsWith(".ts") && exists(candidate)
)) {
  assert(
    !hasRelativeTsImport(file),
    `${file} must use emitted-runtime .js specifiers for relative imports`
  );
}

for (const token of [
  'environment: "node"',
  'pool: "forks"',
  "maxWorkers: 4",
  "minWorkers: 1",
  'provider: "v8"',
  'reporter: ["text", "lcov"]',
]) {
  assert(vitestConfig.includes(token), `vitest.config.ts missing ${token}`);
}

ok("TOOLING_STACK_OK");

function hasRelativeTsImport(file) {
  const source = parseScript(readText(file), file);
  let found = false;
  forEachNode(source, (node) => {
    if (isRelativeTsModuleSpecifier(staticModuleSpecifier(node))) {
      found = true;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (ts.isStringLiteral(argument) && isRelativeTsModuleSpecifier(argument.text)) {
        found = true;
      }
    }
  });
  return found;
}

function staticModuleSpecifier(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
}

function isRelativeTsModuleSpecifier(value) {
  return typeof value === "string" && value.startsWith(".") && value.endsWith(".ts");
}

function assertNoShellTrueWithArgs(file) {
  const source = parseScript(readText(file), file);
  forEachNode(source, (node) => {
    if (!(ts.isCallExpression(node) && isChildProcessCall(node.expression))) {
      return;
    }
    if (node.arguments.length < 3 || !objectHasShellTrue(node.arguments[2])) {
      return;
    }
    assert(
      false,
      `${file} must not pass child_process args with shell: true; use argv arrays with shell: false`
    );
  });
}

function isChildProcessCall(expression) {
  if (ts.isIdentifier(expression)) {
    return ["execFile", "execFileSync", "spawn", "spawnSync"].includes(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return ["execFile", "execFileSync", "spawn", "spawnSync"].includes(expression.name.text);
  }
  return false;
}

function objectHasShellTrue(expression) {
  if (!ts.isObjectLiteralExpression(expression)) {
    return false;
  }
  return expression.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "shell" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return;
}

function assertAgentPackageSurface(files) {
  const allowedAgentFiles = new Set([
    ".agents/prompts/supaschema-install.md",
    ".agents/skills/supaschema",
    ".claude/hooks/guards/bash-policy-checks.mjs",
    ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
    ".claude/rules/supaschema.md",
    ".claude/skills/supaschema",
    ".codex/hooks/general-guard.mjs",
    ".codex/hooks/guards/bash-policy-checks.mjs",
    ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
    ".codex/hooks.json",
    ".codex/rules/supaschema.rules",
  ]);

  for (const file of files) {
    const isAgentSurface =
      file === "AGENTS.md" ||
      file.startsWith(".agents/") ||
      file.startsWith(".claude/") ||
      file.startsWith(".codex/");
    if (isAgentSurface) {
      assert(
        allowedAgentFiles.has(file),
        `package.json must not publish non-Supaschema agent surface ${file}`
      );
    }
  }

  for (const file of allowedAgentFiles) {
    assert(files.includes(file), `package.json must publish ${file}`);
  }
}

function assertRuntimePackageSurface(files) {
  const forbiddenPackagePrefixes = [
    "benchmarks",
    "corpus",
    "docs",
    "examples",
    "scripts",
    "services",
    "src",
    "tests",
  ];

  for (const file of files) {
    for (const prefix of forbiddenPackagePrefixes) {
      assert(
        file !== prefix && !file.startsWith(`${prefix}/`),
        `package.json must not publish ${prefix}/ through ${file}; keep it in the public repo/docs surface, not node_modules`
      );
    }
  }
}

function assertNoDisabledBiomeRules(value, path = "linter.rules") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (child === "off") {
      assert(false, `biome.jsonc must not disable ${nextPath}`);
    }
    if (child && typeof child === "object") {
      assertNoDisabledBiomeRules(child, nextPath);
    }
  }
}

function assertBiomeOverrides(overrides) {
  const allowedDisabled = new Map([
    ["src/index.ts", new Set(["linter.rules.performance.noBarrelFile"])],
  ]);
  let foundComplexityCap = false;

  for (const override of overrides) {
    const includes = override.includes ?? [];
    const disabledPaths = disabledBiomeRulePaths(override.linter?.rules ?? {});
    for (const path of disabledPaths) {
      for (const include of includes) {
        if (allowedDisabled.get(include)?.has(path)) {
          continue;
        }
        assert(false, `biome.jsonc override for ${include} must not disable ${path}`);
      }
    }

    const complexityRule = override.linter?.rules?.complexity?.noExcessiveCognitiveComplexity;
    if (complexityRule !== undefined) {
      foundComplexityCap = true;
      assert(
        sameStringSet(includes, complexityCapIncludes),
        "biome.jsonc complexity cap must use the approved mature-baseline file list"
      );
      assert(
        complexityRule.level === "error" && complexityRule.options?.maxAllowedComplexity === 65,
        "biome.jsonc complexity cap must stay at error level with maxAllowedComplexity 65"
      );
      continue;
    }

    const isAllowedBarrelOverride = includes.length === 1 && includes[0] === "src/index.ts";
    assert(
      isAllowedBarrelOverride,
      `biome.jsonc override is not allowed for ${includes.join(", ") || "(none)"}`
    );
  }

  assert(foundComplexityCap, "biome.jsonc must preserve the approved complexity migration cap");
}

function assertCclspProxyWiring(config) {
  const javascriptServer = config.servers?.find((server) => server.extensions?.includes("mjs"));
  assert(javascriptServer, ".claude/cclsp.json must map .mjs files");
  assert(
    javascriptServer.command?.includes("scripts/cclsp-language-id-proxy.mjs"),
    ".claude/cclsp.json must route JS-family LSP through cclsp-language-id-proxy.mjs"
  );
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function disabledBiomeRulePaths(value, path = "linter.rules") {
  if (!value || typeof value !== "object") {
    return [];
  }
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (child === "off") {
      out.push(nextPath);
      continue;
    }
    if (child && typeof child === "object") {
      out.push(...disabledBiomeRulePaths(child, nextPath));
    }
  }
  return out;
}
