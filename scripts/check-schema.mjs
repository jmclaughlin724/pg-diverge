#!/usr/bin/env node
// Drift gate for the generated config contract artifacts.
//
// The build (`npm run build`) compiles src/** then runs the generator
// `node dist/config-schema-gen.js`, which writes supaschema-config.schema.json
// and bin/config-contract.mjs from src/config.ts + src/config-contract.ts. This
// check proves the working-tree generated files already match current source.
//
// Usage: node scripts/check-schema.mjs   (or `npm run check:schema`)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedFiles = ["supaschema-config.schema.json", "bin/config-contract.mjs"];

// Resolve npm cross-platform: spawnSync("npm", ..., {shell:false}) raises ENOENT
// on Windows (the executable is npm.cmd, which Node will not resolve without a
// shell or explicit extension). Prefer the exact npm that launched this script
// (npm_execpath) run through node; fall back to npm.cmd on Windows. This is the
// same pattern the package-boundary tests use (tests/package-contents.test.ts,
// tests/database-url.test.ts).
function npmInvocation(args) {
  const execpath = process.env.npm_execpath;
  return execpath
    ? { command: process.execPath, args: [execpath, ...args] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`check:schema: failed to run ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return result.status;
  }
  return 0;
}

function readGeneratedFiles() {
  return new Map(
    generatedFiles.map((file) => {
      const path = resolve(packageRoot, file);
      return [file, existsSync(path) ? readFileSync(path, "utf8") : undefined];
    })
  );
}

// Rebuild + regenerate so generated config contract files reflect current source.
// `npm run build` runs `tsc` then `node dist/config-schema-gen.js`.
const before = readGeneratedFiles();
const build = npmInvocation(["run", "build"]);
const buildStatus = run(build.command, build.args, "npm run build");
if (buildStatus !== 0) {
  console.error("check:schema: build failed; cannot regenerate config schema.");
  process.exit(buildStatus);
}

const after = readGeneratedFiles();
const drifted = generatedFiles.filter((file) => before.get(file) !== after.get(file));
if (drifted.length > 0) {
  console.error(
    `\ncheck:schema: generated config contract files are out of date. Run \`npm run build\` and commit ${drifted.join(", ")}.`
  );
  process.exit(1);
}

console.log(`check:schema: ${generatedFiles.join(", ")} are up to date.`);
