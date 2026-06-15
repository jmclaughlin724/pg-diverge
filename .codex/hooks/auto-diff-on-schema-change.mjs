#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const editTools = new Set(["Edit", "MultiEdit", "Write", "edit_file", "apply_patch"]);
const lineageMarker = "-- supaschema: lineage ";
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";
const genericSchemaPath = "database/schemas";
const supabaseSchemaPath = "supabase/schemas";
const defaultWorkflow = {
  schema_diff: "on_schema_write",
  migration_check: "after_schema_diff",
  migration_verify: "suggest_after_check",
  migration_sync: "explicit_request_only",
  type_generation: "create_or_refresh",
  zod_generation: "create_or_refresh",
  type_usage: "zod_validated",
};
const pathSeparatorPattern = /[/\\]/;
const providerSchemaMarkers = [
  { schemaPath: supabaseSchemaPath, markers: [{ path: "supabase/config.toml" }] },
  {
    schemaPath: "neon/schemas",
    markers: [
      { path: "neon.toml" },
      { path: ".neon/project.json" },
      { path: ".neon/config.json" },
      {
        fileNames: ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"],
        contentTerms: ["neon.tech", "neon.com"],
      },
    ],
  },
  {
    schemaPath: "aws-postgresql/schemas",
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
  },
  {
    schemaPath: "alloydb/schemas",
    markers: [
      { fileNames: ["*.tf"], contentTerms: ["google_alloydb_cluster", "google_alloydb_instance"] },
      {
        fileNames: ["cloudbuild.yaml", "cloudbuild.yml", "app.yaml", "app.yml"],
        contentTerms: ["alloydb", "alloydb.googleapis.com"],
      },
    ],
  },
  {
    schemaPath: "cloud-sql/schemas",
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
  },
  {
    schemaPath: "azure-postgresql/schemas",
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
  },
];
const redactSecrets = await loadRedactSecrets();

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const projectDir = resolve(
    (typeof payload?.cwd === "string" && payload.cwd) ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      "."
  );
  const targets = editTargets(payload, projectDir);
  const pathState = await readPathState(projectDir);
  if (pathState.pathConfirmationNeeded) {
    const pendingRoots = pathState.confirmationSchemaPaths.map((path) => ({
      display: rel(projectDir, resolve(projectDir, path)),
      root: resolve(projectDir, path),
    }));
    const pending = changedSchemaTargets(targets, pendingRoots);
    if (pending.changed.length > 0) {
      emit(pathConfirmationMessage(projectDir, pending.changed, pathState));
    }
  }
  const schemaRoots = pathState.schemaPaths.map((path) => ({
    display: rel(projectDir, resolve(projectDir, path)),
    root: resolve(projectDir, path),
  }));
  const { changed, groups } = changedSchemaTargets(targets, schemaRoots);
  if (changed.length === 0) {
    process.exit(0);
  }
  if (pathState.workflow.schema_diff !== "on_schema_write") {
    emit(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(", ")} because workflow.schema_diff is "${pathState.workflow.schema_diff}". Run \`supaschema diff\` manually when this schema change should produce a migration.`
    );
  }
  if (groups.length > 1) {
    emit(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(", ")} because the edit touched multiple configured schema roots (${groups
        .map((group) => group.display)
        .join(
          ", "
        )}). Run one reviewed \`supaschema diff\` from the intended current state, then run \`supaschema check\`; the hook avoids chaining partial migrations for multi-root edits.`
    );
  }
  const bin = resolveBinary(projectDir);
  const written = [];
  for (const group of groups) {
    const diff = run(bin, ["diff", "--to", `dir:${group.display}`], projectDir);
    if (diff.code !== 0) {
      emit(
        `supaschema auto-diff for ${group.changed
          .map((path) => rel(projectDir, path))
          .join(", ")} did not complete (exit ${diff.code}):\n${head(
          diff.stderr || diff.stdout
        )}\nResolve per the supaschema skill — e.g. add the exact object key to hints.destructive for a destructive change, or diff from the post-migration state when the lineage chain is broken — then re-run \`supaschema diff --to dir:${group.display}\`.`
      );
    }
    written.push(...migrationOutputs(diff.stdout));
  }
  if (written.length === 0) {
    emit(
      `supaschema: ${changed
        .map((path) => rel(projectDir, path))
        .join(
          ", "
        )} changed but produces no net schema change versus the current state — no migration written.`
    );
  }
  const checkResult = runConfiguredCheck(bin, projectDir, pathState.workflow);
  const verifyLine = runConfiguredVerify(
    bin,
    projectDir,
    pathState.workflow,
    checkResult.passed
  );
  emit(
    `supaschema auto-diff completed for ${changed
      .map((path) => rel(projectDir, path))
      .join(", ")}: generated ${written
      .map((path) => rel(projectDir, path))
      .join(
        ", "
      )}. ${generatedOutputLine(
      pathState.workflow
    )}. ${checkResult.line}${verifyLine === "" ? "" : `. ${verifyLine}`}. Commit the tree change, the migration, and any refreshed generated outputs together — the migration runner (e.g. \`supabase db push\`) applies it; supaschema never touches your database.`
  );
} catch {
  process.exit(0);
}

