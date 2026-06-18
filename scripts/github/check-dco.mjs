#!/usr/bin/env node
import fs from "node:fs";
import { request } from "node:https";
import { argValue, git, repoFullName, reportFailures } from "./policy.mjs";

const args = process.argv.slice(2);
const range = argValue(args, "--range");
const repo = argValue(args, "--repo") ?? process.env.GITHUB_REPOSITORY ?? repoFullName();
const eventName = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;

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

function token() {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
}

function githubJson(pathname) {
  const authToken = token();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "supaschema-dco-check",
    "X-GitHub-Api-Version": "2026-03-10",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return new Promise((resolve, reject) => {
    const req = request(
      {
        headers,
        hostname: "api.github.com",
        method: "GET",
        path: pathname,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub API ${pathname} failed with ${res.statusCode}: ${body}`));
            return;
          }
          resolve(JSON.parse(body));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function commitsFromPullRequest(event) {
  const pr = event?.pull_request?.number;
  if (!pr) {
    return;
  }
  const commits = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubJson(`/repos/${repo}/pulls/${pr}/commits?per_page=100&page=${page}`);
    commits.push(...batch);
    if (batch.length < 100) {
      return commits;
    }
  }
  throw new Error(`PR ${pr} has more than 1000 commits; split it before DCO verification`);
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
