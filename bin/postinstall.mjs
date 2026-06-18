#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldProject } from "./scaffold.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.env.INIT_CWD ?? process.cwd());
const packageJson = readJson(join(packageRoot, "package.json")) ?? {};
const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";

await main();

function shouldSkipInstall() {
  const flag = (process.env.SUPASCHEMA_SKIP_POSTINSTALL ?? "").trim().toLowerCase();
  return flag !== "" && flag !== "0" && flag !== "false";
}

async function main() {
  try {
    if (shouldSkipInstall() || target === packageRoot || target.startsWith(packageRoot + sep)) {
      process.exit(0);
    }

    await scaffoldProject({
      interactive: false,
      packageRoot,
      packageVersion,
      targetDir: target,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`supaschema: postinstall setup skipped (${message})\n`);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}
