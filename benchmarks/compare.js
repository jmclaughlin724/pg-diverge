#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrationSql,
  applySql,
  assertLocalDatabaseUrl,
  catalogFingerprint,
  createTemporaryDatabases,
  dropTemporaryDatabases,
  transferOwnership,
} from "./tools/compare-db.mjs";
import { discoverFixtures, materializeGeneratedFixtures } from "./tools/compare-fixtures.mjs";
import {
  combineExecutions,
  errorMessage,
  failedResult,
  preview,
  redactSecrets,
  skippedResult,
  summary,
  unsupportedResult,
} from "./tools/compare-report.mjs";
import { prepareSupabaseWorkdir } from "./tools/compare-supabase.mjs";
import { adapterAvailability, adapters } from "./tools/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const { scoreDiffOutput } = await import(join(packageRoot, "dist/diff-score.js"));
const fixtureRoot = resolve(here, "fixtures");
const outputPath = resolve(
  packageRoot,
  process.env.SUPASCHEMA_COMPARE_OUT ?? "benchmarks/results/comparison.json"
);
const selectedTools = csvSet(process.env.SUPASCHEMA_COMPARE_TOOLS);
const selectedFixtures = csvSet(process.env.SUPASCHEMA_COMPARE_FIXTURES);
const iterations = numberEnv("SUPASCHEMA_COMPARE_ITERATIONS", 10);
const warmups = numberEnv("SUPASCHEMA_COMPARE_WARMUPS", 1);
const commandTimeoutMs = numberEnv("SUPASCHEMA_COMPARE_TIMEOUT_MS", 30_000);
const databaseUrl = process.env.SUPASCHEMA_COMPARE_DATABASE_URL;

if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
}

const startedAt = new Date().toISOString();
const tempRoot = await mkdtemp(join(tmpdir(), "supaschema-compare-"));
const fixtures = [
  ...(await discoverFixtures(fixtureRoot)),
  ...(await materializeGeneratedFixtures(
    tempRoot,
    numberEnv("SUPASCHEMA_COMPARE_XL_TABLES", 0),
    numberEnv("SUPASCHEMA_COMPARE_XXL_TABLES", 0)
  )),
].sort((left, right) => left.name.localeCompare(right.name));
const results = [];

