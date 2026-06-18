#!/usr/bin/env node
import fs from "node:fs";
import { argValue, git, reportFailures, run } from "./policy.mjs";

const args = process.argv.slice(2);
const range = argValue(args, "--range");
const eventName = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;
const HEX = "0123456789abcdefABCDEF";

function normalizeName(value) {
  return collapseWhitespace(String(value ?? "").trim()).toLowerCase();
}

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function signoffs(message) {
  const matches = [];
  for (const line of message.split("\n")) {
    const match = signedOffByLine(line);
    if (match === undefined) {
      continue;
    }
    matches.push({
      email: normalizeEmail(match.email),
      name: normalizeName(match.name),
    });
  }
  return matches;
}

function signedOffByLine(line) {
  const prefix = "signed-off-by:";
  if (!line.toLowerCase().startsWith(prefix)) {
    return;
  }
  const body = line.slice(prefix.length).trim();
  const open = body.lastIndexOf("<");
  const close = body.endsWith(">") ? body.length - 1 : -1;
  if (open <= 0 || close <= open + 1) {
    return;
  }
  const name = body.slice(0, open).trim();
  const email = body.slice(open + 1, close);
  if (name.length === 0 || !isEmailToken(email)) {
    return;
  }
  return { email, name };
}

function isEmailToken(value) {
  const at = value.indexOf("@");
  return (
    at > 0 &&
    at < value.length - 1 &&
    !value.includes("<") &&
    !value.includes(">") &&
    [...value].every((char) => !isWhitespace(char))
  );
}

function collapseWhitespace(value) {
  const words = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words.join(" ");
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function commitAuthor(commit) {
  return {
    email: normalizeEmail(
      commit.authorEmail ?? commit.author?.email ?? commit.commit?.author?.email
    ),
    name: normalizeName(commit.authorName ?? commit.author?.name ?? commit.commit?.author?.name),
  };
}

function commitMessage(commit) {
  return String(commit.message ?? commit.commit?.message ?? "");
}

function shortSha(commit) {
  return String(commit.sha ?? commit.oid ?? "").slice(0, 12);
}

function hasMatchingSignoff(commit) {
  const author = commitAuthor(commit);
  return signoffs(commitMessage(commit)).some(
    (signoff) => signoff.name === author.name && signoff.email === author.email
  );
}

function readEvent() {
  if (!(eventPath && fs.existsSync(eventPath))) {
    return;
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function commitsFromPullRequest(event) {
  const pr = event?.pull_request?.number;
  if (!pr) {
    return;
  }
  if (gitRevisionExists("HEAD^1") && gitRevisionExists("HEAD^2")) {
    return commitsFromRange("HEAD^1..HEAD^2");
  }
  const base = event.pull_request?.base?.sha;
  const head = event.pull_request?.head?.sha;
  if (isFullGitSha(base) && isFullGitSha(head)) {
    return commitsFromRange(`${base}..${head}`);
  }
  throw new Error(
    `PR ${pr} DCO verification requires a full checkout with merge parents or an explicit --range`
  );
}

function commitsFromPush(event) {
  return (event?.commits ?? []).map((commit) => ({
    authorEmail: commit.author?.email,
    authorName: commit.author?.name,
    message: commit.message,
    sha: commit.id,
  }));
}

function commitsFromRange(value) {
  const fields = ["%H", "%an", "%ae", "%B%x1f"].join("%x1e");
  const output = git(["log", `--format=${fields}`, value]);
  return output
    .split("\x1f\n")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authorName, authorEmail, ...messageParts] = record.split("\x1e");
      return {
        authorEmail,
        authorName,
        message: messageParts.join("\x1e").trim(),
        sha,
      };
    });
}

function gitRevisionExists(value) {
  return run("git", ["rev-parse", "--verify", value], { allowFailure: true }).status === 0;
}

function isFullGitSha(value) {
  return (
    typeof value === "string" &&
    value.length === 40 &&
    [...value].every((char) => HEX.includes(char))
  );
}

function commitsToCheck() {
  if (range) {
    return commitsFromRange(range);
  }

  const event = readEvent();
  if (eventName === "pull_request") {
    return commitsFromPullRequest(event);
  }
  if (eventName === "push") {
    return commitsFromPush(event);
  }
  return [];
}

const commits = await commitsToCheck();
const failures = [];

for (const commit of commits) {
  if (!hasMatchingSignoff(commit)) {
    const author = commitAuthor(commit);
    failures.push(
      `${shortSha(commit)} missing Signed-off-by trailer matching ${author.name} <${author.email}>`
    );
  }
}

reportFailures(failures, commits.length === 0 ? "DCO_CHECK_SKIPPED" : "DCO_CHECK_OK");
