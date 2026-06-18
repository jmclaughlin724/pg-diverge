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
syncLocalBase(base, head, failures);

reportFailures(failures, "GITHUB_POST_MERGE_VERIFY_OK");

function syncLocalBase(base, remoteOid, failures) {
  const localRef = `refs/heads/${base}`;
  const localExists =
    run("git", ["show-ref", "--verify", "--quiet", localRef], { allowFailure: true }).status === 0;
  if (!localExists) {
    run("git", ["branch", base, `origin/${base}`], { stdio: "inherit" });
    return;
  }
  const localOid = git(["rev-parse", base]);
  if (localOid === remoteOid) {
    return;
  }
  const checkedOut = git(["branch", "--show-current"]) === base;
  if (checkedOut && git(["status", "--porcelain"]).length > 0) {
    failures.push(
      `local ${base} is checked out with uncommitted changes; clean or stash them before post-merge sync`
    );
    return;
  }
  preserveLocalBaseIfNeeded(base, localOid);
  if (checkedOut) {
    run("git", ["reset", "--hard", `origin/${base}`], { stdio: "inherit" });
  } else {
    run("git", ["branch", "-f", base, `origin/${base}`], { stdio: "inherit" });
  }
  const updatedOid = git(["rev-parse", base]);
  if (updatedOid !== remoteOid) {
    failures.push(`local ${base} is ${updatedOid}; expected ${remoteOid}`);
  }
}

function preserveLocalBaseIfNeeded(base, localOid) {
  const localIsContained =
    run("git", ["merge-base", "--is-ancestor", localOid, `origin/${base}`], {
      allowFailure: true,
    }).status === 0;
  if (localIsContained) {
    return;
  }
  const backup = `preserve/local-${branchSegment(base)}-${localOid}`;
  const existing =
    run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${backup}`], {
      allowFailure: true,
    }).status === 0;
  if (!existing) {
    run("git", ["branch", backup, localOid], { stdio: "inherit" });
  }
}

function branchSegment(value) {
  let output = "";
  for (const char of value) {
    output += isBranchSegmentChar(char) ? char : "-";
  }
  return output || "base";
}

function isBranchSegmentChar(char) {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "." ||
    char === "-" ||
    char === "_"
  );
}