function editTargets(payload, projectDir) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (!editTools.has(toolName)) {
    return [];
  }
  const input = payload?.tool_input ?? {};
  if (toolName === "apply_patch") {
    return patchTargets(patchTextFromInput(input), projectDir);
  }
  if (typeof input.file_path === "string" && input.file_path.length > 0) {
    return [isAbsolute(input.file_path) ? input.file_path : resolve(projectDir, input.file_path)];
  }
  return [];
}

function patchTextFromInput(input) {
  if (typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.patch === "string") {
    return input.patch;
  }
  if (typeof input.input === "string") {
    return input.input;
  }
  return "";
}

function patchTargets(patch, projectDir) {
  const out = [];
  for (const line of patch.split("\n")) {
    const target = patchLineTarget(line, projectDir);
    if (target) {
      out.push(target);
    }
  }
  return out;
}

function patchLineTarget(line, projectDir) {
  if (line.startsWith(addHeader)) {
    return resolve(projectDir, line.slice(addHeader.length).trim());
  }
  if (line.startsWith(deleteHeader)) {
    return resolve(projectDir, line.slice(deleteHeader.length).trim());
  }
  if (line.startsWith(updateHeader)) {
    return resolve(projectDir, line.slice(updateHeader.length).trim());
  }
  if (line.startsWith(moveHeader)) {
    // `*** Update File:` carries the old path; a following `*** Move to:`
    // carries the new path. Record the destination too so a schema file
    // moved into the tree from outside still triggers diff/check.
    return resolve(projectDir, line.slice(moveHeader.length).trim());
  }
  return;
}

function changedSchemaTargets(paths, schemaRoots) {
  const groups = new Map();
  const changed = [];
  for (const path of paths) {
    if (!path.endsWith(".sql") || isGeneratedMigration(path)) {
      continue;
    }
    const matched = matchedSchemaRoot(path, schemaRoots);
    if (!matched) {
      continue;
    }
    changed.push(path);
    const group = groups.get(matched.root) ?? { changed: [], display: matched.display };
    group.changed.push(path);
    groups.set(matched.root, group);
  }
  return { changed, groups: Array.from(groups.values()) };
}

function matchedSchemaRoot(path, schemaRoots) {
  const matches = schemaRoots.filter((entry) => isInside(entry.root, path));
  return matches.sort((left, right) => right.root.length - left.root.length)[0];
}

function migrationOutputs(stdout) {
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"));
}

function isGeneratedMigration(path) {
  try {
    return readFileSync(path, "utf8").includes(lineageMarker);
  } catch {
    return false;
  }
}

