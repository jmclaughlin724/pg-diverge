#!/usr/bin/env node
import {
  argValue,
  defaultBase,
  ghJson,
  git,
  parsePrNumber,
  readPolicy,
  reportFailures,
  run,
} from "./policy.mjs";

const args = process.argv.slice(2);
const policy = readPolicy();
const pr = parsePrNumber(argValue(args, "--pr") ?? args[0]);
if (!pr) {
  throw new Error("usage: npm run github:post-merge-verify -- --pr <number-or-url>");
}

const base = defaultBase(policy);
const failures = [];
const pull = ghJson(["pr", "view", pr, "--json", "baseRefName,mergeCommit,mergedAt,state,url"]);

if (pull.baseRefName !== base) {
  failures.push(`PR ${pr} base is ${pull.baseRefName}; expected ${base}`);
}
if (pull.state !== "MERGED") {
  failures.push(`PR ${pr} state is ${pull.state}; expected MERGED`);
}
if (!pull.mergedAt) {
  failures.push(`PR ${pr} has no mergedAt timestamp`);
}

run("git", ["fetch", "origin", base], { stdio: "inherit" });
const mergeOid = pull.mergeCommit?.oid;
if (mergeOid) {
  const ancestor = run("git", ["merge-base", "--is-ancestor", mergeOid, `origin/${base}`], {
    allowFailure: true,
  });
  if (ancestor.status !== 0) {
    failures.push(`PR ${pr} merge commit ${mergeOid} is not contained in origin/${base}`);
  }
} else {
  failures.push(`PR ${pr} has no mergeCommit oid from GitHub`);
}

const head = git(["rev-parse", `origin/${base}`]);
if (!head) {
  failures.push(`could not resolve origin/${base}`);
}

reportFailures(failures, "GITHUB_POST_MERGE_VERIFY_OK");
