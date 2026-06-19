#!/usr/bin/env node
import {
  argValue,
  asEnabled,
  ghJson,
  hasFlag,
  readPolicy,
  repoFullName,
  reportFailures,
  setDifference,
  sorted,
} from "./policy.mjs";

const args = process.argv.slice(2);
const policy = readPolicy();
const repo = argValue(args, "--repo") ?? repoFullName(policy);
const applyTopics = hasFlag(args, "--apply-topics");
const failures = [];
const topicFailures = [];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareObject(actual, expected, path) {
  for (const [key, expectedValue] of Object.entries(expected ?? {})) {
    const actualValue = actual?.[key];
    if (actualValue !== expectedValue) {
      failures.push(
        `${path}.${key} expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
      );
    }
  }
}

function normalizeRequiredStatusChecks(value) {
  return (value ?? [])
    .map((check) => ({
      context: check.context,
      integration_id: check.integration_id,
    }))
    .sort((left, right) => left.context.localeCompare(right.context));
}

function normalizeBypassActors(value) {
  return (value ?? [])
    .map((actor) => ({
      actor_id: actor.actor_id,
      actor_type: actor.actor_type,
      bypass_mode: actor.bypass_mode,
    }))
    .sort((left, right) =>
      `${left.actor_type}:${left.actor_id}:${left.bypass_mode}`.localeCompare(
        `${right.actor_type}:${right.actor_id}:${right.bypass_mode}`
      )
    );
}

function normalizedParameterValue(ruleType, key, value) {
  if (ruleType === "required_status_checks" && key === "required_status_checks") {
    return normalizeRequiredStatusChecks(value);
  }
  if (Array.isArray(value)) {
    return sorted(value);
  }
  return value;
}

const repoSettings = ghJson(["api", `repos/${repo}`]);
for (const [key, expected] of Object.entries(policy.repository ?? {})) {
  const actual = repoSettings[key];
  if (actual !== expected) {
    failures.push(
      `repository.${key} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

const expectedTopics = sorted(policy.repositoryTopics ?? []);
if (expectedTopics.length > 0) {
  const actualTopics = sorted(ghJson(["api", `repos/${repo}/topics`]).names ?? []);
  for (const topic of setDifference(expectedTopics, actualTopics)) {
    topicFailures.push(`repositoryTopics missing required topic: ${topic}`);
  }
  for (const topic of setDifference(actualTopics, expectedTopics)) {
    topicFailures.push(`repositoryTopics has unowned topic: ${topic}`);
  }
}

const expectedActions = policy.actions ?? {};
if (expectedActions.permissions) {
  const actualPermissions = ghJson(["api", `repos/${repo}/actions/permissions`]);
  compareObject(actualPermissions, expectedActions.permissions, "actions.permissions");
}
if (expectedActions.workflowPermissions) {
  const actualWorkflowPermissions = ghJson(["api", `repos/${repo}/actions/permissions/workflow`]);
  compareObject(
    actualWorkflowPermissions,
    expectedActions.workflowPermissions,
    "actions.workflowPermissions"
  );
}
if (expectedActions.forkPullRequestContributorApproval) {
  const actualForkApproval = ghJson([
    "api",
    `repos/${repo}/actions/permissions/fork-pr-contributor-approval`,
  ]);
  compareObject(
    actualForkApproval,
    expectedActions.forkPullRequestContributorApproval,
    "actions.forkPullRequestContributorApproval"
  );
}

for (const [branch, branchPolicy] of Object.entries(policy.branches ?? {})) {
  const protection = ghJson(["api", `repos/${repo}/branches/${branch}/protection`]);

  for (const key of [
    "allow_deletions",
    "allow_force_pushes",
    "enforce_admins",
    "required_conversation_resolution",
    "required_linear_history",
    "required_signatures",
  ]) {
    const expected = branchPolicy[key];
    const actual = asEnabled(protection[key]);
    if (actual !== expected) {
      failures.push(`branches.${branch}.${key} expected ${expected}, got ${actual}`);
    }
  }

  const actualReviews = protection.required_pull_request_reviews ?? {};
  if ("required_pull_request_reviews" in branchPolicy) {
    const expectedReviews = branchPolicy.required_pull_request_reviews ?? {};
    for (const [key, expected] of Object.entries(expectedReviews)) {
      const actual = actualReviews[key];
      if (actual !== expected) {
        failures.push(
          `branches.${branch}.required_pull_request_reviews.${key} expected ${JSON.stringify(
            expected
          )}, got ${JSON.stringify(actual)}`
        );
      }
    }
  } else if (protection.required_pull_request_reviews) {
    failures.push(`branches.${branch}.required_pull_request_reviews has unowned requirement`);
  }

  const expectedStatus = branchPolicy.required_status_checks ?? {};
  const actualStatus = protection.required_status_checks ?? {};
  if (actualStatus.strict !== expectedStatus.strict) {
    failures.push(
      `branches.${branch}.required_status_checks.strict expected ${expectedStatus.strict}, got ${actualStatus.strict}`
    );
  }
  const expectedContexts = sorted(expectedStatus.contexts ?? []);
  const actualContexts = sorted(actualStatus.contexts ?? []);
  for (const context of setDifference(expectedContexts, actualContexts)) {
    failures.push(`branches.${branch}.required_status_checks missing required context: ${context}`);
  }
  for (const context of setDifference(actualContexts, expectedContexts)) {
    failures.push(`branches.${branch}.required_status_checks has unowned context: ${context}`);
  }
  if (expectedStatus.app_id !== undefined) {
    const actualChecksByContext = new Map(
      (actualStatus.checks ?? []).map((check) => [check.context, check])
    );
    for (const context of expectedContexts) {
      const check = actualChecksByContext.get(context);
      if (!check) {
        failures.push(
          `branches.${branch}.required_status_checks missing app-bound check: ${context}`
        );
        continue;
      }
      if (check.app_id !== expectedStatus.app_id) {
        failures.push(
          `branches.${branch}.required_status_checks.${context}.app_id expected ${expectedStatus.app_id}, got ${check.app_id}`
        );
      }
    }
  }
}

const liveRulesets = ghJson(["api", `repos/${repo}/rulesets`]);
for (const expectedRuleset of policy.rulesets ?? []) {
  const listed = liveRulesets.find((ruleset) => ruleset.name === expectedRuleset.name);
  if (!listed) {
    failures.push(`rulesets missing required ruleset: ${expectedRuleset.name}`);
    continue;
  }
  const actualRuleset = ghJson(["api", `repos/${repo}/rulesets/${listed.id}`]);
  compareObject(
    actualRuleset,
    {
      enforcement: expectedRuleset.enforcement,
      name: expectedRuleset.name,
      target: expectedRuleset.target,
    },
    `rulesets.${expectedRuleset.name}`
  );
  const expectedBypassActors = normalizeBypassActors(expectedRuleset.bypass_actors);
  const actualBypassActors = normalizeBypassActors(actualRuleset.bypass_actors);
  if (!sameJson(actualBypassActors, expectedBypassActors)) {
    failures.push(
      `rulesets.${expectedRuleset.name}.bypass_actors expected ${JSON.stringify(expectedBypassActors)}, got ${JSON.stringify(actualBypassActors)}`
    );
  }

  const expectedInclude = sorted(expectedRuleset.conditions?.ref_name?.include ?? []);
  const actualInclude = sorted(actualRuleset.conditions?.ref_name?.include ?? []);
  if (!sameJson(actualInclude, expectedInclude)) {
    failures.push(
      `rulesets.${expectedRuleset.name}.conditions.ref_name.include expected ${JSON.stringify(expectedInclude)}, got ${JSON.stringify(actualInclude)}`
    );
  }
  const expectedExclude = sorted(expectedRuleset.conditions?.ref_name?.exclude ?? []);
  const actualExclude = sorted(actualRuleset.conditions?.ref_name?.exclude ?? []);
  if (!sameJson(actualExclude, expectedExclude)) {
    failures.push(
      `rulesets.${expectedRuleset.name}.conditions.ref_name.exclude expected ${JSON.stringify(expectedExclude)}, got ${JSON.stringify(actualExclude)}`
    );
  }

  const expectedByType = new Map((expectedRuleset.rules ?? []).map((rule) => [rule.type, rule]));
  const actualByType = new Map((actualRuleset.rules ?? []).map((rule) => [rule.type, rule]));
  for (const type of setDifference([...expectedByType.keys()], [...actualByType.keys()])) {
    failures.push(`rulesets.${expectedRuleset.name}.rules missing required rule: ${type}`);
  }
  for (const type of setDifference([...actualByType.keys()], [...expectedByType.keys()])) {
    failures.push(`rulesets.${expectedRuleset.name}.rules has unowned rule: ${type}`);
  }
  for (const [type, expectedRule] of expectedByType) {
    const actualRule = actualByType.get(type);
    if (!actualRule) {
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expectedRule.parameters ?? {})) {
      const actualValue = normalizedParameterValue(type, key, actualRule.parameters?.[key]);
      const normalizedExpected = normalizedParameterValue(type, key, expectedValue);
      if (!sameJson(actualValue, normalizedExpected)) {
        failures.push(
          `rulesets.${expectedRuleset.name}.rules.${type}.parameters.${key} expected ${JSON.stringify(normalizedExpected)}, got ${JSON.stringify(actualValue)}`
        );
      }
    }
  }
}

if (applyTopics) {
  if (process.env.GITHUB_REPOSITORY_TOPICS_APPROVED !== "1") {
    failures.push("--apply-topics requires GITHUB_REPOSITORY_TOPICS_APPROVED=1");
  }
  if (failures.length > 0) {
    failures.push(...topicFailures);
  } else if (topicFailures.length > 0) {
    applyRepositoryTopics(repo, expectedTopics);
    const updatedTopics = sorted(ghJson(["api", `repos/${repo}/topics`]).names ?? []);
    for (const topic of setDifference(expectedTopics, updatedTopics)) {
      failures.push(`repositoryTopics missing required topic after apply: ${topic}`);
    }
    for (const topic of setDifference(updatedTopics, expectedTopics)) {
      failures.push(`repositoryTopics has unowned topic after apply: ${topic}`);
    }
  }
} else {
  failures.push(...topicFailures);
}

reportFailures(failures, applyTopics ? "GITHUB_SETTINGS_APPLY_OK" : "GITHUB_SETTINGS_AUDIT_OK");

function applyRepositoryTopics(targetRepo, topics) {
  ghJson(["api", `repos/${targetRepo}/topics`, "-X", "PUT", "--input", "-"], {
    input: JSON.stringify({ names: topics }),
  });
}