try {
  for (const fixture of fixtures) {
    if (selectedFixtures && !selectedFixtures.has(fixture.name)) {
      continue;
    }
    const contextBase = await prepareFixtureContext(fixture);
    try {
      await runFixtureAdapters(contextBase, fixture);
    } finally {
      await cleanupFixtureContext(contextBase);
    }
  }
} finally {
  if (!process.env.SUPASCHEMA_COMPARE_KEEP_TEMP) {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function runFixtureAdapters(contextBase, fixture) {
  for (const adapter of adapters) {
    if (selectedTools && !selectedTools.has(adapter.id)) {
      continue;
    }
    const unavailable = await adapterUnavailableResult(adapter, fixture, contextBase);
    if (unavailable) {
      results.push(unavailable);
      continue;
    }
    await runAdapterIterations(adapter, fixture, contextBase);
  }
}

async function adapterUnavailableResult(adapter, fixture, contextBase) {
  const reason = await adapterSkipReason(adapter, contextBase);
  if (reason) {
    return skippedResult(adapter, fixture, reason);
  }
  const unsupportedReason = adapter.unsupported?.(contextBase);
  if (unsupportedReason) {
    return unsupportedResult(adapter, fixture, unsupportedReason);
  }
  return;
}

async function runAdapterIterations(adapter, fixture, contextBase) {
  for (let index = -warmups; index < iterations; index += 1) {
    await runAdapterIteration(adapter, fixture, contextBase, index);
  }
}

async function runAdapterIteration(adapter, fixture, contextBase, index) {
  const warmup = index < 0;
  let context;
  try {
    context = await prepareRunContext(adapter, contextBase, index);
    const result = await runAdapter(adapter, fixture, context, warmup, index);
    if (!warmup) {
      results.push(result);
    }
  } catch (error) {
    if (!warmup) {
      results.push(failedResult(adapter, fixture, warmup, index, error));
    }
  } finally {
    if (context) {
      await cleanupRunContext(context);
    }
  }
}

const payload = {
  completedAt: new Date().toISOString(),
  environment: {
    arch: process.arch,
    databaseEnabled: Boolean(databaseUrl),
    iterations,
    node: process.version,
    platform: process.platform,
    commandTimeoutMs,
    toolVersions: await collectToolVersions(),
    warmups,
  },
  generatedBy: "supaschema bench:compare",
  results,
  startedAt,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
process.stdout.write(`${summary(payload)}\n`);

async function prepareFixtureContext(fixture) {
  const fromSql = await readFile(fixture.fromSqlPath, "utf8");
  const toSql = await readFile(fixture.toSqlPath, "utf8");
  const context = {
    env: process.env,
    fixture,
    fromSql,
    fromSqlPath: fixture.fromSqlPath,
    packageRoot,
    supaschemaAdapter: fixture.supaschemaAdapter,
    schemas: fixture.schemas,
    tempRoot,
    toDirectory: fixture.toDirectory,
    toSql,
    toSqlPath: fixture.toSqlPath,
  };
  // Seed each fixture state once into a template database; per-run databases
  // clone the template (CREATE DATABASE ... TEMPLATE), which turns large-
  // schema seeding from minutes of statement replay into a file copy.
  if (databaseUrl) {
    const urls = await createTemporaryDatabases(databaseUrl, 2);
    context.templateDatabaseUrls = urls;
    context.templateFromName = basename(new URL(urls[0]).pathname);
    context.templateToName = basename(new URL(urls[1]).pathname);
    // Objects must not be owned by supabase_admin: the Supabase CLI's diff
    // engines silently omit supabase_admin-owned objects (empty diff, exit 0).
    const seedRole = process.env.SUPASCHEMA_COMPARE_SEED_ROLE;
    await applySql(urls[0], fromSql);
    await applySql(urls[1], toSql);
    if (seedRole) {
      await transferOwnership(urls[0], seedRole);
      await transferOwnership(urls[1], seedRole);
    }
    context.targetFingerprint = await catalogFingerprint(urls[1]);
  }
  return context;
}

async function cleanupFixtureContext(context) {
  await dropTemporaryDatabases(databaseUrl, context.templateDatabaseUrls ?? []);
}

async function prepareRunContext(adapter, base, iteration) {
  const runRoot = await mkdtemp(join(tempRoot, `${base.fixture.name}-${adapter.id}-${iteration}-`));
  const context = {
    ...base,
    fromDatabaseUrl: undefined,
    outputPath: join(runRoot, `${adapter.id}.${adapter.output === "xml" ? "xml" : "sql"}`),
    runRoot,
    toDatabaseUrl: undefined,
  };
  try {
    await prepareSupabaseWorkdir(context, adapter, iteration);
    if (base.supaschemaAdapter && adapter.id.startsWith("supaschema")) {
      context.supaschemaConfigPath = join(runRoot, "supaschema.config.json");
      await writeFile(
        context.supaschemaConfigPath,
        `${JSON.stringify({ adapter: base.supaschemaAdapter })}\n`,
        "utf8"
      );
    }
    if (adapter.requiresDatabase) {
      const urls = [
        ...(await createTemporaryDatabases(databaseUrl, 1, base.templateFromName)),
        ...(await createTemporaryDatabases(databaseUrl, 1, base.templateToName)),
      ];
      context.fromDatabaseUrl = urls[0];
      context.toDatabaseUrl = urls[1];
      context.createdDatabaseUrls = urls;
    }
  } catch (error) {
    await cleanupRunContext(context).catch(() => undefined);
    throw error;
  }
  return context;
}

async function cleanupRunContext(context) {
  if (!process.env.SUPASCHEMA_COMPARE_KEEP_TEMP) {
    await dropTemporaryDatabases(databaseUrl, context.createdDatabaseUrls ?? []);
    await rm(context.runRoot, { force: true, recursive: true });
  }
}

async function runAdapter(adapter, fixture, context, warmup, iteration) {
  const commandSpec = await adapter.command(context);
  const started = performance.now();
  let execution;
  let attempts = 0;
  let elapsedMs = 0;
  const executions = [];
  const maxAttempts = adapter.maxAttempts ?? 2;
  while (attempts < maxAttempts) {
    if (attempts > 0 && adapter.retryDelayMs) {
      await sleep(adapter.retryDelayMs);
    }
    await rm(context.outputPath, { force: true });
    const attemptStarted = performance.now();
    execution = await exec(commandSpec);
    // Latency claims use the final attempt only; retry sleeps and failed
    // environmental attempts (port conflicts) land in totalElapsedMs.
    elapsedMs = performance.now() - attemptStarted;
    attempts += 1;
    executions.push(execution);
    if (!adapter.retryOnFailure?.(execution)) {
      break;
    }
  }
  execution = combineExecutions(executions);
  const totalElapsedMs = performance.now() - started;
  const commandFailed = adapterCommandFailed(adapter, execution);
  const generatedOutput = commandFailed ? "" : await commandOutput(context, execution);
  const generatedSql = adapter.output === "sql" ? sqlOutput(generatedOutput) : "";
  const verification =
    adapter.output === "sql" && generatedSql.trim()
      ? await verifyGeneratedSql(context, generatedSql)
      : {
          appliesOnce: false,
          appliesTwice: false,
          matchesTargetAfterFirstApply: false,
          matchesTargetAfterSecondApply: false,
          matchesTargetFingerprint: false,
          reason: adapter.output === "sql" ? "no SQL output" : `output format ${adapter.output}`,
        };
  const outputScore =
    fixture.manifest && generatedSql.trim()
      ? await scoreDiffOutput(generatedSql, fixture.manifest)
      : undefined;
  return {
    adapter: adapter.id,
    ...(outputScore && {
      outputExcessSample: outputScore.excess.slice(0, 8),
      outputF1: Number(outputScore.f1.toFixed(3)),
      outputMissedSample: outputScore.missed.slice(0, 8),
      outputPrecision: Number(outputScore.precision.toFixed(3)),
      outputRecall: Number(outputScore.recall.toFixed(3)),
    }),
    appliesOnce: verification.appliesOnce,
    appliesTwice: verification.appliesTwice,
    attempts,
    command: redactSecrets([commandSpec.command, ...commandSpec.args].join(" ")),
    commandFailed,
    elapsedMs: Math.round(elapsedMs),
    exitCode: execution.exitCode,
    fixture: fixture.name,
    matchesTargetAfterFirstApply: verification.matchesTargetAfterFirstApply,
    matchesTargetAfterSecondApply: verification.matchesTargetAfterSecondApply,
    matchesTargetFingerprint: verification.matchesTargetFingerprint,
    mode: adapter.mode,
    outputBytes: Buffer.byteLength(generatedOutput),
    outputFormat: adapter.output,
    skipped: false,
    stderrBytes: Buffer.byteLength(execution.stderr),
    stderrPreview: preview(redactSecrets(execution.stderr)),
    stdoutPreview: preview(redactSecrets(generatedOutput)),
    timedOut: execution.timedOut,
    totalElapsedMs: Math.round(totalElapsedMs),
    verificationReason: verification.reason,
    warmup,
    iteration,
  };
}

async function verifyGeneratedSql(context, generatedSql) {
  if (!databaseUrl) {
    return {
      appliesOnce: false,
      appliesTwice: false,
      matchesTargetAfterFirstApply: false,
      matchesTargetAfterSecondApply: false,
      matchesTargetFingerprint: false,
      reason: "set SUPASCHEMA_COMPARE_DATABASE_URL to verify generated SQL",
    };
  }
  const [migrationUrl] = await createTemporaryDatabases(databaseUrl, 1, context.templateFromName);
  try {
    if (!context.templateFromName) {
      await applySql(migrationUrl, context.fromSql);
    }
    await applyMigrationSql(migrationUrl, generatedSql);
    const appliesOnce = true;
    const firstFingerprint = await catalogFingerprint(migrationUrl);
    const matchesTargetAfterFirstApply = context.targetFingerprint
      ? firstFingerprint === context.targetFingerprint
      : false;
    let appliesTwice = false;
    let matchesTargetAfterSecondApply = false;
    let secondApplyReason;
    try {
      await applyMigrationSql(migrationUrl, generatedSql);
      appliesTwice = true;
      const secondFingerprint = await catalogFingerprint(migrationUrl);
      matchesTargetAfterSecondApply = context.targetFingerprint
        ? secondFingerprint === context.targetFingerprint
        : false;
    } catch (error) {
      appliesTwice = false;
      secondApplyReason = `second apply failed: ${errorMessage(error)}`;
    }
    return {
      appliesOnce,
      appliesTwice,
      matchesTargetAfterFirstApply,
      matchesTargetAfterSecondApply,
      matchesTargetFingerprint:
        matchesTargetAfterFirstApply && appliesTwice && matchesTargetAfterSecondApply,
      reason: secondApplyReason,
    };
  } catch (error) {
    return {
      appliesOnce: false,
      appliesTwice: false,
      matchesTargetAfterFirstApply: false,
      matchesTargetAfterSecondApply: false,
      matchesTargetFingerprint: false,
      reason: errorMessage(error),
    };
  } finally {
    await dropTemporaryDatabases(databaseUrl, [migrationUrl]);
  }
}

async function adapterSkipReason(adapter, context) {
  if (adapter.requiresDatabase && !databaseUrl) {
    return "set SUPASCHEMA_COMPARE_DATABASE_URL to enable database-backed comparisons";
  }
  const availability = await adapterAvailability(adapter);
  if (!availability.available) {
    return availability.reason;
  }
  return adapter.skip?.(context);
}

function adapterCommandFailed(adapter, execution) {
  if (execution.timedOut || execution.exitCode === 124) {
    return true;
  }
  if (execution.exitCode === 0) {
    return false;
  }
  return !adapter.acceptsExitCode?.(execution);
}

function exec({ args, command, stdin }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, commandTimeoutMs);
    timeout.unref();
    function finish(result) {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      resolve(result);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ exitCode: 127, stderr: errorMessage(error), stdout: "", timedOut });
    });
    child.on("close", (exitCode, signal) => {
      const resolvedExitCode = exitCode ?? (timedOut ? 124 : 1);
      const timeoutMessage = timedOut ? `\nTimed out after ${commandTimeoutMs}ms (${signal})` : "";
      finish({
        exitCode: resolvedExitCode,
        stderr: `${stderr}${timeoutMessage}`,
        stdout,
        timedOut,
      });
    });
    if (stdin) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

function sqlOutput(stdout) {
  return stdout
    .split("\n")
    .filter((line) => !line.startsWith("Connecting to"))
    .join("\n")
    .trim();
}

async function commandOutput(context, execution) {
  if (execution.stdout.trim()) {
    return execution.stdout;
  }
  try {
    return await readFile(context.outputPath, "utf8");
  } catch {
    return execution.stdout;
  }
}

function csvSet(value) {
  if (!value) {
    return;
  }
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : Number(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectToolVersions() {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  return {
    supaschema: packageJson.version,
    supabase: await commandVersion("supabase", ["--version"]),
  };
}

async function commandVersion(command, args) {
  const result = await exec({ args, command });
  if (result.exitCode !== 0) {
    return;
  }
  return result.stdout.trim() || result.stderr.trim() || undefined;
}
