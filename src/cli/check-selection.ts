import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { checkMigrationSql } from "../check/migration.js";
import {
  CHECK_REPORTER_DISPLAY,
  type FileDiagnostics,
  parseCheckReporter,
  renderCheckReport,
} from "../check/report.js";
import {
  formatConfigValidationDiagnostics,
  pendingInstallPathConfirmationDiagnostic,
} from "../config/validate.js";
import { hasErrors } from "../diagnostics/diagnostics.js";
import { migrationFiles } from "../migrations/files.js";
import type { SupaschemaConfig } from "../types.js";
import { currentConfigPath, loadCliConfig, readStdin } from "./runtime.js";

export interface CheckCommandOptions {
  allowEmpty?: boolean;
  base?: string;
  changed?: boolean;
  reporter: string;
  since?: string;
  staged?: boolean;
}

interface CheckMigrationInput {
  file: string;
  gitRoot?: string;
  staged: boolean;
}

type CheckSelectionMode =
  | { kind: "base"; ref: string }
  | { kind: "changed" }
  | { kind: "since"; ref: string }
  | { kind: "staged" };

const execFileAsync = promisify(execFile);

export async function runCheckCommand(
  migrationArgs: string[],
  options: CheckCommandOptions
): Promise<void> {
  const config = await loadCliConfig();
  const selectionMode = checkSelectionMode(options);
  if (await blockInvalidCheckSelection(migrationArgs, options, selectionMode)) {
    return;
  }
  const migrationInputs = await resolveCheckMigrationPaths(config, migrationArgs, selectionMode);
  if (
    writeEmptyCheckSelection(config, migrationInputs, selectionMode, options.allowEmpty === true)
  ) {
    return;
  }
  const results = await checkMigrationPaths(config, migrationInputs);
  writeCheckResults(migrationInputs, results, options.reporter);
}

async function blockInvalidCheckSelection(
  migrationArgs: string[],
  options: CheckCommandOptions,
  selectionMode: CheckSelectionMode | undefined
): Promise<boolean> {
  if (selectionMode !== undefined && migrationArgs.length > 0) {
    process.stderr.write(
      "supaschema: check git-selection flags cannot be combined with explicit migration files\n"
    );
    process.exitCode = 1;
    return true;
  }
  if (hasConflictingCheckSelection(options)) {
    process.stderr.write("supaschema: use only one of --changed, --staged, --base, or --since\n");
    process.exitCode = 1;
    return true;
  }
  if (migrationArgs.length > 0) {
    return false;
  }
  const pendingInstall = await pendingInstallPathConfirmationDiagnostic(
    process.cwd(),
    currentConfigPath()
  );
  if (!pendingInstall) {
    return false;
  }
  process.stderr.write(formatConfigValidationDiagnostics([pendingInstall]));
  process.exitCode = 2;
  return true;
}

async function resolveCheckMigrationPaths(
  config: SupaschemaConfig,
  migrationArgs: string[],
  selectionMode: CheckSelectionMode | undefined
): Promise<CheckMigrationInput[]> {
  if (migrationArgs.length > 0) {
    return migrationArgs.map((file) => ({ file, staged: false }));
  }
  if (selectionMode === undefined) {
    return (await migrationFiles(resolve(process.cwd(), config.migrationsDir))).map((file) => ({
      file,
      staged: false,
    }));
  }
  return await selectedCheckMigrationPaths(config, selectionMode);
}

function writeEmptyCheckSelection(
  config: SupaschemaConfig,
  migrationInputs: CheckMigrationInput[],
  selectionMode: CheckSelectionMode | undefined,
  allowEmpty: boolean
): boolean {
  if (migrationInputs.length > 0) {
    return false;
  }
  process.stderr.write(
    selectionMode === undefined
      ? `no migrations found in ${config.migrationsDir}\n`
      : `no selected migration files found in ${config.migrationsDir}\n`
  );
  if (!allowEmpty) {
    process.exitCode = 1;
  }
  return true;
}

async function checkMigrationPaths(
  config: SupaschemaConfig,
  migrationInputs: CheckMigrationInput[]
): Promise<FileDiagnostics[]> {
  const results: FileDiagnostics[] = [];
  for (const input of migrationInputs) {
    const sql = await readCheckMigrationSql(input);
    const diagnostics = await checkMigrationSql(sql, { config, cwd: process.cwd() });
    results.push({ diagnostics, file: input.file === "-" ? "<stdin>" : input.file });
  }
  return results;
}

async function readCheckMigrationSql(input: CheckMigrationInput): Promise<string> {
  if (input.file === "-") {
    return await readStdin();
  }
  if (input.staged) {
    if (input.gitRoot === undefined) {
      throw new Error("supaschema check staged selection requires a git worktree");
    }
    const gitPath = normalizeGitPath(relative(input.gitRoot, input.file));
    return await gitOutput(["show", `:${gitPath}`], input.gitRoot);
  }
  return await readFile(input.file, "utf8");
}

function writeCheckResults(
  migrationInputs: CheckMigrationInput[],
  results: FileDiagnostics[],
  reporterName: string
): void {
  const reporter = parseCheckReporter(reporterName);
  if (reporter === undefined) {
    process.stderr.write(
      `supaschema: unknown --reporter "${reporterName}" (use ${CHECK_REPORTER_DISPLAY})\n`
    );
    process.exitCode = 2;
    return;
  }
  const report = renderCheckReport(reporter, results);
  if (report.length > 0) {
    process.stdout.write(report);
  }
  if (results.some((entry) => hasErrors(entry.diagnostics))) {
    process.exitCode = 2;
    return;
  }
  if (reporter === "text") {
    const fileCount = migrationInputs.length;
    process.stdout.write(fileCount > 1 ? `ok (${fileCount} files)\n` : "ok\n");
  }
}