function emit(additionalContext) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { additionalContext, hookEventName: "PostToolUse" },
    })}\n`
  );
  process.exit(0);
}

async function readConfigPathFields(projectDir) {
  const jsonPath = join(projectDir, "supaschema.config.json");
  if (existsSync(jsonPath)) {
    return resolveConfigPathFields(JSON.parse(readFileSync(jsonPath, "utf8")), projectDir);
  }
  return {
    explicit: false,
    migrationsDir: undefined,
    schemaPaths: [defaultSchemaPath(projectDir)],
    sourcesTo: undefined,
    workflow: defaultWorkflow,
  };
}

function resolveConfigPathFields(config, projectDir) {
  const explicitSchemaPaths = schemaPathsFromConfig(config);
  const migrationsDir =
    typeof config?.migrationsDir === "string" && config.migrationsDir.length > 0
      ? config.migrationsDir
      : undefined;
  const sourcesTo =
    typeof config?.sources?.to === "string" && config.sources.to.length > 0
      ? config.sources.to
      : undefined;
  return {
    explicit: explicitSchemaPaths !== undefined && migrationsDir !== undefined && sourcesTo !== undefined,
    migrationsDir,
    schemaPaths: explicitSchemaPaths ?? [defaultSchemaPath(projectDir)],
    sourcesTo,
    workflow: workflowFromConfig(config),
  };
}

async function readPathState(projectDir) {
  const { explicit, migrationsDir, schemaPaths, sourcesTo, workflow } =
    await readConfigPathFields(projectDir);
  const manifest = readInstallManifest(projectDir);
  // The install-time `pathConfirmationNeeded` flag is stale once the config
  // explicitly defines schemaPaths, sources.to, and migrationsDir — that is the
  // documented way to confirm the detected paths — so auto-diff resumes without
  // a manual manifest edit.
  if (manifest?.pathConfirmationNeeded === true && !explicit) {
    const candidateSchemaPaths = strings(manifest?.candidates?.schemaPaths);
    const candidateMigrationsDirs = strings(manifest?.candidates?.migrationsDirs);
    return {
      candidateMigrationsDirs,
      candidateSchemaPaths,
      confirmationSchemaPaths: uniqueStrings([...candidateSchemaPaths, ...schemaPaths]),
      migrationsDir,
      pathConfirmationNeeded: true,
      schemaPaths,
      sourcesTo,
      workflow,
    };
  }
  return {
    candidateMigrationsDirs: [],
    candidateSchemaPaths: [],
    confirmationSchemaPaths: schemaPaths,
    migrationsDir,
    pathConfirmationNeeded: false,
    schemaPaths,
    sourcesTo,
    workflow,
  };
}

function readInstallManifest(projectDir) {
  const path = join(projectDir, ".supaschema", "install.json");
  if (!existsSync(path)) {
    return;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}

function schemaPathsFromConfig(config) {
  if (Array.isArray(config?.schemaPaths) && config.schemaPaths.length > 0) {
    return config.schemaPaths.map(String);
  }
  return;
}

function workflowFromConfig(config) {
  const workflow = isPlainObject(config?.workflow) ? config.workflow : {};
  return {
    schema_diff: enumValue(workflow.schema_diff, [
      "disabled",
      "manual",
      "on_schema_write",
    ], defaultWorkflow.schema_diff),
    migration_check: enumValue(workflow.migration_check, [
      "manual",
      "after_schema_diff",
      "required_before_complete",
    ], defaultWorkflow.migration_check),
    migration_verify: enumValue(workflow.migration_verify, [
      "manual",
      "suggest_after_check",
      "after_schema_diff",
    ], defaultWorkflow.migration_verify),
    migration_sync: enumValue(workflow.migration_sync, [
      "disabled",
      "explicit_request_only",
    ], defaultWorkflow.migration_sync),
    type_generation: enumValue(workflow.type_generation, [
      "disabled",
      "refresh_existing",
      "create_or_refresh",
    ], defaultWorkflow.type_generation),
    zod_generation: enumValue(workflow.zod_generation, [
      "disabled",
      "refresh_existing",
      "create_or_refresh",
    ], defaultWorkflow.zod_generation),
    type_usage: enumValue(workflow.type_usage, [
      "typescript_only",
      "zod_validated",
    ], defaultWorkflow.type_usage),
  };
}

function enumValue(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runConfiguredCheck(bin, projectDir, workflow) {
  if (
    workflow.migration_check !== "after_schema_diff" &&
    workflow.migration_check !== "required_before_complete"
  ) {
    return {
      line: `supaschema check skipped because workflow.migration_check is "${workflow.migration_check}"`,
      passed: true,
    };
  }
  const check = run(bin, ["check"], projectDir);
  return check.code === 0
    ? { line: "supaschema check passed (replay-safe)", passed: true }
    : {
        line: `supaschema check reported diagnostics:\n${head(check.stderr || check.stdout)}`,
        passed: false,
      };
}

function runConfiguredVerify(bin, projectDir, workflow, checkPassed) {
  if (workflow.migration_verify !== "after_schema_diff") {
    return "";
  }
  if (!checkPassed) {
    return "supaschema verify skipped because check did not pass";
  }
  const verify = run(bin, ["verify"], projectDir);
  return verify.code === 0
    ? "supaschema verify passed"
    : `supaschema verify reported diagnostics:\n${head(verify.stderr || verify.stdout)}`;
}

function generatedOutputLine(workflow) {
  return `Generated output policy: workflow.type_generation=${workflow.type_generation}, workflow.zod_generation=${workflow.zod_generation}, workflow.type_usage=${workflow.type_usage}`;
}

function defaultSchemaPath(projectDir) {
  const files = walkFiles(projectDir, 5);
  const matched = providerSchemaMarkers.find((provider) =>
    provider.markers.some((marker) => providerMarkerMatches(projectDir, files, marker))
  );
  return matched?.schemaPath ?? genericSchemaPath;
}

function providerMarkerMatches(projectDir, files, marker) {
  if (typeof marker.path === "string") {
    const absolute = join(projectDir, marker.path);
    return (
      existsSync(absolute) &&
      (!marker.contentTerms || fileContainsAny(absolute, marker.contentTerms))
    );
  }
  return files.some((file) => {
    const name = file.split(pathSeparatorPattern).at(-1) ?? "";
    return (
      marker.fileNames.some((pattern) => fileNameMatches(pattern, name)) &&
      (!marker.contentTerms || fileContainsAny(file, marker.contentTerms))
    );
  });
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
      } else if (entry.isFile()) {
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

function pathConfirmationMessage(projectDir, changed, state) {
  const schemaCandidates =
    state.candidateSchemaPaths.length > 0 ? state.candidateSchemaPaths.join(", ") : "(none)";
  const migrationCandidates =
    state.candidateMigrationsDirs.length > 0 ? state.candidateMigrationsDirs.join(", ") : "(none)";
  return `supaschema auto-diff skipped for ${changed
    .map((path) => rel(projectDir, path))
    .join(
      ", "
    )} because path confirmation is pending from install. Inspect .supaschema/install.json, ask the user which schemaPaths, sources.to, and migrationsDir to use, update supaschema.config.json, then run \`supaschema diff\` and \`supaschema check\`. Candidate schema paths: ${schemaCandidates}. Candidate migrations dirs: ${migrationCandidates}.`;
}

