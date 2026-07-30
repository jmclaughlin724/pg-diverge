#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { exists, ROOT, readJson } from "../lib/repository.js";

const deletedGithubWorkflowFiles = [
  "scripts/github/merge.mjs",
  "scripts/github/merge-preflight.mjs",
  "scripts/github/post-merge-verify.mjs",
  "scripts/github/pr-preflight.mjs",
];

const deletedGithubWorkflowScripts = [
  "github:merge",
  "github:merge-preflight",
  "github:post-merge-verify",
  "github:pr-preflight",
];

function assertProtectedMainPolicy(policy) {
  const main = policy.branches?.main;
  assert(main, "repo policy must define branches.main");
  assert(main.required_linear_history === true, "main must require linear history");
  assert(
    main.required_conversation_resolution === true,
    "main must require conversation resolution"
  );
  assert(main.required_signatures === false, "required signatures must stay disabled");
  assert(main.enforce_admins === true, "main branch protection must apply to admins");
  assert(main.allow_force_pushes === false, "main must block force pushes");
  assert(main.allow_deletions === false, "main must block deletions");
  assert(main.direct_pushes === false, "main policy must reject direct pushes");
  assert(
    !("required_pull_request_reviews" in main),
    "classic main protection must not duplicate ruleset reviews"
  );
  assert(
    !("required_status_checks" in main),
    "classic main protection must not duplicate ruleset checks"
  );

  const mainRuleset = (policy.rulesets ?? []).find(
    (ruleset) => ruleset.name === "main branch policy"
  );
  assert(mainRuleset, "repo policy must define the main branch policy ruleset");
  assert(mainRuleset.target === "branch", "main branch policy ruleset must target branches");
  assert(mainRuleset.enforcement === "active", "main branch policy ruleset must be active");
  assert(
    mainRuleset.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH"),
    "main branch policy ruleset must target the default branch"
  );
  assert(
    Array.isArray(mainRuleset.bypass_actors) && mainRuleset.bypass_actors.length === 0,
    "main branch policy ruleset must not define bypass actors"
  );
  for (const type of [
    "deletion",
    "non_fast_forward",
    "required_linear_history",
    "pull_request",
    "required_status_checks",
  ]) {
    assert(
      (mainRuleset.rules ?? []).some((rule) => rule.type === type),
      `main branch policy ruleset must include ${type}`
    );
  }
  const pullRequestRule = mainRuleset.rules.find((rule) => rule.type === "pull_request");
  assert(
    JSON.stringify(pullRequestRule?.parameters?.allowed_merge_methods) ===
      JSON.stringify(["squash"]) &&
      pullRequestRule?.parameters?.required_approving_review_count === 0,
    "main pull-request rule must require GitHub squash PRs without an unsatisfiable solo-review gate"
  );
  const requiredChecksRule = mainRuleset.rules.find(
    (rule) => rule.type === "required_status_checks"
  );
  const requiredContexts = (requiredChecksRule?.parameters?.required_status_checks ?? []).map(
    (check) => check.context
  );
  assert(
    JSON.stringify(requiredContexts) === JSON.stringify(["CI required", "dependency-review"]) &&
      requiredChecksRule?.parameters?.strict_required_status_checks_policy === true,
    "main ruleset must require the stable CI and dependency-review checks against current main"
  );

  const releaseTagRuleset = (policy.rulesets ?? []).find(
    (ruleset) => ruleset.name === "release tag policy"
  );
  assert(releaseTagRuleset?.target === "tag", "release tag policy must target tags");
  assert(
    releaseTagRuleset?.conditions?.ref_name?.include?.includes("refs/tags/v*"),
    "release tag policy must target v* tags"
  );
  for (const type of ["deletion", "non_fast_forward"]) {
    assert(
      releaseTagRuleset?.rules?.some((rule) => rule.type === type),
      `release tag policy must include ${type}`
    );
  }

  const releaseEnvironment = policy.environments?.release;
  assert(
    releaseEnvironment?.deployment_branch_policy?.custom_branch_policies === true &&
      releaseEnvironment?.deployment_branch_policy?.protected_branches === false,
    "release environment must use an explicit deployment branch policy"
  );
  assert(
    JSON.stringify(releaseEnvironment?.branch_policies) ===
      JSON.stringify([{ name: "main", type: "branch" }]),
    "release environment must permit only main"
  );
}

