#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../../.claude/hooks/guards/bash-policy-checks.mjs";
import { publicSkillNames } from "../../skills/sync-llm.mjs";
import { assert, ok } from "../lib/assertions.js";
import { exists, gitFiles, ROOT, readJson, readText } from "../lib/repository.js";
import { forEachNode, parseScript, ts } from "../lib/typescript-ast.js";

const exactlyPinnedTools = [
  "@biomejs/biome",
  "@vitest/coverage-v8",
  "cclsp",
  "prettier",
  "ultracite",
  "vitest",
];
const aliasPins = {
  "@typescript/native": "npm:typescript@7.0.2",
};
const allowedRootDisabledBiomeRules = new Set([
  "linter.rules.performance.noAwaitInLoops",
  "linter.rules.style.useDestructuring",
  "linter.rules.suspicious.noMisplacedAssertion",
  "linter.rules.suspicious.noShadow",
  "linter.rules.suspicious.noUnnecessaryConditions",
]);
const extractedWorkflowBiomeExclusions = [
  "!.claude/skills/code-review/references/workflow-backed-code-review.js",
  "!.claude/skills/deep-research/references/workflow-backed-deep-research.js",
];
const expectedBiomeExclusions = [
  "!dist",
  "!node_modules",
  "!.venv",
  "!coverage",
  "!.tmp",
  "!**/.tmp",
  "!.wrangler",
  "!*.tgz",
  "!supaschema-config.schema.json",
  "!database.types.ts",
  "!database.zod.ts",
  "!api-docs",
  "!benchmarks/results",
  "!.gitnexus",
  "!.claude/worktrees",
  ...extractedWorkflowBiomeExclusions,
  "!agent-bundle",
  "!tests/fixtures/sample-project/supabase/functions",
  "!.agents",
  "!.codex",
];
const ultraciteWriteCommands = new Set(["check", "fix"]);

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

function moduleSpecifierFlags(file, root) {
  const source = parseScript(readText(file, root), file);
  const flags = { generatedDist: false, relativeTs: false };
  const visitSpecifier = (value) => {
    if (isRelativeTsModuleSpecifier(value)) {
      flags.relativeTs = true;
    }
    if (isGeneratedDistModuleSpecifier(value)) {
      flags.generatedDist = true;
    }
  };
  forEachNode(source, (node) => {
    visitSpecifier(staticModuleSpecifier(node));
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (ts.isStringLiteral(argument)) {
        visitSpecifier(argument.text);
      }
    }
  });
  return flags;
}

function assertAgentPackageSurface(files) {
  assert(files.includes("agent-bundle"), "package.json must publish raw agent-bundle files");

  for (const file of files) {
    const isAgentSurface =
      file === "AGENTS.md" ||
      file.startsWith(".agents/") ||
      file.startsWith(".claude/") ||
      file.startsWith(".codex/");
    assert(!isAgentSurface, `package.json must not publish active agent surface ${file}`);
  }
}

