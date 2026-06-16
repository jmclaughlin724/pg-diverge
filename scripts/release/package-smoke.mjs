#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = process.cwd();
const PACKAGE_NAME = "supaschema";

if (process.argv.length > 2) {
  fail(`unknown package-smoke arguments: ${process.argv.slice(2).join(" ")}`);
}

const packageJson = readJson(join(ROOT, "package.json"));
const packageVersion = packageJson.version;
const nodeBinDir = dirname(process.execPath);
const tarball = resolveTarball();
const tools = {
  bun: detectTool("bun", ["--version"], createProbe("bun", { packageManager: "bun@1.3.14" })),
  npm: detectTool("npm", ["--version"], ROOT),
  pnpm: detectTool("pnpm", ["--version"], createProbe("pnpm", { packageManager: "pnpm@10.18.1" })),
  yarn: detectTool("yarn", ["--version"], createProbe("yarn", { packageManager: "yarn@4.12.0" })),
};

const skipped = [];
const completed = [];

runLane("npm root install", tools.npm, smokeNpmRoot);
runLane("npm workspace member install", tools.npm, smokeNpmWorkspaceMember);
runLane("pnpm approved root install", tools.pnpm, smokePnpmRoot);
runLane("pnpm workspace member init recovery", tools.pnpm, smokePnpmWorkspaceMember);
runLane("Yarn workspace member install", tools.yarn, smokeYarnWorkspaceMember);
runLane("Bun trusted root install", tools.bun, smokeBunRoot);
runLane("Bun workspace member init recovery", tools.bun, smokeBunWorkspaceMember);

if (skipped.length > 0) {
  fail(`missing required package manager lanes: ${skipped.join(", ")}`);
}

console.log(`PACKAGE_SMOKE_OK completed=${completed.length} skipped=${skipped.length}`);

function smokeNpmRoot() {
  const consumer = createProject("supa-smoke-npm-root-", "supaschema-npm-root");
  runNpm(["install", tarball, "--prefer-offline", "--no-audit", "--no-fund"], consumer);
  assertGenericScaffold(consumer);
  assertVersion((args, cwd) => runNpm(["exec", "--", PACKAGE_NAME, ...args], cwd), consumer);
}

function smokeNpmWorkspaceMember() {
  const { member, root } = createWorkspace("supa-smoke-npm-workspace-", {
    packageManager: `npm@${tools.npm.version}`,
    workspaces: ["packages/*"],
  });
  runNpm(["install", tarball, "--prefer-offline", "--no-audit", "--no-fund"], member);
  assertNoRootScaffold(root);
  assertGenericScaffold(member);
  assertVersion((args, cwd) => runNpm(["exec", "--", PACKAGE_NAME, ...args], cwd), member);
}

function smokePnpmRoot() {
  const consumer = createProject("supa-smoke-pnpm-root-", "supaschema-pnpm-root", {
    packageManager: "pnpm@10.18.1",
  });
  runTool("pnpm", ["add", "--allow-build=supaschema", tarball], consumer);
  assertGenericScaffold(consumer);
  assertVersion((args, cwd) => runTool("pnpm", ["exec", PACKAGE_NAME, ...args], cwd), consumer);
}

function smokePnpmWorkspaceMember() {
  const { member, root } = createWorkspace("supa-smoke-pnpm-workspace-", {
    packageManager: "pnpm@10.18.1",
    workspaceFile: "packages:\n  - packages/*\n",
  });
  runTool("pnpm", ["add", "--ignore-scripts", tarball], member);
  assertNoRootScaffold(root);
  assertNoScaffold(member, "pnpm workspace member should wait for explicit init");
  runTool("pnpm", ["exec", PACKAGE_NAME, "init"], member);
  assertNoRootScaffold(root);
  assertGenericScaffold(member);
  assertVersion((args, cwd) => runTool("pnpm", ["exec", PACKAGE_NAME, ...args], cwd), member);
}

function smokeYarnWorkspaceMember() {
  const { member, root } = createWorkspace("supa-smoke-yarn-workspace-", {
    packageManager: "yarn@4.12.0",
    workspaces: ["packages/*"],
  });
  runTool("yarn", ["add", tarball], member);
  assertNoRootScaffold(root);
  assertGenericScaffold(member);
  assertVersion((args, cwd) => runTool("yarn", ["exec", PACKAGE_NAME, ...args], cwd), member);
}

function smokeBunRoot() {
  const consumer = createProject("supa-smoke-bun-root-", "supaschema-bun-root", {
    packageManager: "bun@1.3.14",
  });
  runTool("bun", ["add", "--trust", tarball], consumer);
  assertGenericScaffold(consumer);
  assertVersion(
    (args, cwd) => runTool("bun", ["x", "--no-install", PACKAGE_NAME, ...args], cwd),
    consumer
  );
}

