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
  migration_sync: "auto",
  type_safety: "deploy_blocking",
  rls_safety: "deploy_blocking",
  type_generation: "create_or_refresh",
  zod_generation: "create_or_refresh",
  type_usage: "zod_validated",
};

export const defaultEnvironments = {};

export const defaultSync = {
  targets: {
    local: {
      mode: "auto",
      runner: "direct",
      historyTable: "supabase_migrations.schema_migrations",
    },
    remote: {
      mode: "manual",
      runner: "direct",
      historyTable: "supabase_migrations.schema_migrations",
      requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
      remote: true,
    },
  },
};

export const supabaseSync = {
  targets: {
    local: {
      mode: "auto",
      runner: "supabase-cli",
      historyTable: "supabase_migrations.schema_migrations",
    },
    remote: {
      mode: "manual",
      runner: "supabase-cli",
      historyTable: "supabase_migrations.schema_migrations",
      requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
      remote: true,
    },
  },
};

export function expectedInstalledConfig(
  schemaPath: string,
  migrationsDir: string
): Record<string, unknown> {
  return {
    $schema: "./node_modules/supaschema/supaschema-config.schema.json",
    adapter: "auto",
    cascade: "never",
    destructiveChanges: "hint-required",
    environments: defaultEnvironments,
    excludedGrantRoles: [],
    hints: {
      allowedGrantees: [],
      destructive: [],
      requiredPolicyColumns: {},
      renames: [],
    },
    idempotency: "required",
    lockTimeout: "5s",
    workflow: defaultWorkflow,
    sync: schemaPath === "supabase/schemas" ? supabaseSync : defaultSync,
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

export const activeAgentFiles = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/settings.json",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/hooks.json",
  ".codex/rules/supaschema.rules",
];

export const rawAgentBundleFiles = [
  "node_modules/supaschema/agent-bundle/INSTALL.md",
  "node_modules/supaschema/agent-bundle/agents/prompts/supaschema-install.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema/SKILL.md",
  "node_modules/supaschema/agent-bundle/claude/rules/supaschema.md",
  "node_modules/supaschema/agent-bundle/claude/settings.npm.json",
  "node_modules/supaschema/agent-bundle/codex/hooks.npm.json",
  "node_modules/supaschema/agent-bundle/codex/rules/supaschema.rules",
];

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