function strings(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values));
}

function resolveBinary(projectDir) {
  const local = join(projectDir, "node_modules", ".bin", "supaschema");
  if (existsSync(local)) {
    return { args: [], cmd: local };
  }
  if (process.env.SUPASCHEMA_HOOK_BIN) {
    return { args: [], cmd: process.env.SUPASCHEMA_HOOK_BIN };
  }
  return { args: ["--no-install", "supaschema"], cmd: "npx" };
}

function run(bin, args, cwd) {
  try {
    const stdout = execFileSync(bin.cmd, [...bin.args, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { code: 0, stderr: "", stdout };
  } catch (error) {
    return {
      code: typeof error?.status === "number" ? error.status : 1,
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
    };
  }
}

function isInside(dir, file) {
  const relPath = relative(dir, file);
  return relPath !== "" && !relPath.startsWith("..") && !isAbsolute(relPath);
}

function rel(projectDir, path) {
  const relPath = relative(projectDir, path);
  return relPath.startsWith("..") ? path : relPath;
}

function head(text) {
  return redactSecrets(text || "")
    .trim()
    .split("\n")
    .slice(0, 12)
    .join("\n");
}

async function loadRedactSecrets() {
  try {
    const loaded = await import(new URL("../../dist/diagnostics.js", import.meta.url).href);
    if (typeof loaded.redactSecrets === "function") {
      return loaded.redactSecrets;
    }
  } catch {
    // Hooks are fail-open and may run before the generated dist exists in a source checkout.
  }
  return fallbackRedactSecrets;
}

function fallbackRedactSecrets(value) {
  return redactUrlCredentials(value)
    .replace(
      /\b(password|pass|pwd|token|secret|api[_-]?key|service[_-]?role[_-]?key)(\s*[:=]\s*)(["']?)[^"'\s,;)]+/giu,
      "$1$2$3[redacted]"
    )
    .replace(/\b(sb_secret_)[A-Za-z0-9_-]+/g, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
}

function isUserinfoEnd(char) {
  return (
    char === "@" || char === "/" || char === " " || char === "\t" || char === "\n" || char === "\r"
  );
}

function redactUrlCredentials(value) {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const marker = value.indexOf("://", index);
    if (marker === -1) {
      result += value.slice(index);
      break;
    }
    const afterScheme = marker + 3;
    result += value.slice(index, afterScheme);
    let cursor = afterScheme;
    let colon = -1;
    while (cursor < value.length && !isUserinfoEnd(value[cursor] ?? "")) {
      if (value[cursor] === ":" && colon === -1) {
        colon = cursor;
      }
      cursor += 1;
    }
    if (value[cursor] === "@" && colon > afterScheme && cursor > colon + 1) {
      result += `${value.slice(afterScheme, colon + 1)}[redacted]`;
      index = cursor;
    } else {
      index = afterScheme;
    }
  }
  return result;
}
