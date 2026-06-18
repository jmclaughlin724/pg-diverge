#!/usr/bin/env node
import {
  argValue,
  currentBranch,
  defaultBase,
  git,
  hasFlag,
  parsePrNumber,
  readPolicy,
  reportFailures,
  run,
} from "./policy.mjs";

const args = process.argv.slice(2);
const policy = readPolicy();
const base = argValue(args, "--base") ?? defaultBase(policy);
const head = argValue(args, "--head") ?? currentBranch();
const pr = parsePrNumber(argValue(args, "--pr"));
const allowDirty = hasFlag(args, "--allow-dirty");
const failures = [];

run("git", ["fetch", "origin", base], { stdio: "inherit" });

if (!head) {
  failures.push("current branch could not be determined");
} else if (head === base) {
  failures.push(`current branch is ${base}; open PRs from a task branch`);
}

if (head && currentBranch() !== head) {
  failures.push(`expected current branch ${head}, got ${currentBranch()}`);
}

const staged = git(["diff", "--cached", "--name-only"]);
const unstaged = git(["diff", "--name-only"]);
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
if (!allowDirty && (staged || unstaged || untracked)) {
  failures.push(
    "worktree has uncommitted files; commit task-owned work or rerun with --allow-dirty and document why the dirty files are unrelated"
  );
}

const countText = git(["rev-list", "--left-right", "--count", `origin/${base}...HEAD`]);
const [baseAheadRaw, branchAheadRaw] = countText.replaceAll("\t", " ").split(" ").filter(Boolean);
const baseAhead = Number(baseAheadRaw);
const branchAhead = Number(branchAheadRaw);
if (baseAhead > 0) {
  failures.push(
    `branch is behind origin/${base} by ${baseAhead} commit(s); rebase/update before PR`
  );
}
if (branchAhead < 1) {
  failures.push(`branch has no commits beyond origin/${base}`);
}

const mergeTree = run(
  "git",
  ["merge-tree", "--write-tree", "--name-only", "--messages", `origin/${base}`, "HEAD"],
  { allowFailure: true }
);
if (mergeTree.status !== 0) {
  failures.push(`branch does not merge cleanly into origin/${base}`);
}

if (pr) {
  const view = run("gh", [
    "pr",
    "view",
    pr,
    "--json",
    "baseRefName,headRefName,isDraft,mergeStateStatus,state,url",
  ]).stdout;
  const data = JSON.parse(view);
  if (data.baseRefName !== base) {
    failures.push(`PR ${pr} base is ${data.baseRefName}; expected ${base}`);
  }
  if (data.headRefName !== head) {
    failures.push(`PR ${pr} head is ${data.headRefName}; expected ${head}`);
  }
  if (data.isDraft) {
    failures.push(`PR ${pr} is draft`);
  }
  if (data.state !== "OPEN") {
    failures.push(`PR ${pr} state is ${data.state}; expected OPEN`);
  }
  if (data.mergeStateStatus === "DIRTY") {
    failures.push(`PR ${pr} has merge conflicts`);
  }
}

reportFailures(failures, "GITHUB_PR_PREFLIGHT_OK");
