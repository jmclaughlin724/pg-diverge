import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { lineagePrefix } from "./lineage.js";

const execFileAsync = promisify(execFile);

interface StageGeneratedMigrationsOptions {
  directory: string;
  dryRun?: boolean;
  requireGit?: boolean;
}

interface StageGeneratedMigrationsResult {
  skippedReason?: string;
  staged: string[];
  wouldStage: string[];
}

interface GitChangedPaths {
  paths: string[];
  root: string;
}

export async function stageGeneratedMigrations(
  options: StageGeneratedMigrationsOptions
): Promise<StageGeneratedMigrationsResult> {
  let changed: GitChangedPaths;
  try {
    changed = await changedGitPaths(options.directory);
  } catch (error) {
    if (options.requireGit === true) {
      throw error;
    }
    return { skippedReason: "not a git worktree", staged: [], wouldStage: [] };
  }
  const generated: string[] = [];
  for (const file of changed.paths) {
    if (await isGeneratedMigrationFile(file, changed.root)) {
      generated.push(file);
      const companion = concurrentCompanionPath(file);
      if (
        companion !== undefined &&
        changed.paths.includes(companion) &&
        !generated.includes(companion)
      ) {
        generated.push(companion);
      }
    }
  }
  if (options.dryRun === true) {
    return { staged: [], wouldStage: generated };
  }
  if (generated.length === 0) {
    return { staged: [], wouldStage: [] };
  }
  await execFileAsync("git", ["add", "--", ...generated], { cwd: changed.root });
  return { staged: generated, wouldStage: [] };
}

async function changedGitPaths(directory: string): Promise<GitChangedPaths> {
  try {
    const root = await realpath(
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).then((result) => result.stdout.trim())
    );
    const directoryPath = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
    const resolvedDirectoryPath = await realpath(directoryPath).catch(() => directoryPath);
    const gitPath = relative(root, resolvedDirectoryPath) || ".";
    if (gitPath.startsWith("..") || isAbsolute(gitPath)) {
      throw new Error("supaschema stage directory must be inside the git worktree");
    }
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", gitPath],
      { cwd: root, encoding: "utf8" }
    );
    return { paths: parsePorcelainStatusPaths(stdout), root };
  } catch (error) {
    throw new Error("supaschema stage requires a git worktree", { cause: error });
  }
}

function parsePorcelainStatusPaths(output: string): string[] {
  const entries = output.split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    index += 1;
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status.includes("D")) {
      continue;
    }
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    if (file.length > 0 && !paths.includes(file)) {
      paths.push(file);
    }
  }
  return paths;
}

async function isGeneratedMigrationFile(file: string, root = process.cwd()): Promise<boolean> {
  if (!file.endsWith(".sql")) {
    return false;
  }
  const filePath = isAbsolute(file) ? file : resolve(root, file);
  const contents = await readFile(filePath, "utf8").catch(() => undefined);
  return contents?.slice(0, 4096).includes(lineagePrefix) === true;
}

function concurrentCompanionPath(file: string): string | undefined {
  if (!file.endsWith(".sql") || file.endsWith(".concurrent.sql")) {
    return;
  }
  return `${file.slice(0, -".sql".length)}.concurrent.sql`;
}
