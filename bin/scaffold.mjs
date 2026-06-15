// Shared consumer-project scaffolder. This is the single owner of the install-time
// setup: it writes config, agent guidance, rules, skills, hooks, and default
// schema/migration folders into a target project, preserving user-owned
// AGENTS.md / CLAUDE.md content through a managed addendum block.
//
// Two callers use it:
//   - bin/postinstall.mjs (the npm lifecycle wrapper) statically imports it.
//   - `supaschema init` (src/cli.ts) dynamically imports it from the installed
//     package so setup is reproducible when npm does not run install scripts
//     (npm v12, ~July 2026, defaults to ignore-scripts).
//
// It depends ONLY on node: builtins (no dist, no runtime deps) so it loads safely
// at install time, and it is stdout-SILENT: it returns { installed, skipped,
// pathConfirmationNeeded, selection } and each caller prints its own summary
// (Rule 13 — lifecycle scripts must not write stdout). The install-time skip
// guards (SUPASCHEMA_SKIP_POSTINSTALL, own-checkout, INIT_CWD) stay in the
// postinstall wrapper; `init` calls this core directly with no guards.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const moduleConfigFiles = ["supaschema.config.mjs", "supaschema.config.js"];
const genericSchemaPath = "database/schemas";
const genericMigrationsDir = "database/migrations";
const supabaseSchemaPath = "supabase/schemas";
const supabaseMigrationsDir = "supabase/migrations";
const defaultTypesFile = "database.types.ts";
const defaultZodFile = "database.zod.ts";
const manifestPath = ".supaschema/install.json";
const guidanceStart = "<!-- supaschema:agent-guidance:start -->";
const guidanceEnd = "<!-- supaschema:agent-guidance:end -->";
const claudeProjectDir = shellParameter("CLAUDE_PROJECT_DIR");
const codexProjectDir = shellParameter("CODEX_PROJECT_DIR:-$PWD");
const codexGateCommand = `node "${codexProjectDir}/.codex/hooks/block-generated-migration-edits.mjs"`;
const codexAutoDiffCommand = `node "${codexProjectDir}/.codex/hooks/auto-diff-on-schema-change.mjs"`;
const codexLlmSyncCommand = `node "${codexProjectDir}/.codex/hooks/sync-llm-on-claude-surface-change.mjs"`;
const hookScriptPathPattern = /\.(mjs|sh)$/;

const agentFiles = [
  ".agents/skills/supaschema/SKILL.md",
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/rules/supaschema.rules",
  ".codex/skills/supaschema/SKILL.md",
];

