#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, exists, ok, ROOT, readJson, readText } from "../lib/guard-utils.js";

export function check(root = ROOT) {
  const policy = readJson(".github/repo-policy.json", root);
  const packageJson = readJson("package.json", root);
  const prTemplate = readText(".github/PULL_REQUEST_TEMPLATE.md", root);
  const contributing = readText("CONTRIBUTING.md", root);
  const githubProcessRule = readText(".claude/rules/21-github-process.md", root);
  const checkAll = readText("scripts/guards/check-all.mjs", root);
  const auditSettings = readText("scripts/github/audit-settings.mjs", root);

  for (const file of [
    "scripts/github/policy.mjs",
    "scripts/github/merge.mjs",
    "scripts/github/pr-preflight.mjs",
    "scripts/github/merge-preflight.mjs",
    "scripts/github/post-merge-verify.mjs",
    "scripts/github/audit-settings.mjs",
  ]) {
    assert(exists(file, root), `${file} must exist`);
  }

  for (const [name, command] of Object.entries({
    "github:audit-settings": "node scripts/github/audit-settings.mjs",
    "github:merge": "node scripts/github/merge.mjs",
    "github:merge-preflight": "node scripts/github/merge-preflight.mjs",
    "github:post-merge-verify": "node scripts/github/post-merge-verify.mjs",
    "github:pr-preflight": "node scripts/github/pr-preflight.mjs",
    "guard:github-process": "node scripts/guards/ci-release/check-github-process.mjs",
  })) {
    assert(
      packageJson.scripts?.[name] === command,
      `package.json#scripts.${name} must be ${command}`
    );
  }

  assert(
    checkAll.includes("scripts/guards/ci-release/check-github-process.mjs"),
    "npm run guard must include check-github-process.mjs"
  );
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
  assert(
    packageJson.description ===
      "Declarative PostgreSQL schema management for replay-safe migrations, guarded sync, TypeScript types, and Zod validators without an ORM, Docker, or a shadow database.",
    "package description must match the canonical distribution paragraph"
  );
  for (const topic of expectedTopics) {
    assert(packageJson.keywords.includes(topic), `package keywords must include ${topic}`);
  }
  assert(
    auditSettings.includes("--apply-topics"),
    "audit-settings must own the approval-gated topic apply flag"
  );
  assert(
    auditSettings.includes("GITHUB_REPOSITORY_TOPICS_APPROVED"),
    "audit-settings must require explicit topic write approval"
  );
  assert(
    auditSettings.includes('"PUT"'),
    "audit-settings topic apply must use the GitHub replace-topics endpoint"
  );
  assert(policy.repository?.default_branch === "main", "default branch must be main");
  assert(policy.repository?.allow_merge_commit === false, "merge commits must be disabled");
  assert(policy.repository?.allow_squash_merge === false, "squash merges must be disabled");
  assert(policy.repository?.allow_rebase_merge === true, "rebase merges must be enabled");
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
    policy.actions?.workflowPermissions?.default_workflow_permissions === "read",
    "GitHub Actions default workflow token permissions must be read-only"
  );
  assert(
    policy.actions?.workflowPermissions?.can_approve_pull_request_reviews === false,
    "GitHub Actions must not create or approve pull request reviews"
  );
  assert(!("dco" in policy), "repo policy must not define DCO enforcement");
  assert(policy.pullRequests?.mergeMethod === "rebase", "canonical PR merge method must be rebase");
  assert(
    policy.pullRequests?.optionalMergeWorkflow === "npm run github:merge -- --pr <number>",
    "optional PR merge workflow must be npm run github:merge"
  );
  assert(
    policy.pullRequests?.postMergeLocalSync?.includes("preserve/local-main-<sha>") &&
      policy.pullRequests.postMergeLocalSync.includes("align local main to origin/main"),
    "post-merge policy must require preserving divergent local main and aligning it to origin/main"
  );
  assert(
    policy.pullRequests?.mergeCliIsolation?.includes("temporary directory") &&
      policy.pullRequests.mergeCliIsolation.includes("gh cannot mutate local branches"),
    "post-merge policy must require isolating gh merge from local branch mutation"
  );

  const main = policy.branches?.main;
  assert(main, "repo policy must define branches.main");
  assert(main.required_linear_history === true, "main must require linear history");
  assert(
    main.required_conversation_resolution === true,
    "main must require conversation resolution"
  );
  assert(
    main.required_signatures === false,
    "required signatures must stay disabled with rebase-only merges"
  );
  assert(main.enforce_admins === true, "main branch protection must apply to admins");
  assert(main.allow_force_pushes === false, "main must block force pushes");
  assert(main.allow_deletions === false, "main must block deletions");
  assert(main.direct_pushes === true, "main policy must allow direct fast-forward pushes");
  assert(
    !("required_pull_request_reviews" in main),
    "main policy must not require pull request reviews"
  );
  assert(!("required_status_checks" in main), "main policy must not require status checks");

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
  for (const type of ["deletion", "non_fast_forward", "required_linear_history"]) {
    assert(
      (mainRuleset.rules ?? []).some((rule) => rule.type === type),
      `main branch policy ruleset must include ${type}`
    );
  }
  for (const type of ["pull_request", "required_status_checks"]) {
    assert(
      !(mainRuleset.rules ?? []).some((rule) => rule.type === type),
      `main branch policy ruleset must not include ${type}`
    );
  }

  for (const command of ["npm run github:pr-preflight -- --base main"]) {
    assert(
      prTemplate.includes(command),
      `.github/PULL_REQUEST_TEMPLATE.md must include ${command}`
    );
  }

  assert(
    !(packageJson.scripts?.["github:check-dco"] || exists("scripts/github/check-dco.mjs", root)),
    "DCO checker must not be exposed as a repo blocker"
  );
  for (const source of [
    ["CONTRIBUTING.md", contributing],
    [".github/PULL_REQUEST_TEMPLATE.md", prTemplate],
    [".claude/rules/21-github-process.md", githubProcessRule],
  ]) {
    assert(!source[1].includes("github:check-dco"), `${source[0]} must not require DCO checks`);
    assert(!source[1].includes("DCO"), `${source[0]} must not require DCO signoff`);
  }
  assert(
    contributing.includes("npm run github:merge -- --pr <number>") &&
      contributing.includes("temporary directory") &&
      contributing.includes("prevents `gh` from mutating local branches") &&
      contributing.includes("preserve/local-main-<sha>") &&
      contributing.includes("aligns local `main` to `origin/main`"),
    "CONTRIBUTING.md must document the canonical merge wrapper and local main reconciliation"
  );
  const postMergeVerify = readText("scripts/github/post-merge-verify.mjs", root);
  assert(
    postMergeVerify.includes("syncLocalBase(base, head, failures)") &&
      postMergeVerify.includes("const backup = `preserve/local-") &&
      postMergeVerify.includes("branchSegment(base)") &&
      postMergeVerify.includes("localOid") &&
      postMergeVerify.includes('"reset", "--hard"') &&
      postMergeVerify.includes("`origin/"),
    "post-merge verify must reconcile local main after remote merge verification"
  );
  const mergeWorkflow = readText("scripts/github/merge.mjs", root);
  for (const term of [
    "mkdtempSync",
    "repoFullName(policy)",
    "scripts/github/merge-preflight.mjs",
    '"pr", "merge"',
    "--repo",
    "--rebase",
    "--delete-branch",
    "rmSync",
    "scripts/github/post-merge-verify.mjs",
  ]) {
    assert(mergeWorkflow.includes(term), `github merge workflow must include ${term}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("GITHUB_PROCESS_GUARD_OK");
}
