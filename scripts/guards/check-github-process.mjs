#!/usr/bin/env node
import { assert, exists, ok, readJson, readText } from "./lib/guard-utils.js";

const policy = readJson(".github/repo-policy.json");
const packageJson = readJson("package.json");
const prTemplate = readText(".github/PULL_REQUEST_TEMPLATE.md");
const contributing = readText("CONTRIBUTING.md");
const checkAll = readText("scripts/guards/check-all.mjs");
const auditSettings = readText("scripts/github/audit-settings.mjs");

for (const file of [
  "scripts/github/policy.mjs",
  "scripts/github/check-dco.mjs",
  "scripts/github/pr-preflight.mjs",
  "scripts/github/merge-preflight.mjs",
  "scripts/github/post-merge-verify.mjs",
  "scripts/github/audit-settings.mjs",
]) {
  assert(exists(file), `${file} must exist`);
}

for (const [name, command] of Object.entries({
  "github:audit-settings": "node scripts/github/audit-settings.mjs",
  "github:check-dco": "node scripts/github/check-dco.mjs",
  "github:merge-preflight": "node scripts/github/merge-preflight.mjs",
  "github:post-merge-verify": "node scripts/github/post-merge-verify.mjs",
  "github:pr-preflight": "node scripts/github/pr-preflight.mjs",
  "guard:github-process": "node scripts/guards/check-github-process.mjs",
})) {
  assert(
    packageJson.scripts?.[name] === command,
    `package.json#scripts.${name} must be ${command}`
  );
}

assert(
  checkAll.includes("scripts/guards/check-github-process.mjs"),
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
assert(policy.repository?.delete_branch_on_merge === true, "merged head branches must auto-delete");
assert(
  policy.repository?.web_commit_signoff_required === true,
  "web commit signoff must be required"
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
assert(policy.dco?.enabled === true, "DCO enforcement must be enabled in policy");
assert(
  policy.dco?.script === "npm run github:check-dco",
  "DCO policy must point at npm run github:check-dco"
);
assert(policy.pullRequests?.mergeMethod === "rebase", "canonical PR merge method must be rebase");

const main = policy.branches?.main;
assert(main, "repo policy must define branches.main");
assert(main.required_linear_history === true, "main must require linear history");
assert(main.required_conversation_resolution === true, "main must require conversation resolution");
assert(
  main.required_signatures === false,
  "required signatures must stay disabled with rebase-only merges"
);
assert(main.enforce_admins === true, "main branch protection must apply to admins");
assert(main.allow_force_pushes === false, "main must block force pushes");
assert(main.allow_deletions === false, "main must block deletions");
assert(main.required_status_checks?.strict === true, "main required status checks must be strict");
assert(
  main.required_status_checks?.app_id === 15_368,
  "main required status checks must be bound to the GitHub Actions app"
);

for (const context of [
  "quality (22)",
  "quality (24)",
  "check (15)",
  "check (16)",
  "check (17)",
  "check-os (macos-latest)",
  "check-os (windows-latest)",
  "dependency-review",
  "analyze (actions)",
  "analyze (javascript-typescript)",
]) {
  assert(
    main.required_status_checks.contexts.includes(context),
    `main required status checks must include ${context}`
  );
}

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

for (const command of [
  "npm run github:check-dco",
  "npm run github:pr-preflight -- --base main",
  "npm run github:merge-preflight -- --pr <number>",
  "npm run github:post-merge-verify -- --pr <number>",
  "gh pr merge <number> --rebase --delete-branch",
]) {
  assert(prTemplate.includes(command), `.github/PULL_REQUEST_TEMPLATE.md must include ${command}`);
}

assert(
  contributing.includes("npm run github:check-dco"),
  "CONTRIBUTING.md must document the DCO checker command"
);

ok("GITHUB_PROCESS_GUARD_OK");
