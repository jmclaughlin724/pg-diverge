// Shared oracle for what a fully scaffolded supaschema consumer project looks
// like, regardless of whether `postinstall` or `supaschema init` produced it
// (both call the same bin/scaffold.mjs core). The install and init-parity lanes
// consume this so the two prove identical output. Keep this in sync with
// bin/scaffold.mjs's scaffoldConfig.

export const managedSchemas = [
  "auth",
  "storage",
  "realtime",
  "vault",
  "extensions",
  "cron",
  "net",
  "supabase_functions",
  "graphql",
  "graphql_public",
];

export const defaultWorkflow = {
  schema_diff: "on_schema_write",
  migration_check: "after_schema_diff",
  migration_verify: "suggest_after_check",
  migration_sync: "explicit_request_only",
  type_generation: "create_or_refresh",
  zod_generation: "create_or_refresh",
  type_usage: "zod_validated",
};

// The full config bin/scaffold.mjs writes for a fresh project, parameterized by
// the detected/selected schema + migrations layout.
export function expectedInstalledConfig(
  schemaPath: string,
  migrationsDir: string
): Record<string, unknown> {
  return {
    $schema: "./node_modules/supaschema/supaschema-config.schema.json",
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: {},
    excludedGrantRoles: [],
    hints: {
      destructive: [],
      renames: [],
    },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    migrationsDir,
    typesFile: "database.types.ts",
    zodFile: "database.zod.ts",
    normalize: "deparse",
    managedSchemas: schemaPath === "supabase/schemas" ? managedSchemas : [],
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths: [schemaPath],
    schemas: {
      exclude: [],
      include: [],
    },
    sources: {
      from: "auto",
      to: `dir:${schemaPath}`,
    },
    statementTimeout: "60s",
    transactionMode: "per-migration",
    validators: ["internal-parser"],
  };
}

// Agent-bundle + hook-wiring files a scaffolded consumer must contain.
export const installedAgentFiles = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/settings.json",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/hooks.json",
  ".codex/rules/supaschema.rules",
];

// Maintainer-only workspace files that must NOT be scaffolded into a consumer.
export const excludedMaintainerFiles = [
  ".vscode/settings.json",
  ".vscode/extensions.json",
  ".mcp.json",
  ".claude/cclsp.json",
  "components.json",
  "postgres-language-server.jsonc",
  "pyproject.toml",
  "styles/globals.css",
];
