import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  defaultTypesFile,
  defaultZodFile,
  genericMigrationsDir,
  genericProviderPreset,
  genericSchemaPath,
  mergeInstalledConfig,
  providerMigrationsDirs,
  providerPresets,
  providerSchemaPaths,
} from "./config-contract.mjs";

const manifestPath = ".supaschema/install.json";
const guidanceStart = "<!-- supaschema:agent-guidance:start -->";
const guidanceEnd = "<!-- supaschema:agent-guidance:end -->";
const claudeProjectDir = shellParameter("CLAUDE_PROJECT_DIR");
const pnpmWorkspaceFile = "pnpm-workspace.yaml";
const pnpmBuildApprovalLine = "  supaschema: true";
const databaseUrlEnvPriority = [
  "DIRECT_URL",
  "DATABASE_DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_DATABASE_URL",
  "PGDATABASE_URL",
];
const agentPaths = [
  ".agents/prompts/supaschema-install.md",
  ".agents/skills/supaschema",
  ".claude/hooks/guards/bash-policy-checks.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/rules/supaschema.rules",
];
const nonCanonicalAgentPaths = [".codex/skills/supaschema"];

function hookConfigsFor(targetDir, packageManager = detectPackageManager(targetDir)) {
  const runner = localRunnerForPackageManager(packageManager);
  return [
    {
      path: ".claude/settings.json",
      config: claudeHookConfig(runner),
    },
    {
      path: ".codex/hooks.json",
      configFile: ".codex/hooks.json",
      transform: (config) => materializeCodexRunner(config, runner),
    },
  ];
}

export async function scaffoldProject({
  targetDir,
  packageRoot,
  packageVersion,
  interactive = false,
  dryRun = false,
  repair = false,
}) {
  const installed = [];
  const skipped = [];
  const packageManager = detectPackageManager(targetDir);
  const scan = scanProject(targetDir);
  const existingConfig = readExistingConfig(targetDir);
  const selection = await resolvePathSelection(targetDir, scan, existingConfig, interactive);
  const configContents = selection.pathConfirmationNeeded
    ? undefined
    : scaffoldConfig(selection, existingConfig.parsed);

  if (configContents !== undefined && shouldWriteConfig(existingConfig, repair)) {
    if (!dryRun) {
      writeProjectFile(targetDir, "supaschema.config.json", configContents);
    }
    installed.push(existingConfig.exists ? "config repair" : "config");
  }

  if (!selection.pathConfirmationNeeded) {
    if (!dryRun) {
      createConfiguredDirectories(targetDir, selection);
    }
    installed.push("directories");
  }

  copyAgentBundle({ dryRun, packageRoot, skipped, targetDir });
  removeNonCanonicalAgentSurfaces({ dryRun, targetDir });
  installed.push("agent files");

  for (const config of hookConfigsFor(targetDir, packageManager)) {
    if (!dryRun) {
      mergeHookConfig(packageRoot, targetDir, config, skipped);
    }
  }
  installed.push("hook wiring");

  if (ensurePnpmBuildApproval({ dryRun, packageManager, targetDir })) {
    installed.push("pnpm build approval");
  }

  if (!dryRun) {
    installAgentGuidance(targetDir, selection);
  }
  installed.push("AGENTS/CLAUDE addendum");

  writeInstallState({ dryRun, existingConfig, packageVersion, scan, selection, targetDir });
  if (selection.pathConfirmationNeeded) {
    installed.push("manifest");
  }

  return {
    config: configContents === undefined ? undefined : JSON.parse(configContents),
    existingConfig,
    dryRun,
    installed,
    pathConfirmationNeeded: selection.pathConfirmationNeeded,
    selection,
    skipped,
  };
}

function shellParameter(expression) {
  return ["$", "{", expression, "}"].join("");
}

