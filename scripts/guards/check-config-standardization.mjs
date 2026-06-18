#!/usr/bin/env node
import { readFileSync } from "node:fs";

const fieldKeys = [
  "$schema",
  "adapter",
  "cascade",
  "destructiveChanges",
  "environments",
  "excludedGrantRoles",
  "hints",
  "idempotency",
  "lockTimeout",
  "workflow",
  "sync",
  "migrationsDir",
  "typesFile",
  "zodFile",
  "normalize",
  "managedSchemas",
  "postgresVersion",
  "renameDetection",
  "schemaPaths",
  "schemas",
  "sources",
  "statementTimeout",
  "transactionMode",
  "validators",
];

const schema = JSON.parse(read("supaschema-config.schema.json"));
assert(
  schema.$id === "https://supaschema.com/schemas/supaschema-config.schema.json",
  "supaschema-config.schema.json must use the canonical absolute $id"
);
const schemaProperties = schema.properties ?? {};
assert(
  JSON.stringify(schemaProperties.adapter?.enum) === JSON.stringify(["auto"]),
  "supaschema-config.schema.json adapter must allow only auto"
);
for (const key of fieldKeys) {
  assert(schemaProperties[key], `supaschema-config.schema.json is missing ${key}`);
  assert(
    typeof schemaProperties[key].description === "string" &&
      schemaProperties[key].description.length > 0,
    `supaschema-config.schema.json property ${key} is missing a description`
  );
}
const sourceProperties = schemaProperties.sources?.properties ?? {};
const workflowProperties = schemaProperties.workflow?.properties ?? {};
assert(
  JSON.stringify(sourceProperties.from?.oneOf) ===
    JSON.stringify([
      { const: "auto" },
      {
        pattern: "^(?:(?:dir|database|dump|catalog):.+|git:.*|empty:)$",
        type: "string",
      },
    ]),
  "sources.from must allow only auto or a supported source spec"
);
assert(
  sourceProperties.to?.pattern === "^(?:(?:dir|database|dump|catalog):.+|git:.*|empty:)$",
  "sources.to must require a supported source spec"
);
assert(
  JSON.stringify(workflowProperties.migration_sync?.enum) ===
    JSON.stringify(["disabled", "manual", "auto"]),
  "workflow.migration_sync must allow only disabled, manual, and auto"
);
assert(
  workflowProperties.migration_sync?.default === "auto",
  'workflow.migration_sync must default to "auto"'
);

const docs = read("docs/configuration/config-file.mdx");
const docsRows = {
  hints: ["| `hints.destructive`", "| `hints.renames`"],
  schemas: ["| `schemas.include`"],
  sources: ["| `sources.from`", "| `sources.to`"],
  sync: ["| `sync.targets.<name>`"],
  workflow: ["| `workflow.schema_diff`", "| `workflow.migration_sync`"],
};
for (const key of fieldKeys) {
  const rows = docsRows[key] ?? [`| \`${key}\``];
  assert(
    rows.some((row) => docs.includes(row)),
    `configuration docs are missing option row for ${key}`
  );
}
assert(
  docs.includes("supaschema config validate --json"),
  "configuration docs must document config validate --json"
);
assert(
  docs.includes("supaschema init --dry-run --json"),
  "configuration docs must document init --dry-run --json"
);

const scaffold = read("bin/scaffold.mjs");
assert(
  scaffold.includes('from "./config-contract.mjs"'),
  "bin/scaffold.mjs must import the generated config contract mirror"
);
for (const forbidden of ["normalizeAdapter", "supabase-auto"]) {
  assert(
    !scaffold.includes(forbidden),
    `bin/scaffold.mjs must not preserve adapter compatibility (${forbidden})`
  );
}
for (const forbidden of [
  '"supaschema.config.mjs"',
  '"supaschema.config.js"',
  "'supaschema.config.mjs'",
  "'supaschema.config.js'",
  "`supaschema.config.mjs`",
  "`supaschema.config.js`",
  "pathToFileURL",
]) {
  assert(
    !scaffold.includes(forbidden),
    `bin/scaffold.mjs must not preserve JavaScript config compatibility (${forbidden})`
  );
}
for (const forbidden of [
  '"auth",',
  '"supabase/migrations"',
  '"neon/migrations"',
  '"aws-postgresql/migrations"',
]) {
  assert(
    !scaffold.includes(forbidden),
    `bin/scaffold.mjs must not hard-code provider/config contract value ${forbidden}`
  );
}

const mirror = read("bin/config-contract.mjs");
assert(
  mirror.startsWith("const contract = JSON.parse(`"),
  "bin/config-contract.mjs must be generated from src/config-contract.ts"
);

const configSource = read("src/config.ts");
assert(
  configSource.includes("createInstalledConfig()"),
  "src/config.ts defaultConfigFile must come from createInstalledConfig()"
);
for (const forbidden of ["normalizeAdapter"]) {
  assert(
    !configSource.includes(forbidden),
    `src/config.ts must not preserve adapter compatibility (${forbidden})`
  );
}
assert(
  !configSource.includes("supaschema.config.mjs"),
  "src/config.ts must not load JavaScript config files"
);

const contractSource = read("src/config-contract.ts");
for (const forbidden of [
  "normalizeAdapter",
  "explicit_request_only",
  "auto_local",
  "auto_targets",
]) {
  assert(
    !contractSource.includes(forbidden),
    `src/config-contract.ts must not preserve removed config compatibility (${forbidden})`
  );
}

const cliReportsSource = read("src/cli-reports.ts");
for (const forbidden of ['.option("--local"', '.option("--remote"']) {
  assert(
    !cliReportsSource.includes(forbidden),
    `src/cli-reports.ts must not expose removed sync compatibility alias ${forbidden}`
  );
}

console.log("check-config-standardization: ok");

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`check-config-standardization: ${message}`);
    process.exit(1);
  }
}