function checkSelectionMode(options: CheckCommandOptions): CheckSelectionMode | undefined {
  if (options.changed === true) {
    return { kind: "changed" };
  }
  if (options.staged === true) {
    return { kind: "staged" };
  }
  if (options.base !== undefined) {
    return { kind: "base", ref: options.base };
  }
  if (options.since !== undefined) {
    return { kind: "since", ref: options.since };
  }
}

function hasConflictingCheckSelection(options: CheckCommandOptions): boolean {
  return (
    [
      options.changed === true,
      options.staged === true,
      options.base !== undefined,
      options.since !== undefined,
    ].filter(Boolean).length > 1
  );
}

async function selectedCheckMigrationPaths(
  config: SupaschemaConfig,
  mode: CheckSelectionMode
): Promise<CheckMigrationInput[]> {
  const gitRoot = await gitRootPath();
  const migrationsDir = migrationDirGitPath(gitRoot, config);
  let selected: string[];
  if (mode.kind === "changed") {
    selected = await changedGitCheckPaths(gitRoot, migrationsDir);
  } else if (mode.kind === "staged") {
    selected = await namedGitDiffCheckPaths(gitRoot, ["diff", "--cached"], migrationsDir);
  } else {
    selected = await namedGitDiffCheckPaths(gitRoot, ["diff", mode.ref], migrationsDir);
  }
  const unique = [
    ...new Set(selected.filter((item) => isSelectedMigrationPath(item, migrationsDir))),
  ];
  unique.sort((left, right) => left.localeCompare(right));
  return unique.map((item) => ({
    file: resolve(gitRoot, item),
    gitRoot,
    staged: mode.kind === "staged",
  }));
}

async function gitRootPath(): Promise<string> {
  const root = (await gitOutput(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  if (root.length === 0) {
    throw new Error("supaschema check git selection requires a git worktree");
  }
  return resolvedNativePath(root);
}

function migrationDirGitPath(gitRoot: string, config: SupaschemaConfig): string {
  const migrationsDir = resolvedNativePath(resolve(process.cwd(), config.migrationsDir));
  const relativePath = relative(gitRoot, migrationsDir);
  if (!isPathInsideOrEqual(gitRoot, migrationsDir)) {
    throw new Error("supaschema check migrationsDir must be inside the git worktree");
  }
  if (!(relativePath.startsWith("..") || isAbsolute(relativePath))) {
    return normalizeGitPath(relativePath);
  }
  return normalizedInsidePath(gitRoot, migrationsDir);
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const parentPath = comparablePath(parent);
  const childPath = comparablePath(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function normalizedInsidePath(parent: string, child: string): string {
  const parentPath = comparablePath(parent);
  const childPath = comparablePath(child);
  if (childPath === parentPath) {
    return "";
  }
  return childPath.slice(parentPath.length + 1);
}

function comparablePath(path: string): string {
  let normalized = nativeGitPath(path).replaceAll("\\", "/");
  if (normalized.startsWith("//?/")) {
    normalized = normalized.slice(4);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

function resolvedNativePath(path: string): string {
  const resolved = resolve(nativeGitPath(path));
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function nativeGitPath(path: string): string {
  if (process.platform !== "win32") {
    return path;
  }
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.length < 3 ||
    normalized[0] !== "/" ||
    normalized[2] !== "/" ||
    !isAsciiLetter(normalized.charCodeAt(1))
  ) {
    return path;
  }
  return `${normalized[1]}:/${normalized.slice(3)}`;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

async function namedGitDiffCheckPaths(
  gitRoot: string,
  args: string[],
  migrationsDir: string
): Promise<string[]> {
  const output = await gitOutput(
    [...args, "--name-only", "--diff-filter=ACMR", "--", migrationsDir || "."],
    gitRoot
  );
  return output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeGitPath);
}

async function changedGitCheckPaths(gitRoot: string, migrationsDir: string): Promise<string[]> {
  const output = await gitOutput(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", migrationsDir || "."],
    gitRoot
  );
  return parsePorcelainStatusPaths(output).map(normalizeGitPath);
}

function parsePorcelainStatusPaths(output: string): string[] {
  const entries = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  let skipRenameSource = false;
  for (const entry of entries) {
    if (skipRenameSource) {
      skipRenameSource = false;
      continue;
    }
    const x = entry.at(0) ?? " ";
    const y = entry.at(1) ?? " ";
    const path = entry.slice(3);
    if (x !== "D" && y !== "D" && path.length > 0) {
      paths.push(path);
    }
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      skipRenameSource = true;
    }
  }
  return paths;
}

function isSelectedMigrationPath(path: string, migrationsDir: string): boolean {
  if (extname(path).toLowerCase() !== ".sql") {
    return false;
  }
  return migrationsDir.length === 0 || path.startsWith(`${migrationsDir}/`);
}

function normalizeGitPath(path: string): string {
  let normalized = path.split(sep).join("/");
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized === "." ? "" : normalized;
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return stdout;
  } catch (error) {
    const stderr =
      error !== null && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr || "supaschema check git selection failed", { cause: error });
  }
}
