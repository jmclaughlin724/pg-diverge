#!/usr/bin/env node
// Install-time wrapper for consuming projects. This makes the consumer's
// package-manager install the single step that installs config, agent guidance,
// rules, skills, hooks, and default schema/migration folders.
// The actual scaffolding lives in the shared, dist-free ./scaffold.mjs so
// `supaschema init` can reproduce the same setup when dependency lifecycle
// scripts are blocked or skipped by npm, pnpm, Yarn, Bun, or local project
// policy. This wrapper owns only the lifecycle concerns: INIT_CWD resolution,
// the opt-out/own-checkout skip guards, the never-fail-install swallow, and the
// stdout-silent package-manager contract. The script is idempotent and never
// fails package installation; setup failures are reported on stderr and install
// still exits 0.
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldProject } from "./scaffold.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.env.INIT_CWD ?? process.cwd());
const packageJson = readJson(join(packageRoot, "package.json")) ?? {};
const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";

await main();

// Opt-out used by the composite GitHub Action (action.yml): the action only runs
// the supaschema CLI as a gate, so the consumer-scaffolding postinstall must not
// write config/agent/hook/manifest files into the user's checkout.
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
