const contract = JSON.parse(`{
  "allProviderPresets": [
    {
      "adapter": "auto",
      "id": "postgres",
      "label": "PostgreSQL",
      "managedSchemas": [],
      "markers": [],
      "migrationsDir": "database/migrations",
      "schemaPath": "database/schemas"
    },
    {
      "adapter": "auto",
      "id": "supabase",
      "label": "Supabase",
      "managedSchemas": [
        "auth",
        "storage",
        "realtime",
        "vault",
        "extensions",
        "cron",
        "net",
        "supabase_functions",
        "graphql",
        "graphql_public"
      ],
      "markers": [
        {
          "path": "supabase/config.toml"
        }
      ],
      "migrationsDir": "supabase/migrations",
      "schemaPath": "supabase/schemas"
    },
    {
      "adapter": "auto",
      "id": "neon",
      "label": "Neon",
      "managedSchemas": [],
      "markers": [
        {
          "path": "neon.toml"
        },
        {
          "path": ".neon/project.json"
        },
        {
          "path": ".neon/config.json"
        },
        {
          "contentTerms": [
            "neon.tech",
            "neon.com"
          ],
          "fileNames": [
            "drizzle.config.ts",
            "drizzle.config.js",
            "drizzle.config.mjs"
          ]
        }
      ],
      "migrationsDir": "neon/migrations",
      "schemaPath": "neon/schemas"
    },
    {
      "adapter": "auto",
      "id": "aws-postgresql",
      "label": "RDS/Aurora PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "aws_db_instance",
            "aws_rds_cluster",
            "aws_rds_global_cluster"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "AWS::RDS::DBInstance",
            "AWS::RDS::DBCluster"
          ],
          "fileNames": [
            "template.yaml",
            "template.yml"
          ]
        },
        {
          "contentTerms": [
            "Aurora",
            "DatabaseCluster",
            "DatabaseInstance",
            "RDS",
            "rds"
          ],
          "fileNames": [
            "cdk.json",
            "sst.config.ts",
            "sst.config.js",
            "sst.config.mjs",
            "serverless.yml",
            "serverless.yaml"
          ]
        }
      ],
      "migrationsDir": "aws-postgresql/migrations",
      "schemaPath": "aws-postgresql/schemas"
    },
    {
      "adapter": "auto",
      "id": "alloydb",
      "label": "AlloyDB",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "google_alloydb_cluster",
            "google_alloydb_instance"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "alloydb",
            "alloydb.googleapis.com"
          ],
          "fileNames": [
            "cloudbuild.yaml",
            "cloudbuild.yml",
            "app.yaml",
            "app.yml"
          ]
        }
      ],
      "migrationsDir": "alloydb/migrations",
      "schemaPath": "alloydb/schemas"
    },
    {
      "adapter": "auto",
      "id": "cloud-sql",
      "label": "Cloud SQL for PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "google_sql_database_instance",
            "google_sql_database"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "cloud_sql_instances",
            "CLOUD_SQL_CONNECTION_NAME",
            "cloudsql"
          ],
          "fileNames": [
            "cloudbuild.yaml",
            "cloudbuild.yml",
            "app.yaml",
            "app.yml"
          ]
        }
      ],
      "migrationsDir": "cloud-sql/migrations",
      "schemaPath": "cloud-sql/schemas"
    },
    {
      "adapter": "auto",
      "id": "azure-postgresql",
      "label": "Azure PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "azurerm_postgresql_flexible_server",
            "azurerm_postgresql_server"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "Microsoft.DBforPostgreSQL/flexibleServers",
            "Microsoft.DBforPostgreSQL"
          ],
          "fileNames": [
            "main.bicep",
            "azuredeploy.json"
          ]
        },
        {
          "contentTerms": [
            "postgres",
            "PostgreSQL",
            "DBforPostgreSQL"
          ],
          "fileNames": [
            "azure.yaml"
          ]
        }
      ],
      "migrationsDir": "azure-postgresql/migrations",
      "schemaPath": "azure-postgresql/schemas"
    }
  ],
  "adapterInputValues": [
    "auto"
  ],
  "cascadePolicies": [
    "never"
  ],
  "canonicalSchemaId": "https://supaschema.com/schemas/supaschema-config.schema.json",
  "configFieldMetadata": [
    {
      "default": "Generated configs point to the package schema.",
      "description": "JSON Schema pointer for editor autocomplete and validation. The loader ignores it.",
      "examples": [
        "./node_modules/supaschema/supaschema-config.schema.json",
        "./supaschema-config.schema.json"
      ],
      "key": "$schema"
    },
    {
      "allowed": [
        "auto"
      ],
      "default": "auto",
      "description": "Provider-neutral adapter sentinel.",
      "key": "adapter"
    },
    {
      "allowed": [
        "never"
      ],
      "default": "never",
      "description": "CASCADE is never emitted by generated migrations.",
      "key": "cascade"
    },
    {
      "allowed": [
        "hint-required",
        "block",
        "allow"
      ],
      "default": "hint-required",
      "description": "Controls whether destructive operations require exact hints, always block, or are allowed.",
      "key": "destructiveChanges"
    },
    {
      "default": {},
      "description": "Named database URL references for --env. Use $ENV_NAME values instead of committed credentials.",
      "examples": [
        {},
        {
          "staging": {
            "databaseUrl": "$STAGING_DB"
          }
        }
      ],
      "key": "environments"
    },
    {
      "default": [],
      "description": "Grant/default-privilege roles to remove from extracted models, usually provider platform roles.",
      "key": "excludedGrantRoles"
    },
    {
      "default": {
        "allowedGrantees": [],
        "destructive": [],
        "requiredPolicyColumns": {},
        "renames": []
      },
      "description": "Reviewed grant, RLS policy-column, destructive-change, and rename hints using exact object keys, table keys, or role names.",
      "key": "hints"
    },
    {
      "allowed": [
        "required"
      ],
      "default": "required",
      "description": "Generated SQL must be replay-safe by construction.",
      "key": "idempotency"
    },
    {
      "default": "5s",
      "description": "Migration preamble SET lock_timeout value.",
      "key": "lockTimeout"
    },
    {
      "default": {
        "schema_diff": "on_schema_write",
        "migration_check": "after_schema_diff",
        "migration_verify": "suggest_after_check",
        "migration_sync": "auto",
        "type_safety": "deploy_blocking",
        "rls_safety": "deploy_blocking",
        "type_generation": "create_or_refresh",
        "zod_generation": "create_or_refresh",
        "type_usage": "zod_validated"
      },
      "description": "Automation policy for hooks, generated contract guidance, verification guidance, deploy safety gates, and whether bare sync may select one apply target.",
      "key": "workflow"
    },
    {
      "default": {
        "targets": {
          "local": {
            "mode": "auto",
            "runner": "direct",
            "historyTable": "supabase_migrations.schema_migrations"
          },
          "remote": {
            "mode": "manual",
            "runner": "direct",
            "historyTable": "supabase_migrations.schema_migrations",
            "requireApprovalEnv": "SUPASCHEMA_REMOTE_SYNC_APPROVED",
            "remote": true
          }
        }
      },
      "description": "Named apply targets for supaschema sync. workflow.migration_sync is the global apply policy; bare sync may select at most one target with mode auto.",
      "examples": [
        {
          "targets": {
            "local": {
              "mode": "auto",
              "runner": "direct",
              "historyTable": "supabase_migrations.schema_migrations"
            },
            "remote": {
              "mode": "manual",
              "runner": "direct",
              "historyTable": "supabase_migrations.schema_migrations",
              "requireApprovalEnv": "SUPASCHEMA_REMOTE_SYNC_APPROVED",
              "remote": true
            }
          }
        }
      ],
      "key": "sync"
    },
    {
      "default": "database/migrations",
      "description": "Directory where diff writes migrations and zero-arg check/verify read pending migrations.",
      "examples": [
        "database/migrations",
        "supabase/migrations",
        "neon/migrations",
        "aws-postgresql/migrations"
      ],
      "key": "migrationsDir",
      "pathKind": "directory"
    },
    {
      "default": "database.types.ts",
      "description": "Output file for TypeScript database types generated by supaschema types.",
      "key": "typesFile",
      "pathKind": "file"
    },
    {
      "default": "database.zod.ts",
      "description": "Output file for Zod runtime schemas generated by supaschema types.",
      "key": "zodFile",
      "pathKind": "file"
    },
    {
      "allowed": [
        "off",
        "deparse"
      ],
      "default": "deparse",
      "description": "Controls canonical SQL deparse normalization for extracted objects.",
      "key": "normalize"
    },
    {
      "default": [],
      "description": "Externally owned schemas blocked from declarative ownership. Supabase installs seed the Supabase platform schema list.",
      "examples": [
        [],
        [
          "auth",
          "storage",
          "realtime",
          "vault",
          "extensions",
          "cron",
          "net",
          "supabase_functions",
          "graphql",
          "graphql_public"
        ]
      ],
      "key": "managedSchemas"
    },
    {
      "default": "15+",
      "description": "Documented supported PostgreSQL syntax floor.",
      "key": "postgresVersion"
    },
    {
      "allowed": [
        "hints-only",
        "off"
      ],
      "default": "hints-only",
      "description": "Controls whether reviewed hints can render guarded renames.",
      "key": "renameDetection"
    },
    {
      "default": [
        "database/schemas"
      ],
      "description": "Declarative SQL tree roots. Each root is read recursively; the first path usually matches sources.to.",
      "examples": [
        [
          "database/schemas"
        ],
        [
          "supabase/schemas"
        ],
        [
          "neon/schemas"
        ],
        [
          "aws-postgresql/schemas"
        ]
      ],
      "key": "schemaPaths",
      "pathKind": "directory-list"
    },
    {
      "default": {
        "exclude": [],
        "include": []
      },
      "description": "Persistent schema include/exclude filters applied to extracted models.",
      "key": "schemas"
    },
    {
      "default": {
        "from": "auto",
        "to": "dir:database/schemas"
      },
      "description": "Default before/after sources for zero-source-flag diff, plan, and verify. Keep sources.to explicit even when it matches schemaPaths[0].",
      "examples": [
        {
          "from": "auto",
          "to": "dir:database/schemas"
        },
        {
          "from": "dir:baseline/schemas",
          "to": "dir:database/schemas"
        }
      ],
      "key": "sources"
    },
    {
      "default": "60s",
      "description": "Migration preamble SET statement_timeout value.",
      "key": "statementTimeout"
    },
    {
      "allowed": [
        "per-migration",
        "per-statement"
      ],
      "default": "per-migration",
      "description": "Transaction model used by verification and transaction-hazard diagnostics.",
      "key": "transactionMode"
    },
    {
      "default": [
        "internal-parser"
      ],
      "description": "Configured external validator commands. The internal parser always remains the correctness owner.",
      "examples": [
        [
          "internal-parser"
        ],
        [
          "internal-parser",
          "squawk"
        ]
      ],
      "key": "validators"
    }
  ],
  "configSchemaFileName": "supaschema-config.schema.json",
  "defaultEnvironments": {},
  "defaultMigrationHistoryTable": "supabase_migrations.schema_migrations",
  "defaultSync": {
    "targets": {
      "local": {
        "mode": "auto",
        "runner": "direct",
        "historyTable": "supabase_migrations.schema_migrations"
      },
      "remote": {
        "mode": "manual",
        "runner": "direct",
        "historyTable": "supabase_migrations.schema_migrations",
        "requireApprovalEnv": "SUPASCHEMA_REMOTE_SYNC_APPROVED",
        "remote": true
      }
    }
  },
  "defaultTypesFile": "database.types.ts",
  "defaultZodFile": "database.zod.ts",
  "defaultWorkflow": {
    "schema_diff": "on_schema_write",
    "migration_check": "after_schema_diff",
    "migration_verify": "suggest_after_check",
    "migration_sync": "auto",
    "type_safety": "deploy_blocking",
    "rls_safety": "deploy_blocking",
    "type_generation": "create_or_refresh",
    "zod_generation": "create_or_refresh",
    "type_usage": "zod_validated"
  },
  "destructiveChangesPolicies": [
    "hint-required",
    "block",
    "allow"
  ],
  "deploySafetyPolicies": [
    "disabled",
    "report_only",
    "deploy_blocking"
  ],
  "generatedOutputPolicies": [
    "disabled",
    "refresh_existing",
    "create_or_refresh"
  ],
  "genericMigrationsDir": "database/migrations",
  "genericProviderId": "postgres",
  "genericProviderPreset": {
    "adapter": "auto",
    "id": "postgres",
    "label": "PostgreSQL",
    "managedSchemas": [],
    "markers": [],
    "migrationsDir": "database/migrations",
    "schemaPath": "database/schemas"
  },
  "genericSchemaPath": "database/schemas",
  "localSchemaRef": "./supaschema-config.schema.json",
  "migrationCheckPolicies": [
    "manual",
    "after_schema_diff",
    "required_before_complete"
  ],
  "migrationSyncPolicies": [
    "disabled",
    "manual",
    "auto"
  ],
  "migrationVerifyPolicies": [
    "manual",
    "suggest_after_check",
    "after_schema_diff"
  ],
  "normalizePolicies": [
    "off",
    "deparse"
  ],
  "packageSchemaRef": "./node_modules/supaschema/supaschema-config.schema.json",
  "providerMigrationsDirs": [
    "supabase/migrations",
    "neon/migrations",
    "aws-postgresql/migrations",
    "alloydb/migrations",
    "cloud-sql/migrations",
    "azure-postgresql/migrations"
  ],
  "providerPresets": [
    {
      "adapter": "auto",
      "id": "supabase",
      "label": "Supabase",
      "managedSchemas": [
        "auth",
        "storage",
        "realtime",
        "vault",
        "extensions",
        "cron",
        "net",
        "supabase_functions",
        "graphql",
        "graphql_public"
      ],
      "markers": [
        {
          "path": "supabase/config.toml"
        }
      ],
      "migrationsDir": "supabase/migrations",
      "schemaPath": "supabase/schemas"
    },
    {
      "adapter": "auto",
      "id": "neon",
      "label": "Neon",
      "managedSchemas": [],
      "markers": [
        {
          "path": "neon.toml"
        },
        {
          "path": ".neon/project.json"
        },
        {
          "path": ".neon/config.json"
        },
        {
          "contentTerms": [
            "neon.tech",
            "neon.com"
          ],
          "fileNames": [
            "drizzle.config.ts",
            "drizzle.config.js",
            "drizzle.config.mjs"
          ]
        }
      ],
      "migrationsDir": "neon/migrations",
      "schemaPath": "neon/schemas"
    },
    {
      "adapter": "auto",
      "id": "aws-postgresql",
      "label": "RDS/Aurora PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "aws_db_instance",
            "aws_rds_cluster",
            "aws_rds_global_cluster"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "AWS::RDS::DBInstance",
            "AWS::RDS::DBCluster"
          ],
          "fileNames": [
            "template.yaml",
            "template.yml"
          ]
        },
        {
          "contentTerms": [
            "Aurora",
            "DatabaseCluster",
            "DatabaseInstance",
            "RDS",
            "rds"
          ],
          "fileNames": [
            "cdk.json",
            "sst.config.ts",
            "sst.config.js",
            "sst.config.mjs",
            "serverless.yml",
            "serverless.yaml"
          ]
        }
      ],
      "migrationsDir": "aws-postgresql/migrations",
      "schemaPath": "aws-postgresql/schemas"
    },
    {
      "adapter": "auto",
      "id": "alloydb",
      "label": "AlloyDB",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "google_alloydb_cluster",
            "google_alloydb_instance"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "alloydb",
            "alloydb.googleapis.com"
          ],
          "fileNames": [
            "cloudbuild.yaml",
            "cloudbuild.yml",
            "app.yaml",
            "app.yml"
          ]
        }
      ],
      "migrationsDir": "alloydb/migrations",
      "schemaPath": "alloydb/schemas"
    },
    {
      "adapter": "auto",
      "id": "cloud-sql",
      "label": "Cloud SQL for PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "google_sql_database_instance",
            "google_sql_database"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "cloud_sql_instances",
            "CLOUD_SQL_CONNECTION_NAME",
            "cloudsql"
          ],
          "fileNames": [
            "cloudbuild.yaml",
            "cloudbuild.yml",
            "app.yaml",
            "app.yml"
          ]
        }
      ],
      "migrationsDir": "cloud-sql/migrations",
      "schemaPath": "cloud-sql/schemas"
    },
    {
      "adapter": "auto",
      "id": "azure-postgresql",
      "label": "Azure PostgreSQL",
      "managedSchemas": [],
      "markers": [
        {
          "contentTerms": [
            "azurerm_postgresql_flexible_server",
            "azurerm_postgresql_server"
          ],
          "fileNames": [
            "*.tf"
          ]
        },
        {
          "contentTerms": [
            "Microsoft.DBforPostgreSQL/flexibleServers",
            "Microsoft.DBforPostgreSQL"
          ],
          "fileNames": [
            "main.bicep",
            "azuredeploy.json"
          ]
        },
        {
          "contentTerms": [
            "postgres",
            "PostgreSQL",
            "DBforPostgreSQL"
          ],
          "fileNames": [
            "azure.yaml"
          ]
        }
      ],
      "migrationsDir": "azure-postgresql/migrations",
      "schemaPath": "azure-postgresql/schemas"
    }
  ],
  "providerSchemaPaths": [
    "supabase/schemas",
    "neon/schemas",
    "aws-postgresql/schemas",
    "alloydb/schemas",
    "cloud-sql/schemas",
    "azure-postgresql/schemas"
  ],
  "renameDetectionPolicies": [
    "hints-only",
    "off"
  ],
  "runtimeSourcePrefixes": [
    "dir:",
    "git:",
    "database:",
    "dump:",
    "catalog:",
    "empty:"
  ],
  "schemaDiffPolicies": [
    "disabled",
    "manual",
    "on_schema_write"
  ],
  "sourceAuto": "auto",
  "sourcePrefixes": [
    "auto",
    "dir:",
    "git:",
    "database:",
    "dump:",
    "catalog:",
    "empty:"
  ],
  "supabaseManagedSchemas": [
    "auth",
    "storage",
    "realtime",
    "vault",
    "extensions",
    "cron",
    "net",
    "supabase_functions",
    "graphql",
    "graphql_public"
  ],
  "supportedValidators": [
    "internal-parser",
    "squawk",
    "squawk-cli",
    "pgls",
    "postgres-language-server",
    "@postgres-language-server/cli",
    "sqlfluff"
  ],
  "syncTargetModes": [
    "manual",
    "auto"
  ],
  "syncTargetRunners": [
    "direct",
    "supabase-cli"
  ],
  "transactionModes": [
    "per-migration",
    "per-statement"
  ],
  "typeUsagePolicies": [
    "typescript_only",
    "zod_validated"
  ]
}`);

