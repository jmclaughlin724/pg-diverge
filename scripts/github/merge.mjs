#!/usr/bin/env node
import { argValue, parsePrNumber, run } from "./policy.mjs";

const args = process.argv.slice(2);
const pr = parsePrNumber(argValue(args, "--pr") ?? args[0]);
if (!pr) {
  throw new Error("usage: npm run github:merge -- --pr <number-or-url>");
}

run("node", ["scripts/github/merge-preflight.mjs", "--pr", pr], { stdio: "inherit" });
run("gh", ["pr", "merge", pr, "--rebase", "--delete-branch"], { stdio: "inherit" });
run("node", ["scripts/github/post-merge-verify.mjs", "--pr", pr], { stdio: "inherit" });