export function check(root = ROOT) {
  const policy = readJson(".github/repo-policy.json", root);
  const packageJson = readJson("package.json", root);

  assert(exists(".claude/rules/21-source-control.md", root), "Rule 21 must own source control");
  for (const file of [
    ".claude/rules/14-editing-worktree-git.md",
    ".claude/rules/21-github-process.md",
  ]) {
    assert(!exists(file, root), `${file} must not exist`);
  }

  for (const file of ["scripts/github/policy.mjs", "scripts/github/audit-settings.mjs"]) {
    assert(exists(file, root), `${file} must exist`);
  }
  for (const file of deletedGithubWorkflowFiles) {
    assert(!exists(file, root), `${file} must not exist`);
  }

  assert(
    packageJson.scripts?.["github:audit-settings"] === "node scripts/github/audit-settings.mjs",
    "package.json#scripts.github:audit-settings must be node scripts/github/audit-settings.mjs"
  );
  assert(
    packageJson.scripts?.["guard:github-process"] ===
      "node scripts/guards/ci-release/check-github-process.mjs",
    "package.json#scripts.guard:github-process must be node scripts/guards/ci-release/check-github-process.mjs"
  );
  for (const script of deletedGithubWorkflowScripts) {
    assert(
      !(script in (packageJson.scripts ?? {})),
      `package.json#scripts.${script} must not exist`
    );
  }

  assert(
    Array.isArray(policy.upstreamSources) && policy.upstreamSources.length > 0,
    "repo policy must cite GitHub upstream sources"
  );

  assert(
    policy.repositoryFullName === "jmclaughlin724/supaschema",
    "repo policy must name this repository"
  );
  const expectedTopics = [
    "ai-coding-agents",
    "database-migrations",
    "declarative-schema",
    "drift-detection",
    "postgres",
    "postgres-migrations",
    "postgresql",
    "postgresql-migrations",
    "row-level-security",
    "schema-diff",
    "schema-management",
    "supabase",
    "supabase-migrations",
    "typescript-types",
    "zod",
  ];
  assert(
    JSON.stringify(policy.repositoryTopics) === JSON.stringify(expectedTopics),
    "repo policy topics must match the G41 distribution set"
  );
  for (const topic of expectedTopics) {
    assert(packageJson.keywords.includes(topic), `package keywords must include ${topic}`);
  }

  assert(policy.repository?.default_branch === "main", "default branch must be main");
  assert(policy.repository?.allow_merge_commit === false, "merge commits must be disabled");
  assert(policy.repository?.allow_squash_merge === true, "squash merges must be enabled");
  assert(policy.repository?.allow_rebase_merge === false, "rebase merges must be disabled");
  assert(
    policy.repository?.delete_branch_on_merge === true,
    "merged head branches must auto-delete"
  );
  assert(
    policy.repository?.web_commit_signoff_required === false,
    "web commit signoff must not be required"
  );
  assert(
    policy.actions?.permissions?.sha_pinning_required === true,
    "GitHub Actions must require full-length SHA-pinned actions"
  );
  assert(
    policy.actions?.permissions?.allowed_actions === "selected",
    "GitHub Actions must allow only selected action owners"
  );
  assert(
    policy.actions?.selectedActions?.github_owned_allowed === true &&
      policy.actions?.selectedActions?.verified_allowed === false,
    "selected Actions policy must allow GitHub-owned actions and deny the broad verified-creator set"
  );
  const requiredThirdPartyActions = [
    "astral-sh/setup-uv@*",
    "codecov/codecov-action@*",
    "ossf/scorecard-action@*",
    "oven-sh/setup-bun@*",
    "step-security/harden-runner@*",
  ];
  assert(
    JSON.stringify(policy.actions?.selectedActions?.patterns_allowed) ===
      JSON.stringify(requiredThirdPartyActions),
    "selected Actions policy must match the reviewed third-party action set"
  );
  assert(
    policy.actions?.workflowPermissions?.default_workflow_permissions === "read",
    "GitHub Actions default workflow token permissions must be read-only"
  );
  assert(
    policy.actions?.workflowPermissions?.can_approve_pull_request_reviews === false,
    "GitHub Actions must not create or approve pull request reviews"
  );
  assert(!("dco" in policy), "repo policy must not define DCO enforcement");
  assert(policy.pullRequests?.mergeMethod === "squash", "canonical PR merge method must be squash");
  for (const key of [
    "optionalMergeWorkflow",
    "optionalPreflight",
    "optionalMergePreflight",
    "optionalPostMergeVerification",
    "mergeCliIsolation",
    "postMergeLocalSync",
  ]) {
    assert(!(key in (policy.pullRequests ?? {})), `pullRequests.${key} must not exist`);
  }

  assertProtectedMainPolicy(policy);

  assert(
    !(packageJson.scripts?.["github:check-dco"] || exists("scripts/github/check-dco.mjs", root)),
    "DCO checker must not be exposed as a repo blocker"
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("GITHUB_PROCESS_GUARD_OK");
}