export const configSchemaFileName = contract.configSchemaFileName;
export const canonicalSchemaId = contract.canonicalSchemaId;
export const packageSchemaRef = contract.packageSchemaRef;
export const localSchemaRef = contract.localSchemaRef;
export const genericProviderId = contract.genericProviderId;
export const genericSchemaPath = contract.genericSchemaPath;
export const genericMigrationsDir = contract.genericMigrationsDir;
export const defaultTypesFile = contract.defaultTypesFile;
export const defaultZodFile = contract.defaultZodFile;
export const defaultMigrationHistoryTable = contract.defaultMigrationHistoryTable;
export const defaultEnvironments = contract.defaultEnvironments;
export const defaultSync = contract.defaultSync;
export const adapterInputValues = contract.adapterInputValues;
export const defaultWorkflow = contract.defaultWorkflow;
export const supabaseManagedSchemas = contract.supabaseManagedSchemas;
export const supportedValidators = contract.supportedValidators;
export const sourceAuto = contract.sourceAuto;
export const runtimeSourcePrefixes = contract.runtimeSourcePrefixes;
export const sourcePrefixes = contract.sourcePrefixes;
export const schemaDiffPolicies = contract.schemaDiffPolicies;
export const migrationCheckPolicies = contract.migrationCheckPolicies;
export const migrationVerifyPolicies = contract.migrationVerifyPolicies;
export const migrationSyncPolicies = contract.migrationSyncPolicies;
export const deploySafetyPolicies = contract.deploySafetyPolicies;
export const generatedOutputPolicies = contract.generatedOutputPolicies;
export const typeUsagePolicies = contract.typeUsagePolicies;
export const syncTargetModes = contract.syncTargetModes;
export const syncTargetRunners = contract.syncTargetRunners;
export const destructiveChangesPolicies = contract.destructiveChangesPolicies;
export const normalizePolicies = contract.normalizePolicies;
export const renameDetectionPolicies = contract.renameDetectionPolicies;
export const transactionModes = contract.transactionModes;
export const cascadePolicies = contract.cascadePolicies;
export const providerPresets = contract.providerPresets;
export const genericProviderPreset = contract.genericProviderPreset;
export const allProviderPresets = contract.allProviderPresets;
export const providerSchemaPaths = contract.providerSchemaPaths;
export const providerMigrationsDirs = contract.providerMigrationsDirs;
export const configFieldMetadata = contract.configFieldMetadata;

