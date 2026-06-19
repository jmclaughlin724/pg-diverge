import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  genericMigrationsDir,
  genericProviderPreset,
  genericSchemaPath,
  mergeInstalledConfig,
  providerMigrationsDirs,
  providerPresets,
  providerSchemaPaths,
} from "./config-contract.mjs";

const manifestPath = ".supaschema/install.json";
const agentBundleInstructions = "node_modules/supaschema/agent-bundle/INSTALL.md";
const pnpmWorkspaceFile = "pnpm-workspace.yaml";
const pnpmBuildApprovalLine = "  supaschema: true";
const packageScripts = {
  "supaschema:check": "supaschema check",
  "supaschema:migration": "supaschema diff",
  "supaschema:types": "supaschema types",
};
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
export async function scaffoldProject({
  targetDir,
  packageVersion,
  interactive = false,
  dryRun = false,
  repair = false,
}) {
  const installed = [];
  const scan = scanProject(targetDir);
  const existingConfig = readExistingConfig(targetDir);
  const selection = await resolvePathSelection(targetDir, scan, existingConfig, interactive);
  const configContents = scaffoldConfigAndDirectories({
    dryRun,
    existingConfig,
    installed,
    repair,
    selection,
    targetDir,
  });

  const packageManager = detectPackageManager(targetDir);
  if (ensurePnpmBuildApproval({ dryRun, packageManager, targetDir })) {
    installed.push("pnpm build approval");
  }

  if (ensurePackageScripts({ dryRun, repair, targetDir })) {
    installed.push("package scripts");
  }

  const installStateChanged = writeInstallState({
    dryRun,
    existingConfig,
    packageVersion,
    scan,
    selection,
    targetDir,
  });
  if (selection.pathConfirmationNeeded && installStateChanged) {
    installed.push("manifest");
  } else if (!selection.pathConfirmationNeeded && installStateChanged) {
    installed.push("manifest cleanup");
  }

  return {
    config: configContents === undefined ? undefined : JSON.parse(configContents),
    existingConfig,
    dryRun,
    installed,
    agentBundle: {
      installed: false,
      instructions: agentBundleInstructions,
    },
    pathConfirmationNeeded: selection.pathConfirmationNeeded,
    preserved: [],
    selection,
    skipped: [],
  };
}

function scaffoldConfigAndDirectories({
  dryRun,
  existingConfig,
  installed,
  repair,
  selection,
  targetDir,
}) {
  const configContents = selection.pathConfirmationNeeded
    ? undefined
    : scaffoldConfig(selection, existingConfig.parsed);

  const configChanged =
    configContents !== undefined &&
    shouldWriteConfig(existingConfig, repair) &&
    writeProjectFile(targetDir, "supaschema.config.json", configContents, { dryRun });
  if (configChanged) {
    installed.push(existingConfig.exists ? "config repair" : "config");
  }

  const directoriesChanged =
    !selection.pathConfirmationNeeded &&
    createConfiguredDirectories(targetDir, selection, { dryRun });
  if (directoriesChanged) {
    installed.push("directories");
  }

  return configContents;
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

function ensurePackageScripts({ dryRun, repair, targetDir }) {
  const path = join(targetDir, "package.json");
  const manifest = readJson(path);
  if (!isRecord(manifest)) {
    return false;
  }
  const existingScripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const nextScripts = { ...existingScripts };
  let changed = !isRecord(manifest.scripts);
  for (const [name, command] of Object.entries(packageScripts)) {
    if (!(name in existingScripts) || (repair && existingScripts[name] !== command)) {
      nextScripts[name] = command;
      changed = true;
    }
  }
  if (!changed) {
    return false;
  }
  const next = { ...manifest, scripts: nextScripts };
  if (!dryRun) {
    writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  return true;
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
  const schemaNeedsConfirmation =
    schema.needsConfirmation ||
    schemaPathNeedsConfirmation(target, schema.path, defaults.provider?.id);
  let selection = {
    adapter: defaults.adapter,
    candidates: scan,
    databaseUrls: defaults.databaseUrls,
    migrationsDir: migrations.path,
    pathConfirmationNeeded: schemaNeedsConfirmation || migrations.needsConfirmation,
    provider: defaults.provider,
    schemaPaths: [schema.path],
    source: selectionSource(schema, migrations, defaults),
  };

  if (selection.pathConfirmationNeeded && interactive && canPrompt()) {
    selection = await promptForSelection(target, selection);
  }

  return selection;
}

function schemaPathNeedsConfirmation(projectDir, schemaPath, providerId) {
  if (providerId !== "supabase") {
    return false;
  }
  if (supabaseOwnerMarksSchemaInventory(projectDir, schemaPath)) {
    return true;
  }
  return existsSync(join(projectDir, schemaPath, "_bootstrap"));
}

function supabaseOwnerMarksSchemaInventory(projectDir, schemaPath) {
  const owner = readText(join(projectDir, "supabase", "AGENTS.md"));
  if (owner === undefined) {
    return false;
  }
  return owner.includes(schemaPath) && owner.includes("not the routine migration generator input");
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
  const name = path.split("/").at(-1) ?? "";
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
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (
    parts.includes(".github") ||
    parts.includes(".vercel") ||
    name.includes("production") ||
    name.includes("prod")
  ) {
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

function createConfiguredDirectories(target, selection, { dryRun = false } = {}) {
  let changed = false;
  for (const schemaPath of selection.schemaPaths) {
    const destination = join(target, schemaPath);
    changed = !existsSync(destination) || changed;
    if (!dryRun) {
      mkdirSync(destination, { recursive: true });
    }
  }
  const migrationsDestination = join(target, selection.migrationsDir);
  changed = !existsSync(migrationsDestination) || changed;
  if (!dryRun) {
    mkdirSync(migrationsDestination, { recursive: true });
  }
  return changed;
}

function writeInstallManifest(
  target,
  packageVersion,
  scan,
  selection,
  existingConfig = {},
  { dryRun = false } = {}
) {
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
    return false;
  }
  return writeProjectFile(target, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    dryRun,
  });
}

function removeInstallManifest(target, { dryRun = false } = {}) {
  const path = join(target, manifestPath);
  if (!existsSync(path)) {
    return false;
  }
  if (dryRun) {
    return true;
  }
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
  return true;
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

function writeProjectFile(target, relativePath, contents, { dryRun = false } = {}) {
  const destination = join(target, relativePath);
  return writeFileAtomicIfChanged(destination, contents, { dryRun });
}

function writeInstallState({ dryRun, existingConfig, packageVersion, scan, selection, targetDir }) {
  if (selection.pathConfirmationNeeded) {
    return writeInstallManifest(targetDir, packageVersion, scan, selection, existingConfig, {
      dryRun,
    });
  }
  return removeInstallManifest(targetDir, { dryRun });
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return;
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

function writeFileAtomicIfChanged(destination, contents, { dryRun = false } = {}) {
  if (readText(destination) === contents) {
    return false;
  }
  if (!dryRun) {
    writeFileAtomic(destination, contents);
  }
  return true;
}

function removeIfPresent(filePath) {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function rel(projectDir, path) {
  return relative(projectDir, path).split(sep).join("/");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