const hookConfigs = [
  {
    path: ".claude/settings.json",
    config: {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|apply_patch",
            hooks: [
              {
                type: "command",
                command: "node",
                args: [`${claudeProjectDir}/.claude/hooks/block-generated-migration-edits.mjs`],
                timeout: 10,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|apply_patch",
            hooks: [
              {
                type: "command",
                command: "node",
                args: [`${claudeProjectDir}/.claude/hooks/auto-diff-on-schema-change.mjs`],
                timeout: 130,
              },
            ],
          },
          {
            matcher: "Bash|Write|Edit|MultiEdit|apply_patch",
            hooks: [
              {
                type: "command",
                command: "node",
                args: [`${claudeProjectDir}/.claude/hooks/sync-llm-on-claude-surface-change.mjs`],
                timeout: 130,
              },
            ],
          },
        ],
      },
    },
  },
  {
    path: ".codex/hooks.json",
    config: {
      hooks: {
        PreToolUse: [
          {
            matcher: "^(apply_patch|Edit|Write|edit_file)$",
            hooks: [
              {
                type: "command",
                command: codexGateCommand,
                timeout: 10,
                statusMessage: "Checking supaschema generated-migration policy",
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "^(apply_patch|Edit|Write|edit_file)$",
            hooks: [
              {
                type: "command",
                command: codexAutoDiffCommand,
                timeout: 130,
                statusMessage: "Running supaschema auto-diff on schema change",
              },
            ],
          },
          {
            matcher: "^(Bash|apply_patch|Edit|Write|edit_file)$",
            hooks: [
              {
                type: "command",
                command: codexLlmSyncCommand,
                timeout: 130,
                statusMessage: "Syncing supaschema Claude agent surfaces",
              },
            ],
          },
        ],
      },
    },
  },
];

const genericPreset = {
  adapter: "auto",
  id: "postgres",
  label: "PostgreSQL",
  migrationsDir: genericMigrationsDir,
  schemaPath: genericSchemaPath,
};

const providerPresets = [
  {
    adapter: "auto",
    id: "supabase",
    label: "Supabase",
    markers: [{ path: "supabase/config.toml" }],
    migrationsDir: supabaseMigrationsDir,
    schemaPath: supabaseSchemaPath,
  },
  {
    adapter: "auto",
    id: "neon",
    label: "Neon",
    markers: [
      { path: "neon.toml" },
      { path: ".neon/project.json" },
      { path: ".neon/config.json" },
      {
        fileNames: ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"],
        contentTerms: ["neon.tech", "neon.com"],
      },
    ],
    migrationsDir: "neon/migrations",
    schemaPath: "neon/schemas",
  },
  {
    adapter: "auto",
    id: "aws-postgresql",
    label: "RDS/Aurora PostgreSQL",
    markers: [
      {
        fileNames: ["*.tf"],
        contentTerms: ["aws_db_instance", "aws_rds_cluster", "aws_rds_global_cluster"],
      },
      {
        fileNames: ["template.yaml", "template.yml"],
        contentTerms: ["AWS::RDS::DBInstance", "AWS::RDS::DBCluster"],
      },
      {
        fileNames: [
          "cdk.json",
          "sst.config.ts",
          "sst.config.js",
          "sst.config.mjs",
          "serverless.yml",
          "serverless.yaml",
        ],
        contentTerms: ["Aurora", "DatabaseCluster", "DatabaseInstance", "RDS", "rds"],
      },
    ],
    migrationsDir: "aws-postgresql/migrations",
    schemaPath: "aws-postgresql/schemas",
  },
  {
    adapter: "auto",
    id: "alloydb",
    label: "AlloyDB",
    markers: [
      { fileNames: ["*.tf"], contentTerms: ["google_alloydb_cluster", "google_alloydb_instance"] },
      {
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
        contentTerms: ["alloydb", "alloydb.googleapis.com"],
      },
    ],
    migrationsDir: "alloydb/migrations",
    schemaPath: "alloydb/schemas",
  },
  {
    adapter: "auto",
    id: "cloud-sql",
    label: "Cloud SQL for PostgreSQL",
    markers: [
      {
        fileNames: ["*.tf"],
        contentTerms: ["google_sql_database_instance", "google_sql_database"],
      },
      {
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
        contentTerms: ["cloud_sql_instances", "CLOUD_SQL_CONNECTION_NAME", "cloudsql"],
      },
    ],
    migrationsDir: "cloud-sql/migrations",
    schemaPath: "cloud-sql/schemas",
  },
  {
    adapter: "auto",
    id: "azure-postgresql",
    label: "Azure PostgreSQL",
    markers: [
      {
        fileNames: ["*.tf"],
        contentTerms: ["azurerm_postgresql_flexible_server", "azurerm_postgresql_server"],
      },
      {
        fileNames: ["main.bicep", "azuredeploy.json"],
        contentTerms: ["Microsoft.DBforPostgreSQL/flexibleServers", "Microsoft.DBforPostgreSQL"],
      },
      {
        fileNames: ["azure.yaml"],
        contentTerms: ["postgres", "PostgreSQL", "DBforPostgreSQL"],
      },
    ],
    migrationsDir: "azure-postgresql/migrations",
    schemaPath: "azure-postgresql/schemas",
  },
];

const providerSchemaPaths = providerPresets.map((preset) => preset.schemaPath);
const providerMigrationsDirs = providerPresets.map((preset) => preset.migrationsDir);

// Scaffold a consuming project at `targetDir`. Returns the result instead of
// writing stdout; callers print their own summary. `interactive` enables the TTY
// path-confirmation prompt (still gated by canPrompt()); install and init both
// pass true and degrade to record-and-defer in CI/non-TTY automatically.
export async function scaffoldProject({
  targetDir,
  packageRoot,
  packageVersion,
  interactive = false,
}) {
  const installed = [];
  const skipped = [];
  const scan = scanProject(targetDir);
  const existingConfig = await readExistingConfig(targetDir);
  const selection = await resolvePathSelection(targetDir, scan, existingConfig, interactive);

  // When the detected paths are ambiguous (pathConfirmationNeeded), do not pin a
  // guessed config or create guessed directories. Leaving the config absent keeps
  // "config explicitly defines schemaPaths" an unambiguous signal that a human has
  // confirmed the paths, which the auto-diff hook uses to resume safely.
  if (!(existingConfig.exists || selection.pathConfirmationNeeded)) {
    writeProjectFile(targetDir, "supaschema.config.json", scaffoldConfig(selection));
    installed.push("config");
  }

  if (!selection.pathConfirmationNeeded) {
    createConfiguredDirectories(targetDir, selection);
    installed.push("directories");
  }

  for (const file of agentFiles) {
    copyProjectFile(packageRoot, targetDir, file, skipped);
  }
  installed.push("agent files");

  for (const config of hookConfigs) {
    mergeHookConfig(targetDir, config, skipped);
  }
  installed.push("hook wiring");

  installAgentGuidance(targetDir, selection);
  installed.push("AGENTS/CLAUDE addendum");

  writeInstallManifest(targetDir, packageVersion, scan, selection);
  installed.push("manifest");

  return {
    installed,
    pathConfirmationNeeded: selection.pathConfirmationNeeded,
    selection,
    skipped,
  };
}

function shellParameter(expression) {
  return ["$", "{", expression, "}"].join("");
}

async function readExistingConfig(projectDir) {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    return effectiveExistingConfig(readJson(jsonPath));
  }
  for (const file of moduleConfigFiles) {
    if (existsSync(join(projectDir, file))) {
      return effectiveExistingConfig(await importModuleConfig(join(projectDir, file)));
    }
  }
  return { exists: false };
}