export function canonicalSourceTo(schemaPaths = [genericSchemaPath]) {
  return `dir:${schemaPaths[0] ?? genericSchemaPath}`;
}

export function parseRuntimeSource(source) {
  for (const prefix of runtimeSourcePrefixes) {
    if (!source.startsWith(prefix)) {
      continue;
    }
    return {
      kind: prefix.slice(0, -1),
      payload: source.slice(prefix.length),
    };
  }
}

export function isRuntimeSource(source) {
  return parseRuntimeSource(source) !== undefined;
}

export function isConfigSource(source, allowAuto) {
  return (allowAuto && source === sourceAuto) || isRuntimeSource(source);
}

export function sourceHint(allowAuto) {
  return `Use ${allowAuto ? '"auto" or ' : ""}${runtimeSourcePrefixes.join(", ")}.`;
}

export function providerPreset(providerId) {
  return allProviderPresets.find((preset) => preset.id === providerId) ?? genericProviderPreset;
}

export function managedSchemasForProvider(providerId) {
  return [...providerPreset(providerId).managedSchemas];
}

export function syncForInstalledConfig(options = {}) {
  if (options.providerId === "supabase") {
    return {
      targets: {
        local: {
          mode: "auto",
          runner: "supabase-cli",
          historyTable: defaultMigrationHistoryTable,
        },
        remote: {
          mode: "manual",
          runner: "supabase-cli",
          historyTable: defaultMigrationHistoryTable,
          requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
          remote: true,
        },
      },
    };
  }
  const localDatabaseUrl = databaseUrlEnvReference(options.localDatabaseUrlEnv);
  const remoteDatabaseUrl = databaseUrlEnvReference(options.remoteDatabaseUrlEnv);
  return {
    targets: {
      local: {
        mode: "auto",
        runner: "direct",
        ...(localDatabaseUrl === undefined ? {} : { databaseUrl: localDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
      },
      remote: {
        mode: "manual",
        runner: "direct",
        ...(remoteDatabaseUrl === undefined ? {} : { databaseUrl: remoteDatabaseUrl }),
        historyTable: defaultMigrationHistoryTable,
        requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
        remote: true,
      },
    },
  };
}

function databaseUrlEnvReference(name) {
  if (typeof name !== "string") {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

export function createInstalledConfig(options = {}) {
  const provider = providerPreset(options.providerId);
  const schemaPaths = normalizedStringArray(options.schemaPaths, [provider.schemaPath]);
  const migrationsDir = normalizedString(options.migrationsDir, provider.migrationsDir);
  const sync = syncForInstalledConfig({ ...options, providerId: provider.id });
  const managedSchemas = managedSchemasForProvider(provider.id);
  const managedSchemaExcludes = provider.id === "supabase" ? managedSchemas : [];
  return orderInstalledConfig({
    $schema: options.schemaRef ?? packageSchemaRef,
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: defaultEnvironments,
    excludedGrantRoles: [],
    hints: { allowedGrantees: [], destructive: [], requiredPolicyColumns: {}, renames: [] },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    sync,
    migrationsDir,
    typesFile: defaultTypesFile,
    zodFile: defaultZodFile,
    normalize: "deparse",
    managedSchemas,
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths,
    schemas: { exclude: managedSchemaExcludes, include: [] },
    sources: { from: "auto", to: canonicalSourceTo(schemaPaths) },
    statementTimeout: "60s",
    transactionMode: "per-migration",
    validators: ["internal-parser"],
  });
}

export function mergeInstalledConfig(existing, options = {}) {
  const base = createInstalledConfig(options);
  if (!isRecord(existing)) {
    return base;
  }
  const baseSync = isRecord(base.sync) ? base.sync : defaultSync;
  const baseSchemas = isRecord(base.schemas) ? base.schemas : {};
  const schemaPaths = normalizedStringArray(existing.schemaPaths, base.schemaPaths);
  const existingEnvironments = isRecord(existing.environments) ? existing.environments : undefined;
  const hasExistingEnvironments =
    existingEnvironments !== undefined && !isLegacyDefaultEnvironments(existingEnvironments);
  const existingSync = normalizeInstalledSync(
    isRecord(existing.sync) ? existing.sync : undefined,
    existingEnvironments !== undefined && isLegacyDefaultEnvironments(existingEnvironments),
    baseSync
  );
  const existingWorkflow = isRecord(existing.workflow)
    ? normalizeInstalledWorkflow(existing.workflow)
    : {};
  const managedSchemas = normalizedStringArray(existing.managedSchemas, base.managedSchemas);
  const existingSchemas = isRecord(existing.schemas) ? existing.schemas : {};
  const baseManagedExcludes = normalizedStringArray(baseSchemas.exclude, []).filter((schema) =>
    managedSchemas.includes(schema)
  );
  const merged = {
    ...base,
    ...existing,
    $schema: normalizedString(existing.$schema, base.$schema),
    adapter: "auto",
    environments: hasExistingEnvironments ? existingEnvironments : base.environments,
    excludedGrantRoles: normalizedStringArray(existing.excludedGrantRoles, base.excludedGrantRoles),
    hints: { ...base.hints, ...(isRecord(existing.hints) ? existing.hints : {}) },
    managedSchemas,
    migrationsDir: normalizedString(existing.migrationsDir, base.migrationsDir),
    schemaPaths,
    schemas: {
      ...baseSchemas,
      ...existingSchemas,
      exclude: uniqueStrings([
        ...baseManagedExcludes,
        ...normalizedStringArray(existingSchemas.exclude, []),
      ]),
      include: normalizedStringArray(
        existingSchemas.include,
        normalizedStringArray(baseSchemas.include, [])
      ),
    },
    sources: { ...base.sources, ...(isRecord(existing.sources) ? existing.sources : {}) },
    sync:
      hasExistingEnvironments && existingSync === undefined
        ? { targets: {} }
        : { ...baseSync, ...(existingSync ?? {}) },
    workflow: { ...base.workflow, ...existingWorkflow },
    typesFile: normalizedString(existing.typesFile, base.typesFile),
    validators: normalizedStringArray(existing.validators, base.validators),
    zodFile: normalizedString(existing.zodFile, base.zodFile),
  };
  if (typeof merged.sources.to !== "string" || merged.sources.to.length === 0) {
    merged.sources.to = canonicalSourceTo(schemaPaths);
  }
  if (typeof merged.sources.from !== "string" || merged.sources.from.length === 0) {
    merged.sources.from = "auto";
  }
  return orderInstalledConfig(merged);
}

function normalizeInstalledWorkflow(workflow) {
  const next = { ...workflow };
  if (next.migration_sync === "explicit_request_only") {
    next.migration_sync = "manual";
  }
  return next;
}

function isLegacyDefaultEnvironments(environments) {
  const entries = Object.entries(environments);
  if (entries.length !== 2) {
    return false;
  }
  return (
    environmentDatabaseUrl(environments.local) === "$LOCAL_DATABASE_URL" &&
    environmentDatabaseUrl(environments.production) === "$PRODUCTION_DATABASE_URL"
  );
}

function environmentDatabaseUrl(value) {
  const record = isRecord(value) ? value : undefined;
  return typeof record?.databaseUrl === "string" ? record.databaseUrl : undefined;
}

function normalizeInstalledSync(sync, legacyDefaultEnvironments, baseSync) {
  if (sync === undefined || !legacyDefaultEnvironments) {
    return sync;
  }
  const targets = isRecord(sync.targets) ? sync.targets : undefined;
  if (targets === undefined) {
    return sync;
  }
  const normalizedTargets = {};
  for (const [name, value] of Object.entries(targets)) {
    normalizedTargets[name] = normalizeLegacyDefaultSyncTarget(name, value, baseSync);
  }
  return { ...sync, targets: normalizedTargets };
}

function normalizeLegacyDefaultSyncTarget(name, value, baseSync) {
  if (!isRecord(value)) {
    return value;
  }
  if (name !== "local" && name !== "remote") {
    return value;
  }
  const legacyEnvironment = name === "local" ? "local" : "production";
  if (value.environment !== legacyEnvironment || value.databaseUrl !== undefined) {
    return value;
  }
  const baseTargets = isRecord(baseSync.targets) ? baseSync.targets : {};
  return baseTargets[name] ?? value;
}

export function orderInstalledConfig(config) {
  return {
    $schema: config.$schema,
    adapter: config.adapter,
    cascade: config.cascade,
    destructiveChanges: config.destructiveChanges,
    environments: config.environments,
    excludedGrantRoles: config.excludedGrantRoles,
    hints: config.hints,
    idempotency: config.idempotency,
    lockTimeout: config.lockTimeout,
    workflow: config.workflow,
    sync: config.sync,
    migrationsDir: config.migrationsDir,
    typesFile: config.typesFile,
    zodFile: config.zodFile,
    normalize: config.normalize,
    managedSchemas: config.managedSchemas,
    postgresVersion: config.postgresVersion,
    renameDetection: config.renameDetection,
    schemaPaths: config.schemaPaths,
    schemas: config.schemas,
    sources: config.sources,
    statementTimeout: config.statementTimeout,
    transactionMode: config.transactionMode,
    validators: config.validators,
  };
}

function normalizedString(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizedStringArray(value, fallback) {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : [...fallback];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