function smokeBunWorkspaceMember() {
  const { member, root } = createWorkspace("supa-smoke-bun-workspace-", {
    packageManager: "bun@1.3.14",
    workspaces: ["packages/*"],
  });
  runTool("bun", ["add", tarball], member);
  assertNoRootScaffold(root);
  assertNoScaffold(member, "Bun workspace member should wait for explicit init");
  runTool("bun", ["x", "--no-install", PACKAGE_NAME, "init"], member);
  assertNoRootScaffold(root);
  assertGenericScaffold(member);
  assertVersion(
    (args, cwd) => runTool("bun", ["x", "--no-install", PACKAGE_NAME, ...args], cwd),
    member
  );
}

function runLane(name, tool, lane) {
  if (!tool.available) {
    skipped.push(`${name} (${tool.reason})`);
    console.log(`package-smoke: skip ${name}: ${tool.reason}`);
    return;
  }

  lane();
  completed.push(name);
  console.log(`package-smoke: ok ${name}`);
}

function assertVersion(runner, cwd) {
  const output = runner(["--version"], cwd).trim();
  assert(output === packageVersion, `expected ${PACKAGE_NAME} ${packageVersion}, got ${output}`);
}

function assertGenericScaffold(dir) {
  assertExists(join(dir, "supaschema.config.json"));
  assertExists(join(dir, "database", "schemas"));
  assertExists(join(dir, "database", "migrations"));
  const config = readJson(join(dir, "supaschema.config.json"));
  assert(
    JSON.stringify(config.schemaPaths) === JSON.stringify(["database/schemas"]),
    `${dir} schemaPaths did not use generic layout`
  );
  assert(
    config.migrationsDir === "database/migrations",
    `${dir} migrationsDir did not use generic layout`
  );
}

function assertNoRootScaffold(root) {
  assertNoScaffold(root, "workspace root must not be scaffolded");
}

function assertNoScaffold(dir, message) {
  assert(!existsSync(join(dir, "supaschema.config.json")), `${message}: ${dir}`);
}

function createWorkspace(prefix, options) {
  const root = createTemp(prefix);
  const member = join(root, "packages", "db");
  mkdirSync(member, { recursive: true });
  writeJson(join(root, "package.json"), {
    name: `${prefix}root`,
    packageManager: options.packageManager,
    private: true,
    version: "0.0.0",
    workspaces: options.workspaces,
  });
  if (options.workspaceFile) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), options.workspaceFile);
  }
  writeJson(join(member, "package.json"), {
    name: "db",
    private: true,
    version: "0.0.0",
  });
  return { member, root };
}

function createProject(prefix, name, extra = {}) {
  const dir = createTemp(prefix);
  writeJson(join(dir, "package.json"), {
    name,
    private: true,
    version: "0.0.0",
    ...extra,
  });
  return dir;
}

function createProbe(prefix, extra = {}) {
  return createProject(`supa-smoke-${prefix}-probe-`, `supaschema-${prefix}-probe`, extra);
}

function resolveTarball() {
  if (process.env.SUPASCHEMA_TARBALL) {
    const configured = resolve(process.env.SUPASCHEMA_TARBALL);
    assertExists(configured);
    return configured;
  }

  const packDir = createTemp("supa-smoke-pack-");
  const output = runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir],
    ROOT
  );
  const [packed] = JSON.parse(output);
  assert(packed?.filename, "npm pack did not return a filename");
  const packedPath = join(packDir, packed.filename);
  assertExists(packedPath);
  return packedPath;
}

function detectTool(name, args, cwd) {
  try {
    const version = runRaw(commandName(name), args, cwd).trim();
    if (name === "yarn" && !version.startsWith("4.")) {
      return {
        available: false,
        reason: `expected Yarn 4.x, found ${version}`,
        version,
      };
    }
    return { available: true, reason: "", version };
  } catch (error) {
    return {
      available: false,
      reason: error.message,
      version: "",
    };
  }
}

function runNpm(args, cwd) {
  const execpath = process.env.npm_execpath;
  return execpath
    ? runRaw(process.execPath, [execpath, ...args], cwd)
    : runRaw(commandName("npm"), args, cwd);
}

function runTool(name, args, cwd) {
  return runRaw(commandName(name), args, cwd);
}

function runRaw(file, args, cwd) {
  try {
    return execFileSync(file, args, {
      cwd,
      env: childEnv(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? "";
    const stderr = error.stderr?.toString?.() ?? "";
    const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
    const suffix = detail.length > 0 ? `\n${detail}` : "";
    throw new Error(`command failed in ${cwd}: ${file} ${args.join(" ")}${suffix}`);
  }
}

function commandName(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const nodeShim = join(nodeBinDir, executable);
  return existsSync(nodeShim) ? nodeShim : executable;
}

function childEnv() {
  const env = { ...process.env };
  env.INIT_CWD = undefined;
  return env;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createTemp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function assertExists(path) {
  assert(existsSync(path), `expected ${path} to exist`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function fail(message) {
  console.error(`PACKAGE_SMOKE_FAILED ${message}`);
  process.exit(1);
}
