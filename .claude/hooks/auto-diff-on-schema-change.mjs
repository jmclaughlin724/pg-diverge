#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const editTools = new Set(["Edit", "MultiEdit", "Write"]);
const lineageMarker = "-- supaschema: lineage ";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const filePath =
    typeof payload?.tool_input?.file_path === "string" ? payload.tool_input.file_path : "";
  if (!editTools.has(toolName) || !filePath.endsWith(".sql")) {
    process.exit(0);
  }
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || ".",
  );
  const absFile = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
  const schemaPaths = readSchemaPaths(projectDir);
  if (!schemaPaths.some((dir) => isInside(resolve(projectDir, dir), absFile))) {
    process.exit(0);
  }
  if (existsSync(absFile) && readFileSync(absFile, "utf8").includes(lineageMarker)) {
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
        `supaschema: ${rel(projectDir, absFile)} changed but produces no net schema change versus the current state — no migration written.`,
      );
    }
    const check = run(bin, ["check"], projectDir);
    const checkLine =
      check.code === 0
        ? "supaschema check passed (replay-safe)"
        : `supaschema check reported diagnostics:\n${head(check.stderr || check.stdout)}`;
    emit(
      `supaschema auto-diff completed for ${rel(projectDir, absFile)}: generated ${written
        .map((path) => rel(projectDir, path))
        .join(
          ", ",
        )} and refreshed the generated types. ${checkLine}. Commit the tree change, the migration, and the types together — the migration runner (e.g. \`supabase db push\`) applies it; supaschema never touches your database.`,
    );
  }
  emit(
    `supaschema auto-diff for ${rel(projectDir, absFile)} did not complete (exit ${diff.code}):\n${head(
      diff.stderr || diff.stdout,
    )}\nResolve per the supaschema skill — e.g. add the exact object key to hints.destructive for a destructive change, or diff from the post-migration state when the lineage chain is broken — then re-run \`supaschema diff\`.`,
  );
} catch {
  process.exit(0);
}

function emit(additionalContext) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { additionalContext, hookEventName: "PostToolUse" },
    })}\n`,
  );
  process.exit(0);
}

function readSchemaPaths(projectDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectDir, "supaschema.config.json"), "utf8"));
    if (Array.isArray(parsed?.schemaPaths) && parsed.schemaPaths.length > 0) {
      return parsed.schemaPaths.map(String);
    }
  } catch {}
  return ["supabase/schemas"];
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
