#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const editTools = new Set(["Edit", "MultiEdit", "Write", "apply_patch"]);
const lineageMarker = "-- supaschema: lineage ";
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || ".",
  );
  const schemaPaths = await readSchemaPaths(projectDir);
  const changed = editTargets(payload, projectDir).filter(
    (path) =>
      path.endsWith(".sql") &&
      schemaPaths.some((dir) => isInside(resolve(projectDir, dir), path)) &&
      !isGeneratedMigration(path),
  );
  if (changed.length === 0) {
    process.exit(0);
  }
  const bin = resolveBinary(projectDir);
  const diff = run(bin, ["diff"], projectDir);
  if (diff.code === 0) {
    const written = diff.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".sql"));
    if (written.length === 0) {
      emit(
        `supaschema: ${rel(projectDir, changed[0])} changed but produces no net schema change versus the current state — no migration written.`,
      );
    }
    const check = run(bin, ["check"], projectDir);
    const checkLine =
      check.code === 0
        ? "supaschema check passed (replay-safe)"
        : `supaschema check reported diagnostics:\n${head(check.stderr || check.stdout)}`;
    emit(
      `supaschema auto-diff completed for ${changed
        .map((path) => rel(projectDir, path))
        .join(", ")}: generated ${written
        .map((path) => rel(projectDir, path))
        .join(
          ", ",
        )} and refreshed the generated types. ${checkLine}. Commit the tree change, the migration, and the types together — the migration runner (e.g. \`supabase db push\`) applies it; supaschema never touches your database.`,
    );
  }
  emit(
    `supaschema auto-diff for ${changed
      .map((path) => rel(projectDir, path))
      .join(", ")} did not complete (exit ${diff.code}):\n${head(
      diff.stderr || diff.stdout,
    )}\nResolve per the supaschema skill — e.g. add the exact object key to hints.destructive for a destructive change, or diff from the post-migration state when the lineage chain is broken — then re-run \`supaschema diff\`.`,
  );
} catch {
  process.exit(0);
}

function editTargets(payload, projectDir) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = payload?.tool_input ?? {};
  if (toolName === "apply_patch") {
    const patch =
      typeof input.command === "string"
        ? input.command
        : typeof input.patch === "string"
          ? input.patch
          : typeof input.input === "string"
            ? input.input
            : "";
    const out = [];
    for (const line of patch.split("\n")) {
      if (line.startsWith(addHeader)) {
        out.push(resolve(projectDir, line.slice(addHeader.length).trim()));
      } else if (line.startsWith(deleteHeader)) {
        out.push(resolve(projectDir, line.slice(deleteHeader.length).trim()));
      } else if (line.startsWith(updateHeader)) {
        out.push(resolve(projectDir, line.slice(updateHeader.length).trim()));
      }
    }
    return out;
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [isAbsolute(input.file_path) ? input.file_path : resolve(projectDir, input.file_path)];
  }
  return [];
}

function isGeneratedMigration(path) {
  try {
    return readFileSync(path, "utf8").includes(lineageMarker);
  } catch {
    return false;
  }
}

function emit(additionalContext) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { additionalContext, hookEventName: "PostToolUse" },
    })}\n`,
  );
  process.exit(0);
}

async function readSchemaPaths(projectDir) {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    return schemaPathsFromConfig(parsed) ?? ["supabase/schemas"];
  }
  for (const file of ["supaschema.config.mjs", "supaschema.config.js"]) {
    const path = join(projectDir, file);
    if (!existsSync(path)) {
      continue;
    }
    const loaded = await import(pathToFileURL(path).href);
    return schemaPathsFromConfig(loaded.default ?? {}) ?? ["supabase/schemas"];
  }
  return ["supabase/schemas"];
}

function schemaPathsFromConfig(config) {
  if (Array.isArray(config?.schemaPaths) && config.schemaPaths.length > 0) {
    return config.schemaPaths.map(String);
  }
  return undefined;
}

function resolveBinary(projectDir) {
  const local = join(projectDir, "node_modules", ".bin", "supaschema");
  if (existsSync(local)) {
    return { args: [], cmd: local };
  }
  if (process.env.SUPASCHEMA_HOOK_BIN) {
    return { args: [], cmd: process.env.SUPASCHEMA_HOOK_BIN };
  }
  return { args: ["--no-install", "supaschema"], cmd: "npx" };
}

function run(bin, args, cwd) {
  try {
    const stdout = execFileSync(bin.cmd, [...bin.args, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { code: 0, stderr: "", stdout };
  } catch (error) {
    return {
      code: typeof error?.status === "number" ? error.status : 1,
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
    };
  }
}

function isInside(dir, file) {
  const relPath = relative(dir, file);
  return relPath !== "" && !relPath.startsWith("..") && !isAbsolute(relPath);
}

function rel(projectDir, path) {
  const relPath = relative(projectDir, path);
  return relPath.startsWith("..") ? path : relPath;
}

function head(text) {
  return (text || "").trim().split("\n").slice(0, 12).join("\n");
}
