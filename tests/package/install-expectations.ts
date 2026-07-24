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
  migration_check: "after_schema_diff",
  migration_sync: "auto",
  migration_verify: "suggest_after_check",
  rls_safety: "report_only",
  schema_diff: "on_schema_write",
  type_generation: "create_or_refresh",
  type_safety: "report_only",
  type_usage: "zod_validated",
  zod_generation: "create_or_refresh",
};

export const defaultEnvironments = {};

export const defaultSync = {
  targets: {
    local: {
      historyTable: "supabase_migrations.schema_migrations",
      mode: "auto",
      runner: "direct",
    },
    remote: {
      historyTable: "supabase_migrations.schema_migrations",
      mode: "manual",
      remote: true,
      requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
      runner: "direct",
    },
  },
};

export const supabaseSync = {
  targets: {
    local: {
      historyTable: "supabase_migrations.schema_migrations",
      mode: "auto",
      runner: "supabase-cli",
    },
    remote: {
      historyTable: "supabase_migrations.schema_migrations",
      mode: "manual",
      remote: true,
      requireApprovalEnv: "SUPASCHEMA_REMOTE_SYNC_APPROVED",
      runner: "supabase-cli",
    },
  },
};

export function expectedInstalledConfig(
  schemaPath: string,
  migrationsDir: string,
  options: { workflow?: Partial<typeof defaultWorkflow> } = {}
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
      renames: [],
      requiredPolicyColumns: {},
    },
    idempotency: "required",
    lockTimeout: "5s",
    managedSchemaOverlays: [],
    managedSchemas: schemaPath === "supabase/schemas" ? managedSchemas : [],
    migrationsDir,
    normalize: "deparse",
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths: [schemaPath],
    schemas: {
      exclude: schemaPath === "supabase/schemas" ? managedSchemas : [],
      include: [],
    },
    sources: {
      from: "auto",
    },
    statementTimeout: "60s",
    sync: schemaPath === "supabase/schemas" ? supabaseSync : defaultSync,
    transactionMode: "per-migration",
    typesFile: "database.types.ts",
    validators: ["internal-parser"],
    workflow: { ...defaultWorkflow, ...(options.workflow ?? {}) },
    zodFile: "database.zod.ts",
  };
}

export const bashGuardAgentFiles = [
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
];

export const activeAgentFiles = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema-maintain/references/commands.md",
  ".agents/skills/supaschema-maintain/SKILL.md",
  ".agents/skills/supaschema-migrate/references/commands.md",
  ".agents/skills/supaschema-migrate/SKILL.md",
  ".agents/skills/supaschema/SKILL.md",
  ".claude/rules/supaschema.md",
  ".claude/settings.json",
  ".claude/skills/supaschema-maintain/references/commands.md",
  ".claude/skills/supaschema-maintain/SKILL.md",
  ".claude/skills/supaschema-migrate/references/commands.md",
  ".claude/skills/supaschema-migrate/SKILL.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks.json",
  ".codex/rules/supaschema.rules",
  ...bashGuardAgentFiles,
];

export const rawAgentBundleFiles = [
  "node_modules/supaschema/agent-bundle/INSTALL.md",
  "node_modules/supaschema/agent-bundle/skills-manifest.json",
  "node_modules/supaschema/agent-bundle/docs/coding-agents.mdx",
  "node_modules/supaschema/agent-bundle/docs/index.md",
  "node_modules/supaschema/agent-bundle/agents/prompts/supaschema-install.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema-maintain/references/commands.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema-maintain/SKILL.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema-migrate/references/commands.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema-migrate/SKILL.md",
  "node_modules/supaschema/agent-bundle/agents/skills/supaschema/SKILL.md",
  "node_modules/supaschema/agent-bundle/claude/hooks/guards/bash-policy-checks.mjs",
  "node_modules/supaschema/agent-bundle/claude/rules/supaschema.md",
  "node_modules/supaschema/agent-bundle/claude/settings.npm.json",
  "node_modules/supaschema/agent-bundle/claude/skills/supaschema-maintain/references/commands.md",
  "node_modules/supaschema/agent-bundle/claude/skills/supaschema-maintain/SKILL.md",
  "node_modules/supaschema/agent-bundle/claude/skills/supaschema-migrate/references/commands.md",
  "node_modules/supaschema/agent-bundle/claude/skills/supaschema-migrate/SKILL.md",
  "node_modules/supaschema/agent-bundle/claude/skills/supaschema/SKILL.md",
  "node_modules/supaschema/agent-bundle/codex/hooks/general-guard.mjs",
  "node_modules/supaschema/agent-bundle/codex/hooks/guards/bash-policy-checks.mjs",
  "node_modules/supaschema/agent-bundle/codex/hooks.npm.json",
  "node_modules/supaschema/agent-bundle/codex/rules/supaschema.rules",
];

export const excludedMaintainerFiles = [
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/skills",
  ".vscode/settings.json",
  ".vscode/extensions.json",
  ".mcp.json",
  "cclsp.json",
  "components.json",
  "postgres-language-server.jsonc",
  "pyproject.toml",
  "styles/globals.css",
];

export const expectedSupaschemaScripts = {
  "supaschema:check": "supaschema check",
  "supaschema:diff": "supaschema diff",
  "supaschema:stage": "supaschema stage",
  "supaschema:types": "supaschema types",
};
