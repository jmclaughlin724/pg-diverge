#!/usr/bin/env node
// Install lefthook git hooks for local development. Runs from the `prepare`
// lifecycle script (after the build). Skipped in CI and fully silent so it
// never pollutes stdout captured by `npm pack` / `npm ci` — both of which run
// `prepare`, and several gates parse that stdout (the tarball name, `npm pack
// --json`). Cross-platform: resolves lefthook via the shell and ignores all
// output; a missing lefthook is a no-op, never a failed install.
import { spawnSync } from "node:child_process";

if (process.env.CI) {
  process.exit(0);
}

spawnSync("lefthook", ["install"], { stdio: "ignore", shell: true });
