#!/usr/bin/env node
// Install-time setup for consuming projects. This makes `npm install
// --save-dev supaschema` the single step that installs config, agent
// guidance, rules, skills, hooks, and default schema/migration folders.
// Existing user-owned AGENTS.md / CLAUDE.md content is preserved through a
// managed addendum block. The script is idempotent and never fails package
// installation; skipped work is reported and install still exits 0.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.env.INIT_CWD ?? process.cwd());
const packageJson = readJson(join(packageRoot, "package.json")) ?? {};
const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";

const configFiles = ["supaschema.config.json", "supaschema.config.mjs", "supaschema.config.js"];
const defaultSchemaPath = "supabase/schemas";
const defaultMigrationsDir = "supabase/migrations";
const manifestPath = ".supaschema/install.json";
const guidanceStart = "<!-- supaschema:agent-guidance:start -->";
const guidanceEnd = "<!-- supaschema:agent-guidance:end -->";

const agentFiles = [
  ".agents/skills/supaschema/SKILL.md",
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/rules/supaschema.md",
  ".claude/skills/supaschema/SKILL.md",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/supaschema-tool-gate.mjs",
  ".codex/rules/supaschema.rules",
];

const hookConfigs = [".claude/settings.json", ".codex/hooks.json"];

await main();

async function main() {
  try {
    if (target === packageRoot || target.startsWith(packageRoot + sep)) {
      process.exit(0);
    }

    const installed = [];
    const skipped = [];
    const scan = scanProject(target);
    const existingConfig = readExistingConfig(target);
    const selection = await resolvePathSelection(scan, existingConfig);

    if (!existingConfig.exists) {
      writeProjectFile("supaschema.config.json", scaffoldConfig(selection));
      installed.push("config");
    }

    createConfiguredDirectories(selection);
    installed.push("directories");

    for (const file of agentFiles) {
      copyProjectFile(file, skipped);
    }
    installed.push("agent files");

    for (const file of hookConfigs) {
      mergeHookConfig(file, skipped);
    }
    installed.push("hook wiring");

    installAgentGuidance(selection);
    installed.push("AGENTS/CLAUDE addendum");

    writeInstallManifest(scan, selection);
    installed.push("manifest");

    const suffix = skipped.length > 0 ? `; skipped ${skipped.join(", ")}` : "";
    process.stdout.write(
      `supaschema: installed ${installed.join(", ")} for Claude/Codex agents${suffix}\n`,
    );

    if (selection.pathConfirmationNeeded) {
      process.stdout.write(
        "supaschema: confirm detected schema/migration paths in .supaschema/install.json before the first diff\n",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`supaschema: postinstall setup skipped (${message})\n`);
  }
}

function readExistingConfig(projectDir) {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    const parsed = readJson(jsonPath);
    const schemaPaths = Array.isArray(parsed?.schemaPaths)
      ? parsed.schemaPaths.map(String)
      : [defaultSchemaPath];
    return {
      exists: true,
      migrationsDir:
        typeof parsed?.migrationsDir === "string" ? parsed.migrationsDir : defaultMigrationsDir,
      schemaPaths,
    };
  }
  return {
    exists: configFiles.some((file) => existsSync(join(projectDir, file))),
  };
}

async function resolvePathSelection(scan, existingConfig) {
  if (
    existingConfig.exists &&
    Array.isArray(existingConfig.schemaPaths) &&
    typeof existingConfig.migrationsDir === "string"
  ) {
    return {
      candidates: scan,
      migrationsDir: existingConfig.migrationsDir,
      pathConfirmationNeeded: false,
      schemaPaths: existingConfig.schemaPaths,
      source: "existing-config",
    };
  }

  const schema = selectCandidate(scan.schemaPaths, defaultSchemaPath);
  const migrations = selectCandidate(scan.migrationsDirs, defaultMigrationsDir);
  let selection = {
    candidates: scan,
    migrationsDir: migrations.path,
    pathConfirmationNeeded: schema.needsConfirmation || migrations.needsConfirmation,
    schemaPaths: [schema.path],
    source: existingConfig.exists
      ? "existing-config-scan"
      : schema.source === "default" && migrations.source === "default"
        ? "default"
        : "scan",
  };

  if (selection.pathConfirmationNeeded && canPrompt()) {
    selection = await promptForSelection(selection);
  }

  return selection;
}