function assertRuntimePackageSurface(files) {
  assert(!files.includes("bin"), "package.json must list bin helper files, not the whole bin/");
  assert(
    files.includes("bin/config-contract.mjs") && files.includes("bin/scaffold.mjs"),
    "package.json must publish only the required bin helper files"
  );

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

function isJavascriptSourceFile(file) {
  return [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(path.extname(file));
}

function isExactVersion(spec) {
  const segments = spec.split(".");
  if (segments.length < 3) {
    return false;
  }
  const [major, minor] = segments;
  const [patch] = segments.slice(2).join(".").split("-");
  return [major, minor, patch].every(isNumericSegment);
}

function isNumericSegment(value) {
  return value.length > 0 && [...value].every((char) => char >= "0" && char <= "9");
}

function isGeneratedDistModuleSpecifier(value) {
  return (
    typeof value === "string" &&
    value.startsWith(".") &&
    value.split("/").some((segment) => segment === "dist")
  );
}

function unwrappedPackageRunnerCommand(words) {
  const name = commandName(words);
  const args = commandArgs(words);
  if (name === "npx") {
    return args[0] === "--no-install" ? args.slice(1) : args;
  }
  if (name === "npm" && args[0] === "exec") {
    return args[1] === "--" ? args.slice(2) : args.slice(1);
  }
  return words;
}

function invokesDirectBiomeOrUltracite(command) {
  return commandSegmentObjects(command).some((segment) => {
    const words = unwrappedPackageRunnerCommand(segment.words);
    const name = commandName(words);
    const args = commandArgs(words);
    return name === "biome" || (name === "ultracite" && ultraciteWriteCommands.has(args[0]));
  });
}

function assertUltraciteEntryPoints(packageJson, lefthook, root) {
  assert(exists("scripts/lint.mjs", root), "npm-owned Ultracite lint wrapper must exist");
  assert(exists("scripts/format.mjs", root), "npm-owned Ultracite format wrapper must exist");
  assert(
    packageJson.scripts?.format === "node scripts/format.mjs",
    "format must route every writer through the npm-owned format wrapper"
  );
  assert(
    packageJson.scripts?.lint === "node scripts/lint.mjs",
    "lint must route Ultracite through the npm-owned lint wrapper"
  );
  assert(
    packageJson.scripts?.["lint:ci"] === "node scripts/lint.mjs --ci",
    "lint:ci must route the CI reporter through the npm-owned lint wrapper"
  );
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    assert(
      !invokesDirectBiomeOrUltracite(String(command)),
      `package script ${name} must route Biome and Ultracite check/fix through the npm-owned lint/format wrappers`
    );
  }
  assert(
    packageJson.scripts?.["lint:doctor"] === "ultracite doctor",
    "lint:doctor must run Ultracite doctor"
  );
  assert(
    packageJson.scripts?.["bench:plot:headtohead"]?.endsWith(
      " && npm run format -- docs/images/benchmarks"
    ),
    "bench:plot:headtohead must format generated benchmark SVGs through the scoped npm wrapper"
  );
  assert(
    packageJson.scripts?.diagrams?.endsWith(" && npm run format -- docs/images/concepts"),
    "diagrams must format generated concept SVGs through the scoped npm wrapper"
  );

  const preCommitJobs = lefthook?.["pre-commit"]?.jobs ?? [];
  const ultraciteHook = preCommitJobs.find((job) => job?.name === "Ultracite");
  assert(
    ultraciteHook?.run === "npm run format -- --staged" && ultraciteHook.stage_fixed === true,
    "lefthook Ultracite pre-commit job must run npm run format -- --staged with stage_fixed: true"
  );
  const prettierHook = preCommitJobs.find((job) => job?.name === "prettier");
  assert(
    prettierHook?.run === "npx --no-install prettier --write {staged_files}" &&
      prettierHook.stage_fixed === true,
    "lefthook Prettier job must use the pinned local binary with --no-install and stage_fixed: true"
  );
  for (const job of preCommitJobs) {
    assert(
      !invokesDirectBiomeOrUltracite(String(job?.run ?? "")),
      `lefthook pre-commit job ${job?.name ?? "(unnamed)"} must route Biome and Ultracite through npm scripts`
    );
  }
  assertMirrorSyncOrdering(lefthook, preCommitJobs);
}

function assertMirrorSyncOrdering(lefthook, preCommitJobs) {
  assert(
    lefthook?.["pre-commit"]?.piped === true,
    "lefthook pre-commit must run piped so the mirror sync job observes formatter output and is skipped on failure"
  );
  const lastJob = preCommitJobs.at(-1);
  assert(
    lastJob?.name === "sync-agent-surfaces",
    "lefthook pre-commit must end with the sync-agent-surfaces job so mirrors regenerate after every stage_fixed formatter"
  );
  const syncRun = String(lastJob?.run ?? "");
  assert(
    syncRun.includes("npm run sync:llm"),
    "sync-agent-surfaces must regenerate mirrors through npm run sync:llm"
  );
  assert(
    syncRun.includes(expectedMirrorAddCommand()),
    `sync-agent-surfaces must stage exactly the generator-owned output trees: ${expectedMirrorAddCommand()}`
  );
  assert(
    syncRun.includes("git diff --quiet -- .claude docs scripts/skills"),
    "sync-agent-surfaces must refuse to regenerate while agent-surface source paths carry unstaged edits"
  );
  assert(
    syncRun.includes("git ls-files --others --exclude-standard -- .claude docs scripts/skills"),
    "sync-agent-surfaces must refuse to regenerate while agent-surface source paths carry untracked files"
  );
  for (const job of preCommitJobs.slice(0, -1)) {
    assert(
      job?.stage_fixed === true,
      `lefthook pre-commit job ${job?.name ?? "(unnamed)"} must use stage_fixed so the trailing sync job sees re-staged formatter output`
    );
  }
}

function expectedMirrorAddCommand() {
  const skillTrees = publicSkillNames.map((name) => `skills/${name}`);
  return [
    "git add .agents/skills .codex",
    ...skillTrees,
    "agent-bundle/agents",
    "agent-bundle/claude",
    "agent-bundle/codex",
    "agent-bundle/docs",
    "agent-bundle/skills-manifest.json",
  ].join(" ");
}

function assertBiomeLanguageSurface(biome) {
  assert(
    biome.files?.includes?.includes("!.claude/worktrees"),
    "biome.jsonc must exclude .claude/worktrees so the host lint lane does not traverse nested checkout configs"
  );
  const claudeSkillExclusions = (biome.files?.includes ?? [])
    .filter((include) => include.startsWith("!.claude/skills"))
    .sort();
  assert(
    JSON.stringify(claudeSkillExclusions) === JSON.stringify(extractedWorkflowBiomeExclusions),
    "biome.jsonc may exclude only the two exact binary-extracted workflow JavaScript files under .claude/skills"
  );
  const exclusions = (biome.files?.includes ?? []).filter((include) => include.startsWith("!"));
  assert(
    JSON.stringify([...exclusions].sort()) === JSON.stringify([...expectedBiomeExclusions].sort()),
    "biome.jsonc exclusions must match the exact reviewed generated, state, nested-worktree, and extracted-workflow boundary"
  );
  assert(
    biome.vcs?.useIgnoreFile === true,
    "biome.jsonc must keep VCS ignore handling enabled for the Git-visible lint lane"
  );
  assert(
    biome.html?.experimentalFullSupportEnabled === true,
    "biome.jsonc must enable full HTML formatting and lint support"
  );
  assert(
    biome.javascript?.experimentalEmbeddedSnippetsEnabled === true,
    "biome.jsonc must enable embedded CSS and GraphQL snippet support"
  );
}

function assertNoDisabledBiomeRules(value, rulePath = "linter.rules", allowedDisabled = new Set()) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${rulePath}.${key}`;
    if (child === "off") {
      if (allowedDisabled.has(nextPath)) {
        continue;
      }
      assert(false, `biome.jsonc must not disable ${nextPath}`);
    }
    if (child && typeof child === "object") {
      assertNoDisabledBiomeRules(child, nextPath, allowedDisabled);
    }
  }
}

function assertBiomeOverrides(overrides) {
  const allowedDisabled = new Map([
    ["src/index.ts", new Set(["linter.rules.performance.noBarrelFile"])],
  ]);
  for (const override of overrides) {
    const includes = override.includes ?? [];
    const disabledPaths = disabledBiomeRulePaths(override.linter?.rules ?? {});
    for (const disabledPath of disabledPaths) {
      for (const include of includes) {
        if (allowedDisabled.get(include)?.has(disabledPath)) {
          continue;
        }
        assert(false, `biome.jsonc override for ${include} must not disable ${disabledPath}`);
      }
    }

    const complexityRule = override.linter?.rules?.complexity?.noExcessiveCognitiveComplexity;
    assert(
      complexityRule === undefined,
      "biome.jsonc must inherit Ultracite noExcessiveCognitiveComplexity without a migration cap"
    );

    const isAllowedBarrelOverride = includes.length === 1 && includes[0] === "src/index.ts";
    assert(
      isAllowedBarrelOverride,
      `biome.jsonc override is not allowed for ${includes.join(", ") || "(none)"}`
    );
  }
}

function assertCclspWiring(config) {
  const pythonServer = config.servers?.find((server) => server.extensions?.includes("py"));
  assert(pythonServer, "cclsp.json must map .py files");
  assert(
    JSON.stringify(pythonServer.command) === JSON.stringify(["uv", "run", "pylsp"]),
    "cclsp.json must run pylsp from the locked uv workspace"
  );
  assert(pythonServer.restartInterval === 5, "cclsp.json must auto-restart pylsp every 5 minutes");
  const pylspInitializationOptions = pythonServer.initializationOptions?.pylsp;
  assert(
    typeof pylspInitializationOptions === "object" &&
      pylspInitializationOptions !== null &&
      !Array.isArray(pylspInitializationOptions) &&
      pythonServer.initializationOptions?.settings === undefined,
    "cclsp.json must pass pylsp settings as an object directly through initializationOptions.pylsp"
  );

  const javascriptServer = config.servers?.find((server) => server.extensions?.includes("mjs"));
  assert(javascriptServer, "cclsp.json must map .mjs files");
  assert(
    JSON.stringify(javascriptServer.command) ===
      JSON.stringify([
        "node",
        "scripts/cclsp-language-id-proxy.mjs",
        "--",
        "npx",
        "--no-install",
        "typescript-language-server",
        "--stdio",
      ]),
    "cclsp.json must route JS-family LSP through the local TypeScript proxy and server"
  );
  assert(
    javascriptServer.initializationOptions?.tsserver?.path === undefined,
    "cclsp.json must let the TypeScript proxy inject the tsserver path"
  );
  for (const server of config.servers ?? []) {
    assert(
      !server.extensions?.some((extension) => extension === "ql" || extension === "qll"),
      "cclsp.json must not expose an unowned CodeQL language server"
    );
    const command = server.command ?? [];
    if (command[0] === "uv" || command.includes("scripts/cclsp-language-id-proxy.mjs")) {
      continue;
    }
    assert(
      command[0] === "npx" && command[1] === "--no-install",
      "cclsp.json Node language servers must use repository-installed npx --no-install binaries"
    );
    assert(
      !(command.includes("--package") || command.includes("--yes") || command.includes("-y")) &&
        command.slice(2).every((part) => !part.includes("@")),
      "cclsp.json must not duplicate package versions or request runtime installation"
    );
  }
}

function disabledBiomeRulePaths(value, rulePath = "linter.rules") {
  if (!value || typeof value !== "object") {
    return [];
  }
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${rulePath}.${key}`;
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

export function check(root = ROOT) {
  const packageJson = readJson("package.json", root);
  const biome = readJson("biome.jsonc", root);
  const gitignore = readText(".gitignore", root);
  const lefthook = parseYaml(readText("lefthook.yml", root));
  const vitestConfig = readText("vitest.config.ts", root);

  assert(exists("package-lock.json", root), "npm package-lock.json must exist");
  assert(!exists("pnpm-lock.yaml", root), "pnpm lockfile must not be introduced");
  assert(!exists("yarn.lock", root), "Yarn lockfile must not be introduced");
  assert(!exists("bun.lockb", root), "Bun lockfile must not be introduced");
  assert(
    !exists(".npmignore", root),
    "package boundary must use package.json files allowlist, not root .npmignore"
  );
  assert(!exists("biome.json", root), "Biome config must be biome.jsonc");
  assert(exists("biome.jsonc", root), "missing biome.jsonc");
  assert(exists("prettier.config.mjs", root), "missing prettier.config.mjs");
  assert(exists("cclsp.json", root), "tracked source-repository cclsp.json must exist");
  assert(
    !gitignore.split("\n").some((line) => line.trim() === "cclsp.json"),
    "tracked source-repository cclsp.json must not be ignored"
  );
  const prettierConfig = readText("prettier.config.mjs", root);
  assert(Array.isArray(packageJson.files), "package.json must define a files allowlist");
  assert(
    exists("scripts/cclsp-language-id-proxy.mjs", root),
    "cclsp language-id proxy must exist for .mjs/.cjs TypeScript LSP support"
  );
  for (const name of exactlyPinnedTools) {
    const spec = packageJson.devDependencies?.[name];
    assert(
      typeof spec === "string" && isExactVersion(spec),
      `package.json must pin ${name} to an exact version, found ${spec ?? "no entry"}`
    );
  }
  for (const [name, spec] of Object.entries(aliasPins)) {
    assert(packageJson.devDependencies?.[name] === spec, `package.json must pin ${name}@${spec}`);
  }
  assert(
    packageJson.devDependencies?.vitest === packageJson.devDependencies?.["@vitest/coverage-v8"],
    "package.json must keep vitest and @vitest/coverage-v8 on the same version"
  );
  assert(
    packageJson.dependencies?.typescript === "npm:@typescript/typescript6@6.0.2",
    "package.json must keep the TypeScript 6 compatibility package under the runtime typescript identity"
  );
  assert(
    !(
      "typescript-compiler-api" in (packageJson.dependencies ?? {}) ||
      "typescript-compiler-api" in (packageJson.devDependencies ?? {})
    ),
    "package.json must not expose the retired typescript-compiler-api alias"
  );
  assert(
    !("typescript" in (packageJson.devDependencies ?? {})),
    "package.json must keep TypeScript 7 under the @typescript/native development identity"
  );
  assert(
    packageJson.overrides?.cclsp?.typescript === "$typescript",
    "package.json must map cclsp's stale TypeScript peer to the canonical runtime typescript dependency"
  );
  assert(
    packageJson.overrides?.["@typescript/old"] === "npm:typescript@6.0.2",
    "package.json must pin the compatibility package's nested TypeScript compiler to 6.0.2"
  );
  assert(
    !("pg-formatter" in (packageJson.devDependencies ?? {})),
    "pg-formatter must not be reintroduced; SQL is governed by supaschema parser/deparser semantics"
  );

  assertUltraciteEntryPoints(packageJson, lefthook, root);
  assert(packageJson.scripts?.test === "vitest run", "test must run the full Vitest suite");
  assert(
    packageJson.scripts?.["test:coverage"] === "vitest run --coverage",
    "test:coverage must run the full Vitest suite with coverage"
  );
  assert(
    packageJson.scripts?.["test:examples"] ===
      "vitest run tests/examples/project.test.ts --maxWorkers=1",
    "test:examples must own the examples regression lane"
  );
  assert(
    packageJson.scripts?.["test:matrix"] === "vitest run --exclude tests/examples/project.test.ts",
    "test:matrix must exclude the examples lane from DB and OS matrices"
  );
  assert(
    packageJson.scripts?.["test:matrix:coverage"] ===
      "vitest run --coverage --exclude tests/examples/project.test.ts",
    "test:matrix:coverage must be the coverage equivalent of test:matrix"
  );
  assert(
    packageJson.scripts?.["format:md"] === 'prettier --write "**/*.{md,mdx,yml,yaml}"',
    "format:md must run Prettier write over MDX/Markdown/YAML"
  );
  assert(
    packageJson.scripts?.["format:md:check"] === 'prettier --check "**/*.{md,mdx,yml,yaml}"',
    "format:md:check must run the read-only Prettier check over the format:md glob"
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
    "py:fix must run ruff --fix then ruff format"
  );
  assert(
    !("lint:fix" in packageJson.scripts),
    "format must be the only repo-wide write/fix script"
  );
  assert(!("fix" in packageJson.scripts), "package.json must not expose a second fix writer");
  assert(
    !("prepare" in packageJson.scripts),
    "package.json must not install maintainer hooks through a lifecycle script"
  );
  const biomeSchemaVersion = packageJson.devDependencies?.["@biomejs/biome"];
  assert(
    biome.$schema === `https://biomejs.dev/schemas/${biomeSchemaVersion}/schema.json`,
    `biome.jsonc must use the Biome ${biomeSchemaVersion} schema`
  );
  const expectedBiomePresets = [
    "ultracite/biome/core",
    "ultracite/biome/type-aware",
    "ultracite/biome/vitest",
  ];
  assert(
    JSON.stringify(biome.extends) === JSON.stringify(expectedBiomePresets),
    `biome.jsonc must extend exactly ${expectedBiomePresets.join(", ")}`
  );
  for (const token of [
    'embeddedLanguageFormatting: "auto"',
    'endOfLine: "lf"',
    "printWidth: 80",
    'proseWrap: "never"',
    "tabWidth: 2",
    'trailingComma: "es5"',
    "useTabs: false",
  ]) {
    assert(prettierConfig.includes(token), `prettier.config.mjs missing ${token}`);
  }
  assert(
    biome.formatter?.lineWidth === 100,
    "biome.jsonc must preserve the 100-column formatter line width"
  );
  assertBiomeLanguageSurface(biome);
  assert(
    !biome.files?.includes?.includes("**"),
    'biome.jsonc must not duplicate Ultracite core\'s "**" include'
  );
  assert(
    biome.files?.includes?.includes("!agent-bundle"),
    "biome.jsonc must exclude generated agent-bundle files; npm run sync:llm:check owns that mirror"
  );
  assert(
    biome.linter?.rules?.correctness?.useImportExtensions?.level === "error",
    "Biome must enforce runtime import extensions"
  );
  assert(
    biome.linter?.rules?.correctness?.useImportExtensions?.options?.extensionMappings?.ts ===
      "js" &&
      biome.linter?.rules?.correctness?.useImportExtensions?.options?.extensionMappings?.tsx ===
        "js",
    "Biome must preserve emitted .js specifiers for NodeNext TypeScript"
  );
  assertNoDisabledBiomeRules(
    biome.linter?.rules ?? {},
    "linter.rules",
    allowedRootDisabledBiomeRules
  );
  assertBiomeOverrides(biome.overrides ?? []);
  assertAgentPackageSurface(packageJson.files ?? []);
  assertRuntimePackageSurface(packageJson.files ?? []);
  assertCclspWiring(readJson("cclsp.json", root));

  for (const file of gitFiles(root).filter(
    (candidate) => isJavascriptSourceFile(candidate) && exists(candidate, root)
  )) {
    const flags = moduleSpecifierFlags(file, root);
    if (file.endsWith(".ts")) {
      assert(
        !flags.relativeTs,
        `${file} must use emitted-runtime .js specifiers for relative imports`
      );
    }
    assert(
      !flags.generatedDist,
      `${file} must not import generated dist output from active source`
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("TOOLING_STACK_OK");
}