// Resolve the same effective paths the CLI (`loadConfig` in src/config.ts) uses for
// an existing config: explicit values win, otherwise fall back to the CLI's static
// defaults — never provider detection, which only seeds brand-new configs. This keeps
// the installed guidance, directories, and manifest aligned with what the CLI loads,
// for sparse JSON and module configs (supaschema.config.mjs/.js) alike.
function effectiveExistingConfig(parsed) {
  const schemaPaths =
    Array.isArray(parsed?.schemaPaths) && parsed.schemaPaths.length > 0
      ? parsed.schemaPaths.map(String)
      : [genericSchemaPath];
  const migrationsDir =
    typeof parsed?.migrationsDir === "string" && parsed.migrationsDir.length > 0
      ? parsed.migrationsDir
      : genericMigrationsDir;
  return {
    adapter: normalizeAdapter(parsed?.adapter),
    exists: true,
    migrationsDir,
    provider: undefined,
    schemaPaths,
  };
}

async function importModuleConfig(modulePath) {
  try {
    const module = await import(pathToFileURL(modulePath).href);
    return module?.default ?? {};
  } catch {
    // Fail open: an unreadable module config is treated as sparse, so guidance and
    // directories fall back to the same CLI defaults the loader will use.
    return {};
  }
}

function normalizeAdapter(value) {
  if (
    value === "auto" ||
    value === "supabase-auto" ||
    value === "postgres" ||
    value === "supabase"
  ) {
    return "auto";
  }
  return;
}

async function resolvePathSelection(target, scan, existingConfig, interactive) {
  const defaults = projectDefaults(target);
  if (existingConfig.exists) {
    return {
      adapter: existingConfig.adapter,
      candidates: scan,
      migrationsDir: existingConfig.migrationsDir,
      pathConfirmationNeeded: false,
      provider: existingConfig.provider,
      schemaPaths: existingConfig.schemaPaths,
      source: "existing-config",
    };
  }

  const schema = selectCandidate(scan.schemaPaths, defaults.schemaPath);
  const migrations = selectCandidate(scan.migrationsDirs, defaults.migrationsDir);
  let selection = {
    adapter: defaults.adapter,
    candidates: scan,
    migrationsDir: migrations.path,
    pathConfirmationNeeded: schema.needsConfirmation || migrations.needsConfirmation,
    provider: defaults.provider,
    schemaPaths: [schema.path],
    source: selectionSource(schema, migrations, defaults),
  };

  if (selection.pathConfirmationNeeded && interactive && canPrompt()) {
    selection = await promptForSelection(target, selection);
  }

  return selection;
}

