#!/usr/bin/env node
import { parse as parseYaml } from "yaml";
import { extractChangelogEntry } from "../release/changelog-notes.mjs";
import { assert, ok, readJson, readText } from "./lib/guard-utils.js";

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const version = packageJson.version;

assert(typeof version === "string" && version.length > 0, "package.json version must be set");
assert(
  packageLock.version === version,
  `package-lock.json version must match package.json version ${version}`
);
assert(
  packageLock.packages?.[""]?.version === version,
  `package-lock.json root package version must match package.json version ${version}`
);

const changelog = readText("CHANGELOG.md");
try {
  extractChangelogEntry(changelog, version);
} catch (error) {
  assert(false, error.message);
}

const actionText = readText("action.yml");
const actionRunnerText = readText("scripts/actions/run-supaschema-action.mjs");
const action = parseYaml(actionText);
const actionVersionInput = action?.inputs?.version;
assert(actionVersionInput, "action.yml must declare inputs.version");
assert(
  actionVersionInput.default === undefined,
  "action.yml inputs.version.default must stay unset; the runner defaults from package.json"
);
assert(
  typeof actionVersionInput.description === "string" &&
    actionVersionInput.description.includes("Exact supaschema npm version") &&
    actionVersionInput.description.includes("package.json version"),
  "action.yml inputs.version.description must require an exact supaschema npm version"
);
assert(
  !actionText.includes("default: latest"),
  "action.yml inputs.version.default must never be an npm dist-tag"
);

assert(
  actionRunnerText.includes("use an exact npm version"),
  "supaschema action runner version validation must tell users to use an exact npm version"
);
assert(
  actionRunnerText.includes("../../package.json") &&
    actionRunnerText.includes("resolveActionVersion"),
  "supaschema action runner must default the action version from package.json"
);
assert(
  !actionRunnerText.includes(`e.g. ${version}`),
  "supaschema action runner must not duplicate package.json version in validation text"
);
assert(
  !actionRunnerText.includes("latest|next"),
  "supaschema action runner version validation must not allow npm dist-tags"
);

ok("RELEASE_VERSION_SURFACES_OK");
