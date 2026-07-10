import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "../redaction.js";

export interface HookCommand {
  args: string[];
  cmd: string;
}

export interface HookCommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

export function resolveHookBinary(projectDir: string): HookCommand {
  const local = join(projectDir, "node_modules", ".bin", "supaschema");
  if (existsSync(local)) {
    return { args: [], cmd: local };
  }
  if (process.env.SUPASCHEMA_HOOK_BIN) {
    return hookScriptCommand(process.env.SUPASCHEMA_HOOK_BIN);
  }
  return { args: ["--no-install", "supaschema"], cmd: "npx" };
}

export function runHookCommand(bin: HookCommand, args: string[], cwd: string): HookCommandResult {
  try {
    const stdout = execFileSync(bin.cmd, [...bin.args, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { code: 0, stderr: "", stdout };
  } catch (error) {
    const status = typeof error === "object" && error !== null ? Reflect.get(error, "status") : 1;
    const stderr = typeof error === "object" && error !== null ? Reflect.get(error, "stderr") : "";
    const stdout = typeof error === "object" && error !== null ? Reflect.get(error, "stdout") : "";
    return {
      code: typeof status === "number" ? status : 1,
      stderr: typeof stderr === "string" ? stderr : "",
      stdout: typeof stdout === "string" ? stdout : "",
    };
  }
}

export function head(text: string): string {
  return redactSecrets(text || "")
    .trim()
    .split("\n")
    .slice(0, 12)
    .join("\n");
}

function hookScriptCommand(path: string): HookCommand {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".js") || lowered.endsWith(".mjs") || lowered.endsWith(".cjs")) {
    return { args: [path], cmd: process.execPath };
  }
  return { args: [], cmd: path };
}
