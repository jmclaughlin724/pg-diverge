#!/usr/bin/env node
// Install-time notice only: point the consumer at `supaschema init` rather
// than writing into their project. A package postinstall that writes files
// is flagged by supply-chain scanners, so scaffolding stays an explicit
// step. Never prints inside supaschema's own checkout; never fails install.
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  process.stdout.write(
    "supaschema: run `npx supaschema init` to scaffold supaschema.config.json\n",
  );
} catch {
  process.exit(0);
}