function selectionSource(schema, migrations, defaults) {
  if (schema.source === "default" && migrations.source === "default") {
    return defaults.source;
  }
  return "scan";
}

async function promptForSelection(target, selection) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const schemaPaths = await promptPathChoice(
      rl,
      "schema path",
      selection.candidates.schemaPaths,
      selection.schemaPaths[0] ?? projectDefaults(target).schemaPath
    );
    const migrationsDir = await promptPathChoice(
      rl,
      "migrations directory",
      selection.candidates.migrationsDirs,
      selection.migrationsDir
    );
    return {
      ...selection,
      migrationsDir,
      pathConfirmationNeeded: false,
      schemaPaths: [schemaPaths],
      source: "prompt",
    };
  } finally {
    rl.close();
  }
}

async function promptPathChoice(rl, label, candidates, fallback) {
  const choices = candidates.length > 0 ? candidates : [fallback];
  process.stdout.write(`supaschema detected ${label} candidates:\n`);
  choices.forEach((candidate, index) => {
    process.stdout.write(`  ${index + 1}. ${candidate}\n`);
  });
  const answer = await rl.question(`Choose ${label} [1-${choices.length}, default 1]: `);
  const index = Number.parseInt(answer.trim(), 10);
  return choices[Number.isInteger(index) && index >= 1 && index <= choices.length ? index - 1 : 0];
}

function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

function selectCandidate(candidates, fallback) {
  if (candidates.length === 0) {
    return { needsConfirmation: false, path: fallback, source: "default" };
  }
  if (candidates.length === 1) {
    return { needsConfirmation: false, path: candidates[0], source: "scan" };
  }
  if (candidates.includes(fallback)) {
    return { needsConfirmation: false, path: fallback, source: "standard" };
  }
  return { needsConfirmation: true, path: candidates[0], source: "ambiguous" };
}

function projectDefaults(projectDir) {
  const detected = detectProviderPreset(projectDir);
  const preset = detected?.preset ?? genericPreset;
  return {
    adapter: preset.adapter,
    migrationsDir: preset.migrationsDir,
    provider: detected
      ? {
          id: preset.id,
          label: preset.label,
          markers: detected.markers,
        }
      : undefined,
    schemaPath: preset.schemaPath,
    source: detected?.preset.id ?? "default",
  };
}

function detectProviderPreset(projectDir) {
  const files = walkFiles(projectDir, 5);
  for (const preset of providerPresets) {
    const markers = [];
    for (const marker of preset.markers) {
      markers.push(...matchingProviderMarkers(projectDir, files, marker));
    }
    if (markers.length > 0) {
      return { markers, preset };
    }
  }
  return;
}

function matchingProviderMarkers(projectDir, files, marker) {
  if (typeof marker.path === "string") {
    const absolute = join(projectDir, marker.path);
    if (!existsSync(absolute)) {
      return [];
    }
    if (!marker.contentTerms || fileContainsAny(absolute, marker.contentTerms)) {
      return [marker.path];
    }
    return [];
  }

  const matched = [];
  for (const file of files) {
    const name = file.split(sep).at(-1) ?? "";
    if (!marker.fileNames.some((pattern) => fileNameMatches(pattern, name))) {
      continue;
    }
    if (!marker.contentTerms || fileContainsAny(file, marker.contentTerms)) {
      matched.push(rel(projectDir, file));
    }
  }
  return matched;
}

function fileNameMatches(pattern, name) {
  if (!pattern.includes("*")) {
    return pattern === name;
  }
  const [prefix, suffix] = pattern.split("*");
  return name.startsWith(prefix) && name.endsWith(suffix);
}

function fileContainsAny(path, terms) {
  try {
    const content = readFileSync(path, "utf8");
    return terms.some((term) => content.includes(term));
  } catch {
    return false;
  }
}

