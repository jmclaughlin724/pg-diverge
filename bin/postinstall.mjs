#!/usr/bin/env node
// Install-time setup: scaffold supaschema.config.json in the consuming
// project so `init` is not a required extra step. Never overwrites an
// existing config, never touches supaschema's own checkout, and never fails
// the install.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.env.INIT_CWD ?? process.cwd());

try {
  if (target === packageRoot || target.startsWith(packageRoot + sep)) {
    process.exit(0);
  }
  const existing = ["supaschema.config.json", "supaschema.config.mjs", "supaschema.config.js"];
  if (existing.some((name) => existsSync(join(target, name)))) {
    process.exit(0);
  }
  const { defaultConfigFile } = await import(
    pathToFileURL(join(packageRoot, "dist", "config.js")).href
  );
  await writeFile(join(target, "supaschema.config.json"), defaultConfigFile, { flag: "wx" });
  process.stdout.write("supaschema: created supaschema.config.json with the defaults\n");
} catch {
  // Setup is a convenience; an install must never fail because of it.
  process.exit(0);
}
