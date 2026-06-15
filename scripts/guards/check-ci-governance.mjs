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
assert(
  (publishJob.steps ?? []).some(
    (step) => typeof step?.uses === "string" && step.uses.startsWith("step-security/harden-runner")
  ),
  "release.yml publish job must run step-security/harden-runner (egress monitoring on the OIDC job)"
);
assert(
  release.raw.includes("--provenance"),
  "release.yml must publish with `npm publish --provenance` (build provenance attestation)"
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
const oses = jobMatrix(ci, "check-os", "os");
assert(
  ["macos-latest", "windows-latest"].every((value) => oses.includes(value)),
  `ci.yml check-os os matrix must include macos-latest and windows-latest (got ${JSON.stringify(oses)})`
);

// Python lane must keep the workspace-member selector (Rule 04): the root env
// has no runtime deps, so mypy/pytest need --package or they fail import-not-found.
const python = parsed.get("python.yml")?.doc;
assert(python, "python.yml must exist");
const pythonRunSteps = (python.jobs?.python?.steps ?? []).filter(
  (step) => typeof step?.run === "string"
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