function claudeHookConfig(runner) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node",
              args: [`${claudeProjectDir}/.claude/hooks/guards/bash-policy-checks.mjs`],
              timeout: 10,
            },
          ],
        },
        {
          matcher: "Write|Edit|MultiEdit|apply_patch",
          hooks: [
            {
              type: "command",
              command: runner.command,
              args: [...runner.args, "hook", "generated-migration-edit", "--runtime", "claude"],
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
              command: runner.command,
              args: [...runner.args, "hook", "schema-write"],
              timeout: 130,
            },
          ],
        },
      ],
      PostToolBatch: [
        {
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
  };
}

function localRunnerForPackageManager(packageManager) {
  if (packageManager === "pnpm") {
    return {
      args: ["exec", "supaschema"],
      command: "pnpm",
      commandString: "pnpm exec supaschema",
    };
  }
  if (packageManager === "yarn") {
    return {
      args: ["exec", "supaschema"],
      command: "yarn",
      commandString: "yarn exec supaschema",
    };
  }
  if (packageManager === "bun") {
    return {
      args: ["--no-install", "supaschema"],
      command: "bunx",
      commandString: "bunx --no-install supaschema",
    };
  }
  return {
    args: ["exec", "--", "supaschema"],
    command: "npm",
    commandString: "npm exec -- supaschema",
  };
}

function detectPackageManager(projectDir) {
  const manifestSignals = [];
  const lockfileSignals = [];
  for (const dir of packageManagerEvidenceDirs(projectDir)) {
    const manifest = readJson(join(dir, "package.json"));
    const manifestManager = manifestPackageManager(manifest);
    if (manifestManager !== undefined) {
      manifestSignals.push(manifestManager);
    }
    lockfileSignals.push(...lockfilePackageManagers(dir));
  }
  const signals = [...new Set([...manifestSignals, ...lockfileSignals])];
  if (signals.length > 1) {
    throw new Error(`conflicting package-manager signals: ${signals.join(", ")}`);
  }
  return signals[0] ?? "npm";
}

function packageManagerEvidenceDirs(projectDir) {
  if (!(hasPackageManagerEvidence(projectDir) || existsSync(join(projectDir, "package.json")))) {
    return [projectDir];
  }
  const dirs = [];
  let current = projectDir;
  while (true) {
    dirs.push(current);
    if (current !== projectDir && hasPackageManagerEvidence(current)) {
      return dirs;
    }
    if (current === projectDir && hasPackageManagerEvidence(current)) {
      return dirs;
    }
    const parent = dirname(current);
    if (parent === current) {
      return dirs;
    }
    current = parent;
  }
}

function hasPackageManagerEvidence(dir) {
  const manifest = readJson(join(dir, "package.json"));
  return (
    manifestPackageManager(manifest) !== undefined ||
    manifestHasWorkspaces(manifest) ||
    lockfilePackageManagers(dir).length > 0
  );
}

function manifestHasWorkspaces(manifest) {
  return Array.isArray(manifest?.workspaces) || isRecord(manifest?.workspaces);
}

function manifestPackageManager(manifest) {
  const direct = packageManagerName(manifest?.packageManager);
  if (direct !== undefined) {
    return direct;
  }
  return packageManagerName(manifest?.devEngines?.packageManager);
}

function packageManagerName(value) {
  if (typeof value === "string") {
    return packageManagerNameFromSpec(value);
  }
  if (isRecord(value) && typeof value.name === "string") {
    return packageManagerNameFromSpec(value.name);
  }
  return;
}

function packageManagerNameFromSpec(value) {
  for (const manager of ["npm", "pnpm", "yarn", "bun"]) {
    if (value === manager || value.startsWith(`${manager}@`)) {
      return manager;
    }
  }
  return;
}

function lockfilePackageManagers(dir) {
  const managers = [];
  if (existsSync(join(dir, "package-lock.json")) || existsSync(join(dir, "npm-shrinkwrap.json"))) {
    managers.push("npm");
  }
  if (existsSync(join(dir, "pnpm-lock.yaml")) || existsSync(join(dir, "pnpm-workspace.yaml"))) {
    managers.push("pnpm");
  }
  if (existsSync(join(dir, "yarn.lock"))) {
    managers.push("yarn");
  }
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) {
    managers.push("bun");
  }
  return managers;
}

