#!/usr/bin/env node
// Install-time setup: scaffold pg-diverge.config.json in the consuming
// project so `init` is not a required extra step. Never overwrites an
// existing config, never touches pg-diverge's own checkout, and never fails
// the install.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.env.INIT_CWD ?? process.cwd());

try {
  if (target === packageRoot || target.startsWith(join(packageRoot, ""))) {
    process.exit(0);
  }
  const existing = ["pg-diverge.config.json", "pg-diverge.config.mjs", "pg-diverge.config.js"];
  if (existing.some((name) => existsSync(join(target, name)))) {
    process.exit(0);
  }
  const { defaultConfigFile } = await import(join(packageRoot, "dist", "config.js"));
  await writeFile(join(target, "pg-diverge.config.json"), defaultConfigFile, { flag: "wx" });
  process.stdout.write("pg-diverge: created pg-diverge.config.json with the defaults\n");
} catch {
  // Setup is a convenience; an install must never fail because of it.
  process.exit(0);
}
