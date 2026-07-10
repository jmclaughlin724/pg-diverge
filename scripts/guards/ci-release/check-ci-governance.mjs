#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { assert, ok } from "../lib/assertions.js";
import { ROOT, readJson } from "../lib/repository.js";
import {
  asArray,
  eachStep,
  findNamedStep,
  isSha40,
  jobMatrix,
  matrixValues,
  permissionsAreReadOnly,
  stepActionName,
  stepIf,
  stepName,
  stepRun,
  stepRunBefore,
  workflowFiles,
} from "./ci-yaml-primitives.mjs";

const SHOULD_CREATE_GITHUB_RELEASE_IF =
  "steps.preflight.outputs.SUPASCHEMA_RELEASE_SHOULD_CREATE_GITHUB_RELEASE == 'true'";

function assertWorkflowBasics(parsed) {
  for (const [file, { doc, raw }] of parsed) {
    assert(
      permissionsAreReadOnly(doc?.permissions),
      `${file}: top-level permissions must be read-only (contents: read or read-all); jobs elevate per-need. Got ${JSON.stringify(doc?.permissions)}`
    );

    assert(
      !(raw.includes("NODE_AUTH_TOKEN") || raw.includes("NPM_TOKEN")),
      `${file}: must not reference a stored npm token (NODE_AUTH_TOKEN/NPM_TOKEN); publishing is OIDC trusted publishing`
    );

    for (const { step } of eachStep(doc)) {
      const uses = step?.uses;
      if (typeof uses !== "string" || uses.startsWith("./")) {
        continue;
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
}

function assertCodeql(parsed) {
  const codeql = parsed.get("codeql.yml")?.doc;
  assert(codeql, "codeql.yml must exist");
  const codeqlJob = codeql.jobs?.analyze;
  assert(codeqlJob, "codeql.yml must define an analyze job");
  const codeqlLanguages = matrixValues(codeql, "analyze", "language");
  for (const language of ["actions", "javascript-typescript"]) {
    assert(
      codeqlLanguages.includes(language),
      `codeql.yml analyze language matrix must include ${language} (got ${JSON.stringify(codeqlLanguages)})`
    );
  }
  assert(
    codeqlJob.permissions?.["security-events"] === "write" &&
      codeqlJob.permissions?.actions === "read" &&
      codeqlJob.permissions?.contents === "read",
    "codeql.yml analyze job must grant security-events: write plus actions: read and contents: read"
  );
  const codeqlSteps = codeqlJob.steps ?? [];
  const codeqlInitIndex = codeqlSteps.findIndex(
    (step) => stepActionName(step) === "github/codeql-action/init"
  );
  const codeqlInitStep = codeqlSteps[codeqlInitIndex];
  const codeqlLanguageExpression = ["${{", " matrix.language ", "}}"].join("");
  assert(
    codeqlInitIndex >= 0 &&
      codeqlInitStep?.with?.languages === codeqlLanguageExpression &&
      codeqlInitStep.with?.queries === "security-and-quality" &&
      [undefined, "none"].includes(codeqlInitStep.with?.["build-mode"]),
    "codeql.yml init must use matrix.language, security-and-quality queries, and no-build analysis"
  );
  assert(
    !codeqlSteps.some((step) => stepIf(step).includes("python") || stepRun(step).includes("uv ")),
    "codeql.yml must not retain Python dependency setup after private Python service removal"
  );
  assert(
    !codeqlSteps.some((step) => "setup-python-dependencies" in (step?.with ?? {})),
    "codeql.yml must not use the deprecated CodeQL setup-python-dependencies input"
  );
}

function assertReleaseConditionals(release, publishJob) {
  assert(
    !release.raw.includes("env.SUPASCHEMA_RELEASE_SHOULD_"),
    "release.yml step conditionals must use preflight step outputs, not dynamic env context"
  );
  const prepareReleaseNotesStep = findNamedStep(
    publishJob.steps ?? [],
    "Prepare GitHub release notes"
  );
  const createGithubReleaseStep = findNamedStep(publishJob.steps ?? [], "Create GitHub release");
  assert(
    prepareReleaseNotesStep && stepIf(prepareReleaseNotesStep) === SHOULD_CREATE_GITHUB_RELEASE_IF,
    "release.yml must prepare GitHub release notes from preflight create-release output"
  );
  assert(
    createGithubReleaseStep && stepIf(createGithubReleaseStep) === SHOULD_CREATE_GITHUB_RELEASE_IF,
    "release.yml must create GitHub release from preflight create-release output"
  );
}

function assertReleasePublicationOrder(publishJob) {
  const publishIndex = (publishJob.steps ?? []).findIndex(
    (step) => stepRun(step) === 'npm publish "$SUPASCHEMA_TARBALL" --access public --provenance'
  );
  const attestIndex = (publishJob.steps ?? []).findIndex(
    (step) => stepActionName(step) === "actions/attest"
  );
  const prepareReleaseNotesIndex = (publishJob.steps ?? []).findIndex(
    (step) => stepName(step) === "Prepare GitHub release notes"
  );
  const createReleaseIndex = (publishJob.steps ?? []).findIndex(
    (step) => stepName(step) === "Create GitHub release"
  );
  assert(
    publishIndex >= 0 && attestIndex > publishIndex,
    "release.yml must attest the published tarball immediately after npm publish"
  );
  assert(
    prepareReleaseNotesIndex > attestIndex && createReleaseIndex > prepareReleaseNotesIndex,
    "release.yml must create the GitHub Release after npm publish/provenance attestation"
  );
}

function assertReleaseYaml(parsed) {
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
      (step) =>
        typeof step?.uses === "string" && step.uses.startsWith("step-security/harden-runner")
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
  assertReleaseConditionals(release, publishJob);
  assertReleasePublicationOrder(publishJob);
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
}

function assertConsumerPackageSmokeSteps(qualitySteps) {
  const preparePackageManagersStep = findNamedStep(
    qualitySteps,
    "Prepare alternate consumer package managers"
  );
  assert(
    preparePackageManagersStep &&
      stepIf(preparePackageManagersStep) === "matrix.node-version == 22" &&
      stepRun(preparePackageManagersStep).includes("corepack prepare pnpm@11.1.2 --activate") &&
      stepRun(preparePackageManagersStep).includes("corepack prepare yarn@4.16.0 --activate"),
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
}

export function check(root = ROOT) {
  const WORKFLOWS_DIR = path.join(root, ".github", "workflows");
  const files = workflowFiles(root);
  const expectedWorkflowFiles = [
    "ci.yml",
    "codeql.yml",
    "dependency-review.yml",
    "docs.yml",
    "release.yml",
    "scorecard.yml",
  ];
  assert(
    JSON.stringify(files) === JSON.stringify(expectedWorkflowFiles),
    `expected tracked workflows ${expectedWorkflowFiles.join(", ")} under .github/workflows, found ${files.join(", ")}`
  );

  const parsed = new Map();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    parsed.set(file, { doc: parseYaml(raw), raw });
  }
  const packageJson = readJson("package.json", root);

  assertWorkflowBasics(parsed);

  for (const file of ["ci.yml", "dependency-review.yml"]) {
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

  assertCodeql(parsed);

  assertReleaseYaml(parsed);

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
    packageJson.scripts?.check?.startsWith("npm run build && npm run lint"),
    "package.json check must build generated dist before lint resolves dist imports"
  );
  assert(
    stepRunBefore(qualitySteps, "npm run build", "npm run lint:ci"),
    "ci.yml quality job must build generated dist before npm run lint:ci resolves dist imports"
  );
  assert(
    !packageJson.scripts?.["github:check-dco"],
    "package.json must not expose a DCO blocker as npm run github:check-dco"
  );
  assert(
    !qualitySteps.some(
      (step) =>
        step?.name === "DCO sign-off" || String(step?.run ?? "").includes("github:check-dco")
    ),
    "ci.yml quality job must not enforce a DCO signoff blocker"
  );
  assert(
    packageJson.scripts?.["package:smoke"] === "node scripts/release/package-smoke.mjs",
    "package.json must expose one strict npm run package:smoke consumer tarball smoke"
  );
  assert(
    packageJson.scripts?.["test:consumer-lifecycle"] ===
      "vitest run tests/package/consumer.test.ts",
    "package.json must expose npm run test:consumer-lifecycle for installed-CLI consumer lifecycle proof"
  );
  assert(
    !packageJson.scripts?.["package:smoke:all"],
    "package.json must not expose a second package-smoke entry point"
  );
  const releaseVerifyScript = String(packageJson.scripts?.["release:verify"] ?? "");
  assert(
    releaseVerifyScript.includes("npm run test:consumer-lifecycle"),
    "release:verify must include npm run test:consumer-lifecycle"
  );
  assert(
    releaseVerifyScript.includes("npm run package:smoke"),
    "release:verify must include npm run package:smoke"
  );
  assert(
    releaseVerifyScript.indexOf("npm run test:consumer-lifecycle") <
      releaseVerifyScript.indexOf("npm run package:smoke"),
    "release:verify must run npm run test:consumer-lifecycle before npm run package:smoke"
  );
  assertConsumerPackageSmokeSteps(qualitySteps);

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

  assert(!files.includes("python.yml"), "python.yml must stay private with the agent MCP service");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("CI_GOVERNANCE_OK");
}