function ensurePnpmBuildApproval({ dryRun, packageManager, targetDir }) {
  if (packageManager !== "pnpm") {
    return false;
  }
  const path = findPnpmWorkspaceFile(targetDir);
  if (path === undefined) {
    return false;
  }
  const current = readText(path);
  if (current === undefined) {
    return false;
  }
  const next = withPnpmBuildApproval(current);
  if (next === current) {
    return false;
  }
  if (!dryRun) {
    writeFileAtomic(path, next);
  }
  return true;
}

function findPnpmWorkspaceFile(targetDir) {
  let current = targetDir;
  while (true) {
    const candidate = join(current, pnpmWorkspaceFile);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function withPnpmBuildApproval(text) {
  const lines = text.split("\n");
  if (text.endsWith("\n")) {
    lines.pop();
  }
  const allowBuildsIndex = topLevelKeyIndex(lines, "allowBuilds:");
  if (allowBuildsIndex === -1) {
    const next = [...lines];
    if (next.length > 0 && next.at(-1) !== "") {
      next.push("");
    }
    next.push("allowBuilds:", pnpmBuildApprovalLine);
    return `${next.join("\n")}\n`;
  }
  const blockEnd = topLevelBlockEnd(lines, allowBuildsIndex);
  const entryIndex = pnpmBuildApprovalEntryIndex(lines, allowBuildsIndex + 1, blockEnd);
  const next = [...lines];
  if (entryIndex === -1) {
    next.splice(blockEnd, 0, pnpmBuildApprovalLine);
  } else {
    next[entryIndex] = pnpmBuildApprovalLine;
  }
  return `${next.join("\n")}\n`;
}

function topLevelKeyIndex(lines, key) {
  return lines.indexOf(key);
}

function topLevelBlockEnd(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isTopLevelYamlKey(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function isTopLevelYamlKey(line) {
  return line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && line.endsWith(":");
}

function pnpmBuildApprovalEntryIndex(lines, start, end) {
  for (let index = start; index < end; index += 1) {
    const line = lines[index].trimStart();
    if (line.startsWith("supaschema:")) {
      return index;
    }
  }
  return -1;
}

function materializeCodexRunner(value, runner) {
  if (Array.isArray(value)) {
    return value.map((item) => materializeCodexRunner(item, runner));
  }
  if (!isRecord(value)) {
    return value;
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] =
      key === "command" && typeof item === "string"
        ? materializeSupaschemaCommand(item, runner)
        : materializeCodexRunner(item, runner);
  }
  return next;
}

function materializeSupaschemaCommand(command, runner) {
  for (const prefix of [
    "npm exec -- supaschema",
    "pnpm exec supaschema",
    "yarn exec supaschema",
    "bunx --no-install supaschema",
    "npx --no-install supaschema",
  ]) {
    if (command.startsWith(prefix)) {
      return `${runner.commandString}${command.slice(prefix.length)}`;
    }
  }
  return command;
}

function readExistingConfig(projectDir) {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    return effectiveExistingConfig(readJson(jsonPath), {
      exists: true,
      kind: "json",
      path: "supaschema.config.json",
    });
  }
  return { exists: false };
}

function effectiveExistingConfig(parsed, metadata) {
  const schemaPaths =
    Array.isArray(parsed?.schemaPaths) && parsed.schemaPaths.length > 0
      ? parsed.schemaPaths.map(String)
      : [genericSchemaPath];
  const migrationsDir =
    typeof parsed?.migrationsDir === "string" && parsed.migrationsDir.length > 0
      ? parsed.migrationsDir
      : genericMigrationsDir;
  return {
    adapter: parsed?.adapter === "auto" ? "auto" : undefined,
    configConfirmationNeeded: metadata.configConfirmationNeeded === true,
    exists: true,
    kind: metadata.kind,
    migrationsDir,
    parsed,
    path: metadata.path,
    provider: undefined,
    schemaPaths,
  };
}

async function resolvePathSelection(target, scan, existingConfig, interactive) {
  const defaults = projectDefaults(target);
  if (existingConfig.exists) {
    return {
      adapter: existingConfig.adapter,
      candidates: scan,
      databaseUrls: defaults.databaseUrls,
      migrationsDir: existingConfig.migrationsDir,
      pathConfirmationNeeded: false,
      provider: existingConfig.provider ?? defaults.provider,
      schemaPaths: existingConfig.schemaPaths,
      source: "existing-config",
    };
  }

  const schema = selectCandidate(scan.schemaPaths, defaults.schemaPath);
  const migrations = selectCandidate(scan.migrationsDirs, defaults.migrationsDir);
  let selection = {
    adapter: defaults.adapter,
    candidates: scan,
    databaseUrls: defaults.databaseUrls,
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
      databaseUrls: projectDefaults(target).databaseUrls,
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
  const preset = detected?.preset ?? genericProviderPreset;
  return {
    adapter: preset.adapter,
    databaseUrls: discoverDatabaseUrlEnvs(projectDir),
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

function discoverDatabaseUrlEnvs(projectDir) {
  const entries = walkFiles(projectDir, 5)
    .filter((file) => isEnvSourceFile(projectDir, file))
    .flatMap((file) => databaseUrlEnvEntries(projectDir, file));
  return {
    local: selectDatabaseUrlEnv(entries, ["local", "sample"]),
    remote: selectDatabaseUrlEnv(entries, ["remote"]),
  };
}

function isEnvSourceFile(projectDir, file) {
  const path = rel(projectDir, file);
  const name = path.split(sep).at(-1) ?? "";
  if (name === ".env.enc") {
    return false;
  }
  return name === ".env" || name.startsWith(".env.") || name.endsWith(".env");
}

function databaseUrlEnvEntries(projectDir, file) {
  const content = readText(file);
  if (content === undefined) {
    return [];
  }
  const lane = databaseUrlEnvLane(projectDir, file);
  const entries = [];
  for (const line of content.split("\n")) {
    const assignment = envAssignment(line);
    if (assignment === undefined || !isDatabaseUrlEnvAssignment(assignment)) {
      continue;
    }
    entries.push({
      key: assignment.key,
      lane,
      priority: databaseUrlEnvNamePriority(assignment.key),
      valueHasUrl: isPostgresUrl(assignment.value),
    });
  }
  return entries;
}

function envAssignment(raw) {
  let line = raw.trim();
  if (line.length === 0 || line.startsWith("#")) {
    return;
  }
  if (line.startsWith("export ")) {
    line = line.slice("export ".length).trimStart();
  }
  const separator = line.indexOf("=");
  if (separator <= 0) {
    return;
  }
  const key = line.slice(0, separator).trim();
  if (!isEnvName(key)) {
    return;
  }
  return {
    key,
    value: line.slice(separator + 1).trim(),
  };
}

function isEnvName(value) {
  if (value.length === 0 || !isEnvFirstChar(value[0])) {
    return false;
  }
  for (const char of value.slice(1)) {
    if (!isEnvChar(char)) {
      return false;
    }
  }
  return true;
}

function isEnvFirstChar(char) {
  return char === "_" || isAsciiLetter(char);
}

function isEnvChar(char) {
  return char === "_" || isAsciiLetter(char) || isAsciiDigit(char);
}

function isAsciiLetter(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isDatabaseUrlEnvAssignment(assignment) {
  const upper = assignment.key.toUpperCase();
  return (
    databaseUrlEnvPriority.includes(upper) ||
    upper.includes("DATABASE_URL") ||
    isPostgresUrl(assignment.value)
  );
}

function isPostgresUrl(value) {
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

function databaseUrlEnvLane(projectDir, file) {
  const path = rel(projectDir, file).toLowerCase();
  const parts = path.split(sep);
  const name = path.split(sep).at(-1) ?? "";
  if (parts.includes(".github") || name.includes("production") || name.includes("prod")) {
    return "remote";
  }
  if (name.includes("example") || name.includes("sample")) {
    return "sample";
  }
  return "local";
}

function selectDatabaseUrlEnv(entries, lanes) {
  const candidates = entries.filter((entry) => lanes.includes(entry.lane));
  candidates.sort((left, right) => databaseUrlEnvRank(left) - databaseUrlEnvRank(right));
  return candidates[0]?.key;
}

function databaseUrlEnvRank(entry) {
  const laneRank = entry.lane === "local" || entry.lane === "remote" ? 0 : 100;
  const valueRank = entry.valueHasUrl ? 0 : 10;
  return laneRank + valueRank + entry.priority;
}

function databaseUrlEnvNamePriority(name) {
  const index = databaseUrlEnvPriority.indexOf(name.toUpperCase());
  return index === -1 ? databaseUrlEnvPriority.length : index;
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

function shouldWriteConfig(existingConfig, repair) {
  if (!existingConfig.exists || repair) {
    return true;
  }
  return false;
}

function scaffoldConfig(selection, existing) {
  const config = mergeInstalledConfig(existing, {
    localDatabaseUrlEnv: selection.databaseUrls?.local,
    migrationsDir: selection.migrationsDir,
    providerId: selection.provider?.id,
    remoteDatabaseUrlEnv: selection.databaseUrls?.remote,
    schemaPaths: selection.schemaPaths,
  });
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
  const sourceTargets = selection.schemaPaths.map((path) => `dir:${path}`).join("`, `");
  return `${guidanceStart}
## supaschema

This project uses supaschema for declarative PostgreSQL migrations. The configured paths below are authoritative; setup can seed provider-specific folders for Supabase, Neon, RDS/Aurora PostgreSQL, Cloud SQL, AlloyDB, Azure PostgreSQL, or a neutral PostgreSQL layout.

${pathLines}
- The agent install prompt lives at \`.agents/prompts/supaschema-install.md\`; read it before installing, initializing, inspecting, or explaining supaschema setup in this project.
- Treat \`supaschema.config.json\` as four decisions: schema tree (\`schemaPaths\`, \`sources.to\`, \`migrationsDir\`), diff baseline (\`sources.from\`, \`sources.to\`), generated contracts (\`typesFile\`, \`zodFile\`, \`workflow.type_generation\`, \`workflow.zod_generation\`, \`workflow.type_usage\`), and apply policy (\`workflow.migration_sync\`, \`sync.targets\`).
- \`schemaPaths\` roots are recursive. The default target source is \`${sourceTargets}\`; keep \`sources.to\` explicit when the diff target is intentionally different.
- Generated type outputs use \`${defaultTypesFile}\` and \`${defaultZodFile}\` unless \`typesFile\` or \`zodFile\` is changed in config; default workflow creates or refreshes both after \`diff\`, and \`workflow.type_usage: "zod_validated"\` tells agents to use generated Zod validators at runtime boundaries.
- Use existing \`$ENV_NAME\` database URL references in \`sync.targets\` or \`environments\`; do not create duplicate supaschema-only credentials or commit credentials.
- For schema changes, read \`.agents/skills/supaschema/SKILL.md\` and the matching Claude/Codex rule file, edit declarative SQL, then run \`diff\` and \`check\` through the local runner selected in \`.agents/prompts/supaschema-install.md\`.
- Hooks in \`.claude/settings.json\` and \`.codex/hooks.json\` enforce generated-migration protection and auto-run diff/check after schema SQL writes. When \`workflow.migration_sync\` allows automatic sync, the schema-write hook preflights every \`sync.targets\` entry with \`mode: "auto"\`; if each target resolves and any remote target is approved, it delegates to \`supaschema sync\`. Otherwise it stays on the non-mutating diff/check lane. Check or sync failures trigger agent-loop feedback to investigate the root source and correlated migration failures.
- Use bare \`sync\` for the configured workflow. Do not run \`sync --target <name>\` unless explicitly asked to override target selection. \`sync.targets.<name>.mode\` decides automatic target selection, \`workflow.migration_sync: "manual"\` keeps bare sync on the dry-run gate, and \`workflow.migration_sync: "disabled"\` blocks apply.
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

function writeInstallManifest(target, packageVersion, scan, selection, existingConfig = {}) {
  const manifest = {
    adapter: selection.adapter ?? "auto",
    candidates: scan,
    configConfirmationNeeded: existingConfig.configConfirmationNeeded === true,
    databaseUrls: selection.databaseUrls,
    existingConfig:
      existingConfig.exists === true
        ? {
            kind: existingConfig.kind,
            path: existingConfig.path,
          }
        : undefined,
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
    return;
  }
  writeProjectFile(target, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function removeInstallManifest(target) {
  const path = join(target, manifestPath);
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  const directory = dirname(path);
  try {
    if (readdirSync(directory).length === 0) {
      rmdirSync(directory);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

function manifestSelectionUnchanged(existing, next) {
  return (
    existing.adapter === next.adapter &&
    existing.configConfirmationNeeded === next.configConfirmationNeeded &&
    existing.migrationsDir === next.migrationsDir &&
    existing.pathConfirmationNeeded === next.pathConfirmationNeeded &&
    JSON.stringify(existing.schemaPaths) === JSON.stringify(next.schemaPaths)
  );
}

function writeProjectFile(target, relativePath, contents) {
  const destination = join(target, relativePath);
  writeFileAtomic(destination, contents);
}

function copyAgentBundle({ dryRun, packageRoot, skipped, targetDir }) {
  if (dryRun) {
    return;
  }
  for (const file of agentPaths) {
    copyProjectPath(packageRoot, targetDir, file, skipped);
  }
}

function removeNonCanonicalAgentSurfaces({ dryRun, targetDir }) {
  if (dryRun) {
    return;
  }
  for (const file of nonCanonicalAgentPaths) {
    rmSync(join(targetDir, file), { force: true, recursive: true });
  }
  removeEmptyDirectory(join(targetDir, ".codex/skills"));
}

function copyProjectPath(packageRoot, target, relativePath, skipped) {
  const source = join(packageRoot, relativePath);
  if (!existsSync(source)) {
    skipped.push(relativePath);
    return;
  }
  if (statSync(source).isDirectory()) {
    copyProjectDirectory(source, join(target, relativePath));
    return;
  }
  copyProjectFile(source, join(target, relativePath));
}

function copyProjectDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyProjectDirectory(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      copyProjectFile(sourcePath, destinationPath);
    }
  }
}

function copyProjectFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function removeEmptyDirectory(directory) {
  try {
    if (readdirSync(directory).length === 0) {
      rmdirSync(directory);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

function writeInstallState({ dryRun, existingConfig, packageVersion, scan, selection, targetDir }) {
  if (dryRun) {
    return;
  }
  if (selection.pathConfirmationNeeded) {
    writeInstallManifest(targetDir, packageVersion, scan, selection, existingConfig);
    return;
  }
  removeInstallManifest(targetDir);
}

function mergeHookConfig(packageRoot, target, hookConfig, skipped) {
  const source =
    typeof hookConfig.configFile === "string"
      ? readJson(join(packageRoot, hookConfig.configFile))
      : hookConfig.config;
  const transformedSource =
    typeof hookConfig.transform === "function" ? hookConfig.transform(source) : source;
  const destination = join(target, hookConfig.path);
  const existing = readJsonIfPresent(destination);
  if (!transformedSource || existing === undefined) {
    skipped.push(hookConfig.path);
    return;
  }

  const merged = mergeHooks(existing, transformedSource);
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
    removeIfPresent(temp);
    throw error;
  }
}

function removeIfPresent(filePath) {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function mergeHooks(existing, source) {
  const merged = isRecord(existing) ? structuredClone(existing) : {};
  const sourceHooks = isRecord(source.hooks) ? source.hooks : {};
  const mergedHooks = isRecord(merged.hooks) ? merged.hooks : {};
  merged.hooks = mergedHooks;
  const allManagedScripts = new Set([
    ...Object.values(sourceHooks)
      .filter(Array.isArray)
      .flatMap((entries) => entries.flatMap(hookDefinitions))
      .map(managedHookScript)
      .filter((name) => name !== undefined),
  ]);
  const allManagedSupaschemaHooks = new Set([
    ...Object.values(sourceHooks)
      .filter(Array.isArray)
      .flatMap((entries) => entries.flatMap(hookDefinitions))
      .map(managedSupaschemaHook)
      .filter((name) => name !== undefined),
  ]);

  for (const [eventName, existingEntries] of Object.entries(mergedHooks)) {
    if (Array.isArray(existingEntries)) {
      mergedHooks[eventName] = withoutManagedHooks(
        existingEntries,
        new Set(),
        allManagedScripts,
        allManagedSupaschemaHooks
      );
    }
  }

  for (const [eventName, sourceEntries] of Object.entries(sourceHooks)) {
    if (!Array.isArray(sourceEntries)) {
      continue;
    }
    const sourceHookDefs = sourceEntries.flatMap(hookDefinitions);
    const signatures = new Set(sourceHookDefs.map(hookSignature));
    const managedScripts = new Set(
      sourceHookDefs.map(managedHookScript).filter((name) => name !== undefined)
    );
    const managedSupaschemaHooks = new Set(
      sourceHookDefs.map(managedSupaschemaHook).filter((name) => name !== undefined)
    );
    const existingEntries = Array.isArray(mergedHooks[eventName]) ? mergedHooks[eventName] : [];
    mergedHooks[eventName] = [
      ...withoutManagedHooks(existingEntries, signatures, managedScripts, managedSupaschemaHooks),
      ...structuredClone(sourceEntries),
    ];
  }

  return merged;
}

function withoutManagedHooks(entries, signatures, managedScripts, managedSupaschemaHooks) {
  const kept = [];
  for (const entry of entries) {
    if (!(isRecord(entry) && Array.isArray(entry.hooks))) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter(
      (hook) => !isSupersededHook(hook, signatures, managedScripts, managedSupaschemaHooks)
    );
    if (hooks.length > 0) {
      kept.push({ ...entry, hooks });
    }
  }
  return kept;
}

function isSupersededHook(hook, signatures, managedScripts, managedSupaschemaHooks) {
  if (!isRecord(hook)) {
    return false;
  }
  if (signatures.has(hookSignature(hook))) {
    return true;
  }
  const script = managedHookScript(hook);
  if (script !== undefined && managedScripts.has(script)) {
    return true;
  }
  const supaschemaHook = managedSupaschemaHook(hook);
  return supaschemaHook !== undefined && managedSupaschemaHooks.has(supaschemaHook);
}

function managedHookScript(hook) {
  if (!isRecord(hook)) {
    return;
  }
  const scriptArg = Array.isArray(hook.args)
    ? hook.args.find((arg) => typeof arg === "string" && isHookScriptPath(arg))
    : undefined;
  if (typeof scriptArg === "string") {
    return basenameFromCommand(scriptArg);
  }
  const command = typeof hook.command === "string" ? hook.command : "";
  return basenameFromCommand(command);
}

function isHookScriptPath(value) {
  return value.endsWith(".mjs") || value.endsWith(".sh");
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

function managedSupaschemaHook(hook) {
  if (!isRecord(hook)) {
    return;
  }
  const tokens = [];
  if (typeof hook.command === "string") {
    tokens.push(...hook.command.split(" ").filter((token) => token.length > 0));
  }
  if (Array.isArray(hook.args)) {
    tokens.push(...hook.args.filter((arg) => typeof arg === "string"));
  }
  const binaryIndex = tokens.indexOf("supaschema");
  if (binaryIndex === -1 || tokens[binaryIndex + 1] !== "hook") {
    return;
  }
  const hookName = tokens[binaryIndex + 2];
  if (hookName === "schema-write") {
    return hookName;
  }
  if (hookName !== "generated-migration-edit") {
    return;
  }
  const runtimeFlag = tokens.indexOf("--runtime");
  const runtime = runtimeFlag === -1 ? "" : (tokens[runtimeFlag + 1] ?? "");
  return `${hookName}:${runtime}`;
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
