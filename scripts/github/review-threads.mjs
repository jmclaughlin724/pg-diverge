#!/usr/bin/env node
import { argValue, ghJson, hasFlag, parsePrNumber, repoFullName } from "./policy.mjs";

const THREADS_QUERY = `
query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 1) {
            nodes {
              body
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}`;

function graphql(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-F", `${key}=${value}`);
  }
  return ghJson(args);
}

function fetchThreads(owner, name, pr) {
  const threads = [];
  let cursor;
  for (;;) {
    const variables = { owner, name, pr };
    if (cursor !== undefined) {
      variables.cursor = cursor;
    }
    const result = graphql(THREADS_QUERY, variables);
    const connection = result.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      throw new Error(`PR #${pr} review threads unavailable for ${owner}/${name}`);
    }
    threads.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) {
      return threads;
    }
    cursor = connection.pageInfo.endCursor;
  }
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function badgeOf(body) {
  const open = body.indexOf("![");
  if (open === -1) {
    return "-";
  }
  const close = body.indexOf(" Badge]", open + 2);
  if (close === -1) {
    return "-";
  }
  const value = body.slice(open + 2, close);
  return value.length === 2 && value[0] === "P" && isDigit(value[1]) ? value : "-";
}

function stripAll(text, token) {
  return text.split(token).join("");
}

function titleOf(body) {
  let text = body.split("\n", 1)[0] ?? "";
  const open = text.indexOf("![");
  if (open !== -1) {
    const paren = text.indexOf("](", open);
    const close = paren === -1 ? -1 : text.indexOf(")", paren + 2);
    if (close !== -1) {
      text = text.slice(0, open) + text.slice(close + 1);
    }
  }
  return stripAll(stripAll(stripAll(text, "<sub>"), "</sub>"), "**").trim();
}

function printThreads(threads) {
  for (const thread of threads) {
    const body = thread.comments.nodes[0]?.body ?? "";
    process.stdout.write(
      `${thread.id}  ${badgeOf(body)}  ${thread.path}:${thread.line ?? "?"}  ${titleOf(body)}\n`
    );
  }
  process.stdout.write(`UNRESOLVED=${threads.length}\n`);
}

const args = process.argv.slice(2);
const prValue = parsePrNumber(argValue(args, "--pr"));
if (!(prValue && prValue.length > 0 && [...prValue].every(isDigit))) {
  process.stderr.write(
    "usage: review-threads.mjs --pr <number|url> [--all] [--resolve <threadId>]\n"
  );
  process.exit(2);
}
const pr = Number(prValue);
const [owner, name] = repoFullName().split("/");

const resolveId = argValue(args, "--resolve");
if (resolveId !== undefined) {
  const result = graphql(RESOLVE_MUTATION, { threadId: resolveId });
  const thread = result.data?.resolveReviewThread?.thread;
  if (!thread?.isResolved) {
    throw new Error(`thread ${resolveId} was not resolved`);
  }
  process.stdout.write(`RESOLVED ${resolveId}\n`);
}

const includeResolved = hasFlag(args, "--all");
const threads = fetchThreads(owner, name, pr).filter(
  (thread) => includeResolved || !thread.isResolved
);
printThreads(threads);
