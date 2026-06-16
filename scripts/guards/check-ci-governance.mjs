#!/usr/bin/env node
// Rule 09 (CI/CD efficiency + release governance) enforcement.
//
// Rule 01 requires every standard to have an executable enforcement path:
// "A rule, contract, or STOP gate that no guard or test reaches is incomplete."
// Rule 09's invariants (least-privilege permissions, SHA-pinned actions,
// persist-credentials:false, harden-runner + OIDC trusted publishing on the
// release path, concurrency cancellation on PR-facing workflows, required
// matrix lanes) were prose-only — no guard read `.github/workflows/**`. This
// guard parses each workflow with the `yaml` dependency (AST/structured walk,
// never regex over the workflow text — Rule 07) and asserts those invariants.
// It also guards the Python `--package supaschema-agent-mcp` selector (Rule 04)
// so the workspace-env fix cannot silently regress.
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { assert, ok, ROOT, readJson } from "./lib/guard-utils.js";

const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const HEX = "0123456789abcdef";

function isSha40(ref) {
  return typeof ref === "string" && ref.length === 40 && [...ref].every((c) => HEX.includes(c));
}

function* eachStep(doc) {
  for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      yield { jobId, job, step };
    }
  }
}

function jobMatrix(doc, jobId, key) {
  return doc?.jobs?.[jobId]?.strategy?.matrix?.[key] ?? [];
}

