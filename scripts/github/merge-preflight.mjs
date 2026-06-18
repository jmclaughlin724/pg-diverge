#!/usr/bin/env node
import {
  argValue,
  defaultBase,
  ghJson,
  parsePrNumber,
  readPolicy,
  repoFullName,
  reportFailures,
  requiredContexts,
  successfulCheck,
} from "./policy.mjs";

const args = process.argv.slice(2);
const policy = readPolicy();
const pr = parsePrNumber(argValue(args, "--pr") ?? args[0]);
if (!pr) {
  throw new Error("usage: npm run github:merge-preflight -- --pr <number-or-url>");
}

const base = defaultBase(policy);
const repo = repoFullName(policy);
const failures = [];
const pull = ghJson([
  "pr",
  "view",
  pr,
  "--json",
  "baseRefName,headRefName,headRefOid,isDraft,mergeStateStatus,reviewDecision,state,statusCheckRollup,url",
]);

if (pull.baseRefName !== base) {
  failures.push(`PR ${pr} base is ${pull.baseRefName}; expected ${base}`);
}
if (pull.state !== "OPEN") {
  failures.push(`PR ${pr} state is ${pull.state}; expected OPEN before merge`);
}
if (pull.isDraft) {
  failures.push(`PR ${pr} is draft`);
}
if (pull.mergeStateStatus !== "CLEAN") {
  failures.push(`PR ${pr} mergeStateStatus is ${pull.mergeStateStatus}; expected CLEAN`);
}
if (pull.reviewDecision === "CHANGES_REQUESTED") {
  failures.push(`PR ${pr} has requested changes`);
}

const required = requiredContexts(policy, base);
const checks = new Map((pull.statusCheckRollup ?? []).map((item) => [item.name, item]));
for (const context of required) {
  const check = checks.get(context);
  if (!check) {
    failures.push(`required status check missing from PR ${pr}: ${context}`);
  } else if (!successfulCheck(check)) {
    failures.push(
      `required status check not successful: ${context} status=${check.status} conclusion=${check.conclusion}`
    );
  }
}

if (policy.branches?.[base]?.required_conversation_resolution) {
  const [owner, repoName] = repo.split("/");
  const threadData = ghJson([
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repoName}`,
    "-F",
    `number=${pr}`,
    "-f",
    "query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}",
  ]);
  const threads =
    threadData?.data?.repository?.pullRequest?.reviewThreads?.nodes?.filter(
      (thread) => thread.isResolved === false
    ) ?? [];
  if (threads.length > 0) {
    failures.push(`PR ${pr} has ${threads.length} unresolved review thread(s)`);
  }
}

reportFailures(failures, "GITHUB_MERGE_PREFLIGHT_OK");
