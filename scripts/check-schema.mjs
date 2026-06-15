#!/usr/bin/env node
// Drift gate for supaschema-config.schema.json.
//
// The build (`npm run build`) compiles src/** then runs the generator
// `node dist/config-schema-gen.js`, which writes supaschema-config.schema.json at the
// package root from the live Zod model in src/config.ts. This check proves the
// committed supaschema-config.schema.json matches what the generator produces from current
// source: it rebuilds, regenerates the file in place, and fails if the working
// tree now differs. Run it in CI and locally before release.
//
// Usage: node scripts/check-schema.mjs   (or `npm run check:schema`)
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = "supaschema-config.schema.json";

// Resolve npm cross-platform: spawnSync("npm", ..., {shell:false}) raises ENOENT
// on Windows (the executable is npm.cmd, which Node will not resolve without a
// shell or explicit extension). Prefer the exact npm that launched this script
// (npm_execpath) run through node; fall back to npm.cmd on Windows. This is the
// same pattern the package-boundary tests use (tests/package-contents.test.ts,
// tests/database-url.test.ts). git resolves fine with shell:false, so only the
// npm call needs this.
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

// Rebuild + regenerate so supaschema-config.schema.json reflects current src/config.ts.
// `npm run build` runs `tsc` then `node dist/config-schema-gen.js`.
const build = npmInvocation(["run", "build"]);
const buildStatus = run(build.command, build.args, "npm run build");
if (buildStatus !== 0) {
  console.error("check:schema: build failed; cannot regenerate config schema.");
  process.exit(buildStatus);
}

// Fail on drift: the committed supaschema-config.schema.json must equal the regenerated one.
const diffStatus = run(
  "git",
  ["diff", "--exit-code", "--", schemaFile],
  `git diff --exit-code ${schemaFile}`
);
if (diffStatus !== 0) {
  console.error(
    `\ncheck:schema: ${schemaFile} is out of date. Run \`npm run build\` and commit the regenerated ${schemaFile}.`
  );
  process.exit(diffStatus);
}

console.log(`check:schema: ${schemaFile} is up to date.`);