function permissionsAreReadOnly(perms) {
  if (perms === undefined) {
    return false;
  }
  if (typeof perms === "string") {
    return perms === "read-all" || perms === "read";
  }
  if (typeof perms === "object") {
    return Object.values(perms).every((value) => value === "read" || value === "none");
  }
  return false;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

function stepActionName(step) {
  const uses = step?.uses;
  if (typeof uses !== "string" || uses.startsWith("./")) {
    return;
  }
  const at = uses.lastIndexOf("@");
  return at > 0 ? uses.slice(0, at) : uses;
}

function stepIf(step) {
  return String(step?.if ?? "").trim();
}

function stepName(step) {
  return String(step?.name ?? "");
}

function stepRun(step) {
  return String(step?.run ?? "").trim();
}

function findNamedStep(steps, name) {
  return steps.find((step) => stepName(step) === name);
}

const files = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
assert(
  files.length >= 7,
  `expected at least 7 workflows under .github/workflows, found ${files.length}`
);

const parsed = new Map();
for (const file of files) {
  const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
  parsed.set(file, { doc: parseYaml(raw), raw });
}
const packageJson = readJson("package.json");

for (const [file, { doc, raw }] of parsed) {
  // Least privilege: no top-level write scope on any workflow.
  assert(
    permissionsAreReadOnly(doc?.permissions),
    `${file}: top-level permissions must be read-only (contents: read or read-all); jobs elevate per-need. Got ${JSON.stringify(doc?.permissions)}`
  );

  // No stored npm token anywhere: releases use OIDC trusted publishing.
  assert(
    !(raw.includes("NODE_AUTH_TOKEN") || raw.includes("NPM_TOKEN")),
    `${file}: must not reference a stored npm token (NODE_AUTH_TOKEN/NPM_TOKEN); publishing is OIDC trusted publishing`
  );

  for (const { step } of eachStep(doc)) {
    const uses = step?.uses;
    if (typeof uses !== "string" || uses.startsWith("./")) {
      continue; // not an external action pin
    }
    const at = uses.lastIndexOf("@");
    assert(at > 0, `${file}: \`uses: ${uses}\` is not pinned to a ref`);
    const ref = uses.slice(at + 1);
    const action = uses.slice(0, at);
    assert(
      isSha40(ref),
      `${file}: \`uses: ${uses}\` must pin a full 40-character commit SHA (got "${ref}")`
    );
    if (action === "actions/checkout") {
      assert(
        step?.with?.["persist-credentials"] === false,
        `${file}: actions/checkout must set with.persist-credentials: false`
      );
    }
  }
}

// Concurrency: PR-facing workflows cancel superseded runs; the publish path does not.
for (const file of ["ci.yml", "python.yml", "dependency-review.yml"]) {
  const doc = parsed.get(file)?.doc;
  assert(doc, `${file} must exist`);
  assert(
    doc.concurrency?.["cancel-in-progress"] === true,
    `${file}: PR-facing workflow must declare concurrency with cancel-in-progress: true`
  );
}
assert(
  parsed.get("release.yml")?.doc?.concurrency?.["cancel-in-progress"] !== true,
  "release.yml must not set cancel-in-progress: true (never cancel an in-flight publish)"
);

// Release publish job: OIDC + harden-runner + provenance, no stored token.
const release = parsed.get("release.yml");
assert(release, "release.yml must exist");
const releaseOn = release.doc?.on ?? {};
assert(
  !releaseOn.release,
  "release.yml must not publish from GitHub Release events; npm and GitHub releases are created from main"
);
assert(
  !releaseOn.workflow_run,
  "release.yml must not wait on workflow_run; release must not be gated on the full CI workflow"
);
assert(
  asArray(releaseOn.push?.branches).includes("main"),
  `release.yml push trigger must be scoped to main (got ${JSON.stringify(releaseOn.push?.branches)})`
);
assert(
  releaseOn.workflow_dispatch !== undefined,
  "release.yml must keep workflow_dispatch for release repair"
);
assert(
  release.doc?.concurrency?.group === "release-npm" &&
    release.doc.concurrency.queue === "max" &&
    release.doc.concurrency["cancel-in-progress"] !== true,
  "release.yml must queue npm publishes with concurrency group release-npm and queue: max"
);
const publishJob = Object.values(release.doc?.jobs ?? {}).find(
  (job) =>
    job?.permissions &&
    typeof job.permissions === "object" &&
    job.permissions["id-token"] === "write"
);
assert(
  publishJob,
  "release.yml must have a publish job with id-token: write (OIDC trusted publishing)"
);
const publishIf = String(publishJob.if ?? "");
assert(
  publishJob["runs-on"] === "ubuntu-latest",
  "release.yml publish job must run on a GitHub-hosted Ubuntu runner for npm trusted publishing"
);
assert(
  publishIf.includes("github.event_name == 'workflow_dispatch'") &&
    publishIf.includes("github.ref == 'refs/heads/main'"),
  "release.yml manual dispatch path must be scoped to refs/heads/main"
);
assert(
  publishIf.includes("github.event_name == 'push'") &&
    publishIf.includes("github.ref == 'refs/heads/main'"),
  "release.yml publish job must run on push only for refs/heads/main"
);
assert(
  publishJob.permissions?.contents === "write",
  "release.yml publish job must grant contents: write so it can create the GitHub Release/tag"
);
assert(
  !publishJob.env?.SUPASCHEMA_DATABASE_URL,
  "release.yml publish job must not configure a DB URL"
);
assert(!publishJob.services, "release.yml publish job must not start database services");
assert(
  (publishJob.steps ?? []).some(
    (step) => typeof step?.uses === "string" && step.uses.startsWith("step-security/harden-runner")
  ),
  "release.yml publish job must run step-security/harden-runner (egress monitoring on the OIDC job)"
);
const checkoutStep = (publishJob.steps ?? []).find(
  (step) => typeof step?.uses === "string" && step.uses.startsWith("actions/checkout")
);
const workflowRunHeadShaRef = ["${{", " github.sha ", "}}"].join("");
assert(
  checkoutStep?.with?.ref === workflowRunHeadShaRef,
  "release.yml checkout must use github.sha so publish and GitHub release target the merged main commit"
);
const setupNodeStep = (publishJob.steps ?? []).find(
  (step) => stepActionName(step) === "actions/setup-node"
);
assert(setupNodeStep, "release.yml publish job must set up Node for npm trusted publishing");
assert(
  Number(setupNodeStep.with?.["node-version"]) >= 24,
  `release.yml publish job must use Node 24+ for npm trusted publishing (got ${JSON.stringify(setupNodeStep.with?.["node-version"])})`
);
assert(
  setupNodeStep.with?.["package-manager-cache"] === false,
  "release.yml publish job must disable package-manager caching on the OIDC publish path"
);
assert(
  setupNodeStep.with?.["registry-url"] === "https://registry.npmjs.org",
  "release.yml publish job must configure the npm registry URL for trusted publishing"
);
assert(
  (publishJob.steps ?? []).some((step) =>
    String(step?.run ?? "").includes("node scripts/release/preflight.mjs")
  ),
  "release.yml must run release version preflight before npm ci"
);
assert(
  release.raw.includes("npm >= 11.5.1"),
  "release.yml must assert npm >= 11.5.1 for npm trusted publishing"
);
assert(
  (publishJob.steps ?? []).some((step) =>
    String(step?.run ?? "").includes("npm pack --ignore-scripts")
  ),
  "release.yml must pack the already-built package without rerunning lifecycle scripts"
);
assert(
  release.raw.includes("--provenance"),
  "release.yml must publish with explicit `npm publish --provenance` (repo policy, even though trusted publishing also generates provenance)"
);
assert(
  release.raw.includes('npm publish "$SUPASCHEMA_TARBALL"'),
  "release.yml must publish the exact tarball that was smoked"
);
assert(
  release.raw.includes("gh release create") &&
    release.raw.includes('--target "$GITHUB_SHA"') &&
    release.raw.includes("--notes-file") &&
    release.raw.includes("node scripts/release/changelog-notes.mjs") &&
    !release.raw.includes("--generate-notes"),
  "release.yml must create the GitHub Release/tag from the CHANGELOG.md release notes file"
);
assert(
  (publishJob.steps ?? []).some((step) => stepActionName(step) === "actions/attest"),
  "release.yml must use actions/attest@v4 for tarball provenance attestation"
);
assert(
  !release.raw.includes("npm run benchmark"),
  "release.yml must not run benchmark; benchmarks are advisory and must not block release publication"
);
assert(
  !release.raw.includes("gh release upload"),
  "release.yml must not upload extra artifacts to a GitHub Release; create the release/tag only"
);

// Support-contract matrices must not silently narrow.
const ci = parsed.get("ci.yml")?.doc;
assert(ci, "ci.yml must exist");
const nodes = jobMatrix(ci, "quality", "node-version");
assert(
  [22, 24].every((value) => nodes.includes(value)),
  `ci.yml quality node-version matrix must include 22 and 24 (got ${JSON.stringify(nodes)})`
);
const postgres = jobMatrix(ci, "check", "postgres");
assert(
  [15, 16, 17].every((value) => postgres.includes(value)),
  `ci.yml check postgres matrix must include 15, 16, 17 (got ${JSON.stringify(postgres)})`
);
const qualityRuns = (ci.jobs?.quality?.steps ?? []).map((step) => String(step?.run ?? ""));
assert(
  !qualityRuns.some((run) => run.includes("npm run benchmark")),
  "ci.yml quality job must not run npm run benchmark without a database URL"
);
const qualitySteps = ci.jobs?.quality?.steps ?? [];
assert(
  packageJson.scripts?.["package:smoke"] === "node scripts/release/package-smoke.mjs",
  "package.json must expose one strict npm run package:smoke consumer tarball smoke"
);
assert(
  !packageJson.scripts?.["package:smoke:all"],
  "package.json must not expose a second package-smoke entry point"
);
assert(
  String(packageJson.scripts?.["release:verify"] ?? "").includes("npm run package:smoke"),
  "release:verify must include npm run package:smoke"
);
const preparePackageManagersStep = findNamedStep(
  qualitySteps,
  "Prepare alternate consumer package managers"
);
assert(
  preparePackageManagersStep &&
    stepIf(preparePackageManagersStep) === "matrix.node-version == 22" &&
    stepRun(preparePackageManagersStep).includes("corepack prepare pnpm@10.18.1 --activate") &&
    stepRun(preparePackageManagersStep).includes("corepack prepare yarn@4.12.0 --activate"),
  "ci.yml must prepare pnpm and Yarn only for the Node 22 consumer package-smoke lane"
);
const setupBunStep = findNamedStep(qualitySteps, "Install Bun for consumer package smoke");
assert(
  setupBunStep &&
    stepIf(setupBunStep) === "matrix.node-version == 22" &&
    stepActionName(setupBunStep) === "oven-sh/setup-bun" &&
    String(setupBunStep.with?.["bun-version"]) === "1.3.14",
  "ci.yml must install pinned Bun only for the Node 22 consumer package-smoke lane"
);
const packageSmokeStep = findNamedStep(qualitySteps, "Smoke package managers from tarball");
assert(
  packageSmokeStep &&
    stepIf(packageSmokeStep) === "matrix.node-version == 22" &&
    !packageSmokeStep.env &&
    stepRun(packageSmokeStep) === "npm run package:smoke",
  "ci.yml must run npm run package:smoke with all package-manager lanes required on Node 22"
);
const examplesSmokeStep = findNamedStep(
  qualitySteps,
  "Examples smoke (shipped examples render + check clean)"
);
assert(examplesSmokeStep, "ci.yml quality job must keep the examples smoke step");
assert(
  stepIf(examplesSmokeStep) === "matrix.node-version == 22",
  "ci.yml examples smoke must run once on Node 22, not across the full quality matrix"
);
const examplesTestsStep = findNamedStep(qualitySteps, "Examples tests");
assert(examplesTestsStep, "ci.yml quality job must run the examples test lane");
assert(
  stepIf(examplesTestsStep) === "matrix.node-version == 22" &&
    stepRun(examplesTestsStep) === "npm run test:examples",
  "ci.yml examples tests must run once on Node 22 via npm run test:examples"
);
const checkRuns = (ci.jobs?.check?.steps ?? []).map((step) => String(step?.run ?? ""));
assert(
  !checkRuns.some((run) => run.includes("npm run benchmark")),
  "ci.yml check job must not run npm run benchmark; benchmarks are advisory and must not block CI"
);
assert(
  !checkRuns.some((run) => ["npm test", "npm run test:coverage"].includes(run.trim())),
  "ci.yml check job must use matrix-focused test scripts, not the full examples suite"
);
const checkSteps = ci.jobs?.check?.steps ?? [];
const dbTestsStep = findNamedStep(checkSteps, "DB-gated tests");
assert(
  dbTestsStep &&
    stepIf(dbTestsStep) === "matrix.postgres != 17" &&
    stepRun(dbTestsStep) === "npm run test:matrix",
  "ci.yml DB-gated tests must use npm run test:matrix for postgres 15/16"
);
const coverageStep = findNamedStep(
  checkSteps,
  "Coverage (pg17 runs the suite once, with coverage)"
);
assert(
  coverageStep &&
    stepIf(coverageStep) === "matrix.postgres == 17" &&
    stepRun(coverageStep) === "npm run test:matrix:coverage",
  "ci.yml pg17 coverage must use npm run test:matrix:coverage"
);
const oses = jobMatrix(ci, "check-os", "os");
assert(
  ["macos-latest", "windows-latest"].every((value) => oses.includes(value)),
  `ci.yml check-os os matrix must include macos-latest and windows-latest (got ${JSON.stringify(oses)})`
);
const osDbTestsStep = findNamedStep(
  ci.jobs?.["check-os"]?.steps ?? [],
  "DB-gated tests (DB-gated cases skip without a database)"
);
assert(
  osDbTestsStep && stepRun(osDbTestsStep) === "npm run test:matrix",
  "ci.yml check-os must use npm run test:matrix so examples failures stay in quality"
);

// Python lane must keep the workspace-member selector (Rule 04): the root env
// has no runtime deps, so mypy/pytest need --package or they fail import-not-found.
const python = parsed.get("python.yml")?.doc;
assert(python, "python.yml must exist");
const pythonSteps = python.jobs?.python?.steps ?? [];
const pythonSetupNode = pythonSteps.find((step) => stepActionName(step) === "actions/setup-node");
assert(
  pythonSetupNode?.with?.["node-version"] === 22,
  `python.yml must set up Node 22 for Code Atlas-backed FastMCP tests (got ${JSON.stringify(pythonSetupNode?.with?.["node-version"])})`
);
assert(
  pythonSetupNode?.with?.cache === "npm",
  "python.yml setup-node step must enable npm caching for Code Atlas dependencies"
);
const pythonRunSteps = (python.jobs?.python?.steps ?? []).filter(
  (step) => typeof step?.run === "string"
);
const npmInstallIndex = pythonRunSteps.findIndex(
  (step) => step.run.trim() === "npm ci --ignore-scripts"
);
const pytestIndex = pythonRunSteps.findIndex((step) => step.run.includes("pytest"));
assert(
  npmInstallIndex >= 0,
  "python.yml must install npm deps with `npm ci --ignore-scripts` for Code Atlas-backed FastMCP tests"
);
assert(
  pytestIndex >= 0 && npmInstallIndex < pytestIndex,
  "python.yml must install Code Atlas npm deps before pytest"
);
for (const tool of ["mypy", "pytest"]) {
  const steps = pythonRunSteps.filter((step) => step.run.includes(tool));
  assert(steps.length > 0, `python.yml must have a ${tool} step`);
  for (const step of steps) {
    assert(
      step.run.includes("--package supaschema-agent-mcp"),
      `python.yml ${tool} step must pass --package supaschema-agent-mcp (root env lacks fastmcp/mcp/pydantic): ${step.run}`
    );
  }
}

const pkg = readJson("package.json");
for (const script of ["py:typecheck", "py:test"]) {
  const body = pkg.scripts?.[script] ?? "";
  assert(
    body.includes("--package supaschema-agent-mcp"),
    `package.json scripts.${script} must pass --package supaschema-agent-mcp: ${body}`
  );
}

ok("CI_GOVERNANCE_OK");