function scanProject(projectDir) {
  const defaults = projectDefaults(projectDir);
  const dirs = walkDirectories(projectDir, 5);
  return {
    migrationsDirs: rankCandidates(
      dirs
        .filter((dir) => isMigrationsCandidate(projectDir, dir))
        .map((dir) => rel(projectDir, dir)),
      [
        defaults.migrationsDir,
        ...providerMigrationsDirs,
        genericMigrationsDir,
        "migrations",
        "db/migrations",
      ]
    ),
    schemaPaths: rankCandidates(
      dirs.filter((dir) => isSchemaCandidate(projectDir, dir)).map((dir) => rel(projectDir, dir)),
      [
        defaults.schemaPath,
        ...providerSchemaPaths,
        genericSchemaPath,
        "schemas",
        "schema",
        "db/schemas",
        "db/schema",
      ]
    ),
  };
}

function walkDirectories(projectDir, maxDepth) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) {
        continue;
      }
      const child = join(dir, entry.name);
      out.push(child);
      visit(child, depth + 1);
    }
  };
  visit(projectDir, 1);
  return out;
}

function walkFiles(projectDir, maxDepth) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          visit(join(dir, entry.name), depth + 1);
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(join(dir, entry.name));
      }
    }
  };
  visit(projectDir, 1);
  return out;
}

function shouldSkipDir(name) {
  return new Set([
    ".git",
    ".next",
    ".nuxt",
    ".supaschema",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]).has(name);
}

function isSchemaCandidate(projectDir, dir) {
  const name = dir.split(sep).at(-1);
  const path = rel(projectDir, dir);
  if (name === "migrations") {
    return false;
  }
  return (
    path === genericSchemaPath ||
    providerSchemaPaths.includes(path) ||
    name === "schemas" ||
    name === "schema" ||
    hasSqlFiles(dir)
  );
}

function isMigrationsCandidate(projectDir, dir) {
  const name = dir.split(sep).at(-1);
  const path = rel(projectDir, dir);
  return (
    path === genericMigrationsDir || providerMigrationsDirs.includes(path) || name === "migrations"
  );
}

function hasSqlFiles(dir) {
  try {
    return readdirSync(dir).some((entry) => {
      const path = join(dir, entry);
      return statSync(path).isFile() && entry.endsWith(".sql");
    });
  } catch {
    return false;
  }
}

function rankCandidates(candidates, preferredOrder) {
  const unique = Array.from(new Set(candidates)).sort();
  return unique.sort((left, right) => rank(left, preferredOrder) - rank(right, preferredOrder));
}

function rank(candidate, preferredOrder) {
  const index = preferredOrder.indexOf(candidate);
  return index === -1 ? preferredOrder.length + candidate.split("/").length : index;
}

