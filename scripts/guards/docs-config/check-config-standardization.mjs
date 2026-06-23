#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`check-config-standardization: ${message}`);
  }
}

function read(root, file) {
  return readFileSync(path.join(root, file), "utf8");
}

export function check(root = process.cwd()) {
  const schema = JSON.parse(read(root, "supaschema-config.schema.json"));
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
          type: "string",
          not: { const: "auto" },
          "x-supaschema-source-parser": "parseRuntimeSource",
        },
      ]),
    "sources.from must allow only auto or a supported source spec"
  );
  assert(
    sourceProperties.to?.["x-supaschema-source-parser"] === "parseRuntimeSource",
    "sources.to must use the canonical source parser"
  );
  assert(
    JSON.stringify(workflowProperties.migration_sync?.enum) ===
      JSON.stringify(["disabled", "manual", "auto"]),
    "workflow.migration_sync must allow only disabled, manual, and auto"
  );
  assert(
    !JSON.stringify(workflowProperties.migration_sync).includes("explicit_request_only"),
    "workflow.migration_sync schema must not allow removed explicit_request_only values"
  );
  assert(
    workflowProperties.migration_sync?.default === "auto",
    'workflow.migration_sync must default to "auto"'
  );

  const docs = read(root, "docs/configuration/config-file.mdx");
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

  const scaffold = read(root, "bin/scaffold.mjs");
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

  const mirror = read(root, "bin/config-contract.mjs");
  assert(
    mirror.startsWith("const contract = JSON.parse(`"),
    "bin/config-contract.mjs must be generated from src/config/contract.ts"
  );

  const configSource = read(root, "src/config/schema.ts");
  assert(
    configSource.includes("createInstalledConfig()"),
    "src/config/schema.ts defaultConfigFile must come from createInstalledConfig()"
  );
  for (const forbidden of ["normalizeAdapter"]) {
    assert(
      !configSource.includes(forbidden),
      `src/config/schema.ts must not preserve adapter compatibility (${forbidden})`
    );
  }
  assert(
    !configSource.includes("supaschema.config.mjs"),
    "src/config/schema.ts must not load JavaScript config files"
  );

  const contractSource = read(root, "src/config/contract.ts");
  for (const forbidden of ["normalizeAdapter", "auto_local", "auto_targets"]) {
    assert(
      !contractSource.includes(forbidden),
      `src/config/contract.ts must not preserve removed config compatibility (${forbidden})`
    );
  }
  assert(
    contractSource.includes('next.migration_sync === "explicit_request_only"') &&
      contractSource.includes("MigrationSyncPolicy.Manual"),
    "src/config/contract.ts must repair removed migration_sync scaffold values to manual"
  );
  assert(
    mirror.includes('next.migration_sync === "explicit_request_only"') &&
      mirror.includes('next.migration_sync = "manual"'),
    "bin/config-contract.mjs must mirror removed migration_sync scaffold repair"
  );

  const cliReportsSource = read(root, "src/cli/reports.ts");
  for (const forbidden of ['.option("--local"', '.option("--remote"']) {
    assert(
      !cliReportsSource.includes(forbidden),
      `src/cli/reports.ts must not expose removed sync compatibility alias ${forbidden}`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    check();
    console.log("check-config-standardization: ok");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