async function promptForSelection(selection) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const schemaPaths = await promptPathChoice(
      rl,
      "schema path",
      selection.candidates.schemaPaths,
      selection.schemaPaths[0] ?? defaultSchemaPath,
    );
    const migrationsDir = await promptPathChoice(
      rl,
      "migrations directory",
      selection.candidates.migrationsDirs,
      selection.migrationsDir,
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

function scanProject(projectDir) {
  const dirs = walkDirectories(projectDir, 5);
  return {
    migrationsDirs: rankCandidates(
      dirs
        .filter((dir) => isMigrationsCandidate(projectDir, dir))
        .map((dir) => rel(projectDir, dir)),
      [defaultMigrationsDir, "migrations", "db/migrations", "database/migrations"],
    ),
    schemaPaths: rankCandidates(
      dirs.filter((dir) => isSchemaCandidate(projectDir, dir)).map((dir) => rel(projectDir, dir)),
      [defaultSchemaPath, "schemas", "schema", "db/schemas", "db/schema", "database/schemas"],
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
  return path === defaultSchemaPath || name === "schemas" || name === "schema" || hasSqlFiles(dir);
}

function isMigrationsCandidate(projectDir, dir) {
  const name = dir.split(sep).at(-1);
  const path = rel(projectDir, dir);
  return path === defaultMigrationsDir || name === "migrations";
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
  return `${JSON.stringify(
    {
      $schema: "./node_modules/supaschema/config-schema.json",
      schemaPaths: selection.schemaPaths,
      migrationsDir: selection.migrationsDir,
    },
    null,
    2,
  )}\n`;
}

function createConfiguredDirectories(selection) {
  for (const schemaPath of selection.schemaPaths) {
    mkdirSync(join(target, schemaPath), { recursive: true });
  }
  mkdirSync(join(target, selection.migrationsDir), { recursive: true });
}

function installAgentGuidance(selection) {
  const block = agentGuidanceBlock(selection);
  upsertManagedBlock("AGENTS.md", block);
  upsertManagedBlock("CLAUDE.md", block);
}

function agentGuidanceBlock(selection) {
  const confirm = selection.pathConfirmationNeeded
    ? "- Path confirmation is pending: inspect `.supaschema/install.json`, ask the user which detected schema and migrations paths to use, then update `supaschema.config.json` before running the first diff.\n"
    : "";
  return `${guidanceStart}
## supaschema

This project uses supaschema for declarative PostgreSQL/Supabase migrations.

- Schema intent belongs in \`${selection.schemaPaths.join("`, `")}\`.
- Generated migrations write to \`${selection.migrationsDir}\`; files containing \`-- supaschema: lineage\` must not be hand-edited.
${confirm}- For schema changes, read \`.agents/skills/supaschema/SKILL.md\` and the matching Claude/Codex rule file, edit declarative SQL, run \`npx supaschema diff\`, then run \`npx supaschema check\`.
- Hooks in \`.claude/settings.json\` and \`.codex/hooks.json\` enforce generated-migration protection and auto-run diff/check after schema SQL writes; they never apply migrations.
- Do not run \`npx supaschema sync --local\` or \`npx supaschema sync --remote\` unless explicitly asked to apply migrations.
${guidanceEnd}
`;
}

function upsertManagedBlock(relativePath, block) {
  const path = join(target, relativePath);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = current.indexOf(guidanceStart);
  const end = current.indexOf(guidanceEnd);
  let next;
  if (start !== -1 && end !== -1 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + guidanceEnd.length)}`;
  } else {
    next = current.trim().length > 0 ? `${current.trimEnd()}\n\n${block}` : block;
  }
  writeProjectFile(relativePath, next.endsWith("\n") ? next : `${next}\n`);
}

function writeInstallManifest(scan, selection) {
  writeProjectFile(
    manifestPath,
    `${JSON.stringify(
      {
        candidates: scan,
        installedAt: new Date().toISOString(),
        migrationsDir: selection.migrationsDir,
        packageVersion,
        pathConfirmationNeeded: selection.pathConfirmationNeeded,
        schemaPaths: selection.schemaPaths,
        source: selection.source,
      },
      null,
      2,
    )}\n`,
  );
}

function writeProjectFile(relativePath, contents) {
  const destination = join(target, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function copyProjectFile(relativePath, skipped) {
  const source = join(packageRoot, relativePath);
  if (!existsSync(source)) {
    skipped.push(relativePath);
    return;
  }
  const destination = join(target, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function mergeHookConfig(relativePath, skipped) {
  const sourcePath = join(packageRoot, relativePath);
  if (!existsSync(sourcePath)) {
    skipped.push(relativePath);
    return;
  }

  const source = readJson(sourcePath);
  const destination = join(target, relativePath);
  const existing = existsSync(destination) ? readJson(destination) : {};
  if (!source || !existing) {
    skipped.push(relativePath);
    return;
  }

  const merged = mergeHooks(existing, source);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(merged, null, 2)}\n`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
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
    const sourceCommands = new Set(sourceEntries.flatMap(hookCommands));
    const existingEntries = Array.isArray(mergedHooks[eventName]) ? mergedHooks[eventName] : [];
    mergedHooks[eventName] = [
      ...withoutHookCommands(existingEntries, sourceCommands),
      ...structuredClone(sourceEntries),
    ];
  }

  return merged;
}

function withoutHookCommands(entries, commands) {
  const kept = [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter(
      (hook) =>
        !commands.has(isRecord(hook) && typeof hook.command === "string" ? hook.command : ""),
    );
    if (hooks.length > 0) {
      kept.push({ ...entry, hooks });
    }
  }
  return kept;
}

function hookCommands(entry) {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return [];
  }
  return entry.hooks
    .map((hook) => (isRecord(hook) && typeof hook.command === "string" ? hook.command : undefined))
    .filter((command) => command !== undefined);
}

function rel(projectDir, path) {
  return relative(projectDir, path).split(sep).join("/");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