function scaffoldConfig(selection) {
  const config = {
    $schema: "./node_modules/supaschema/supaschema-config.schema.json",
    adapter: selection.adapter ?? "auto",
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
    migrationsDir: selection.migrationsDir,
    typesFile: defaultTypesFile,
    zodFile: defaultZodFile,
    normalize: "deparse",
    managedSchemas: [
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
    ],
    postgresVersion: "15+",
    renameDetection: "hints-only",
    schemaPaths: selection.schemaPaths,
    schemas: {
      exclude: [],
      include: [],
    },
    sources: {
      from: "auto",
      to: `dir:${selection.schemaPaths[0] ?? genericSchemaPath}`,
    },
    statementTimeout: "60s",
    transactionMode: "per-migration",
    validators: ["internal-parser"],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function createConfiguredDirectories(target, selection) {
  for (const schemaPath of selection.schemaPaths) {
    mkdirSync(join(target, schemaPath), { recursive: true });
  }
  mkdirSync(join(target, selection.migrationsDir), { recursive: true });
}

function installAgentGuidance(target, selection) {
  const block = agentGuidanceBlock(selection);
  upsertManagedBlock(target, "AGENTS.md", block);
  upsertManagedBlock(target, "CLAUDE.md", block);
}

function agentGuidanceBlock(selection) {
  const pathLines = selection.pathConfirmationNeeded
    ? `- Path confirmation is pending: multiple schema/migration path candidates were detected. Inspect \`${manifestPath}\`, ask the user which detected schema and migrations paths to use, then set \`schemaPaths\`, \`sources.to\`, and \`migrationsDir\` in \`supaschema.config.json\` before the first diff.
- Generated migrations and \`-- supaschema: lineage\` files must not be hand-edited; regenerate from the declarative tree once the paths are confirmed.`
    : `- Schema intent belongs in \`${selection.schemaPaths.join("`, `")}\`.
- Generated migrations write to \`${selection.migrationsDir}\`; files containing \`-- supaschema: lineage\` must not be hand-edited.`;
  return `${guidanceStart}
## supaschema

This project uses supaschema for declarative PostgreSQL migrations. The configured paths below are authoritative; install can seed provider-specific folders for Supabase, Neon, RDS/Aurora PostgreSQL, Cloud SQL, AlloyDB, Azure PostgreSQL, or a neutral PostgreSQL layout.

${pathLines}
- Generated type outputs use \`${defaultTypesFile}\` and \`${defaultZodFile}\` unless \`typesFile\` or \`zodFile\` is changed in config.
- Edit \`supaschema.config.json\` to change \`adapter\`, \`schemaPaths\`, \`sources\`, \`migrationsDir\`, \`typesFile\`, \`zodFile\`, \`managedSchemas\`, \`transactionMode\`, or named \`environments\`; use \`$ENV_NAME\` database URL references instead of committing credentials.
- For schema changes, read \`.agents/skills/supaschema/SKILL.md\` and the matching Claude/Codex rule file, edit declarative SQL, run \`npx supaschema diff\`, then run \`npx supaschema check\`.
- Hooks in \`.claude/settings.json\` and \`.codex/hooks.json\` enforce generated-migration protection and auto-run diff/check after schema SQL writes; they never apply migrations.
- Do not run \`npx supaschema sync --local\` or \`npx supaschema sync --remote\` unless explicitly asked to apply migrations.
${guidanceEnd}
`;
}

function upsertManagedBlock(target, relativePath, block) {
  const path = join(target, relativePath);
  const current = readText(path) ?? "";
  const start = current.indexOf(guidanceStart);
  const end = current.indexOf(guidanceEnd);
  let next;
  if (start !== -1 && end !== -1 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + guidanceEnd.length)}`;
  } else {
    next = current.trim().length > 0 ? `${current.trimEnd()}\n\n${block}` : block;
  }
  writeProjectFile(target, relativePath, next.endsWith("\n") ? next : `${next}\n`);
}

function writeInstallManifest(target, packageVersion, scan, selection) {
  const manifest = {
    adapter: selection.adapter ?? "auto",
    candidates: scan,
    installedAt: new Date().toISOString(),
    migrationsDir: selection.migrationsDir,
    packageVersion,
    pathConfirmationNeeded: selection.pathConfirmationNeeded,
    provider: selection.provider,
    schemaPaths: selection.schemaPaths,
    source: selection.source,
  };
  const existing = readJson(join(target, manifestPath));
  if (existing && manifestSelectionUnchanged(existing, manifest)) {
    // No setup choice changed: keep the committed manifest byte-for-byte so a
    // re-install in a clean checkout stays idempotent. The volatile installedAt
    // timestamp and rescanned candidates (the directories the first run created)
    // would otherwise dirty the tree on every npm install.
    return;
  }
  writeProjectFile(target, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function manifestSelectionUnchanged(existing, next) {
  return (
    existing.adapter === next.adapter &&
    existing.migrationsDir === next.migrationsDir &&
    existing.pathConfirmationNeeded === next.pathConfirmationNeeded &&
    JSON.stringify(existing.schemaPaths) === JSON.stringify(next.schemaPaths)
  );
}

function writeProjectFile(target, relativePath, contents) {
  const destination = join(target, relativePath);
  writeFileAtomic(destination, contents);
}

function copyProjectFile(packageRoot, target, relativePath, skipped) {
  const source = join(packageRoot, relativePath);
  if (!existsSync(source)) {
    skipped.push(relativePath);
    return;
  }
  const destination = join(target, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function mergeHookConfig(target, hookConfig, skipped) {
  const source = hookConfig.config;
  const destination = join(target, hookConfig.path);
  const existing = readJsonIfPresent(destination);
  if (!source || existing === undefined) {
    skipped.push(hookConfig.path);
    return;
  }

  const merged = mergeHooks(existing, source);
  writeFileAtomic(destination, `${JSON.stringify(merged, null, 2)}\n`);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return;
  }
}

function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return isMissingFile(error) ? {} : undefined;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}

function isMissingFile(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function writeFileAtomic(destination, contents) {
  const directory = dirname(destination);
  mkdirSync(directory, { recursive: true });
  const temp = join(
    directory,
    `.supaschema-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    writeFileSync(temp, contents, { flag: "wx" });
    renameSync(temp, destination);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Best-effort cleanup. The original write error is more useful.
    }
    throw error;
  }
}

