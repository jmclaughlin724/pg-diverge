#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argValue, parsePrNumber, readPolicy, repoFullName, run } from "./policy.mjs";

const args = process.argv.slice(2);
const policy = readPolicy();
const repo = repoFullName(policy);
const pr = parsePrNumber(argValue(args, "--pr") ?? args[0]);
if (!pr) {
  throw new Error("usage: npm run github:merge -- --pr <number-or-url>");
}

run("node", ["scripts/github/merge-preflight.mjs", "--pr", pr], { stdio: "inherit" });
const mergeCwd = mkdtempSync(join(tmpdir(), "supaschema-gh-merge-"));
try {
  run("gh", ["pr", "merge", pr, "--repo", repo, "--rebase", "--delete-branch"], {
    cwd: mergeCwd,
    stdio: "inherit",
  });
} finally {
  rmSync(mergeCwd, { force: true, recursive: true });
}
run("node", ["scripts/github/post-merge-verify.mjs", "--pr", pr], { stdio: "inherit" });