function mergeHooks(existing, source) {
  const merged = isRecord(existing) ? structuredClone(existing) : {};
  const sourceHooks = isRecord(source.hooks) ? source.hooks : {};
  const mergedHooks = isRecord(merged.hooks) ? merged.hooks : {};
  merged.hooks = mergedHooks;

  for (const [eventName, sourceEntries] of Object.entries(sourceHooks)) {
    if (!Array.isArray(sourceEntries)) {
      continue;
    }
    const sourceHookDefs = sourceEntries.flatMap(hookDefinitions);
    const signatures = new Set(sourceHookDefs.map(hookSignature));
    const managedScripts = new Set(
      sourceHookDefs.map(managedHookScript).filter((name) => name !== undefined)
    );
    const existingEntries = Array.isArray(mergedHooks[eventName]) ? mergedHooks[eventName] : [];
    mergedHooks[eventName] = [
      ...withoutManagedHooks(existingEntries, signatures, managedScripts),
      ...structuredClone(sourceEntries),
    ];
  }

  return merged;
}

function withoutManagedHooks(entries, signatures, managedScripts) {
  const kept = [];
  for (const entry of entries) {
    if (!(isRecord(entry) && Array.isArray(entry.hooks))) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter((hook) => !isSupersededHook(hook, signatures, managedScripts));
    if (hooks.length > 0) {
      kept.push({ ...entry, hooks });
    }
  }
  return kept;
}

// A previously-installed managed hook is superseded by the incoming source when its
// command+args signature matches exactly (a same-version re-install) OR by managed
// script identity — an upgrade where the old command wrapped the same script through
// a different path prefix. This avoids removing unrelated user hooks that also run
// through `node`.
function isSupersededHook(hook, signatures, managedScripts) {
  if (!isRecord(hook)) {
    return false;
  }
  if (signatures.has(hookSignature(hook))) {
    return true;
  }
  const script = managedHookScript(hook);
  return script !== undefined && managedScripts.has(script);
}

function managedHookScript(hook) {
  if (!isRecord(hook)) {
    return;
  }
  const scriptArg = Array.isArray(hook.args)
    ? hook.args.find((arg) => typeof arg === "string" && hookScriptPathPattern.test(arg))
    : undefined;
  if (typeof scriptArg === "string") {
    return basenameFromCommand(scriptArg);
  }
  const command = typeof hook.command === "string" ? hook.command : "";
  return basenameFromCommand(command);
}

function basenameFromCommand(command) {
  const lastSlash = command.lastIndexOf("/");
  if (lastSlash === -1) {
    return;
  }
  let end = command.length;
  while (end > 0) {
    const char = command[end - 1];
    if (char === '"' || char === "'" || char === " " || char === "\t") {
      end -= 1;
      continue;
    }
    break;
  }
  const name = command.slice(lastSlash + 1, end);
  return name.endsWith(".mjs") || name.endsWith(".sh") ? name : undefined;
}

function hookDefinitions(entry) {
  if (!(isRecord(entry) && Array.isArray(entry.hooks))) {
    return [];
  }
  return entry.hooks.filter((hook) => isRecord(hook) && typeof hook.command === "string");
}

function hookSignature(hook) {
  return JSON.stringify({
    args: Array.isArray(hook.args) ? hook.args : undefined,
    command: typeof hook.command === "string" ? hook.command : "",
  });
}

function rel(projectDir, path) {
  return relative(projectDir, path).split(sep).join("/");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
