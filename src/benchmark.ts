import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRealisticSqlFixture } from "./benchmark-fixtures.js";
import type { Diagnostic, SchemaModel } from "./core.js";
import { resolveDatabaseUrl } from "./database-url.js";
import { applyMigrationSql, applySql, databasePair, withTemporaryDatabases } from "./db-admin.js";
import { formatDiagnostics } from "./diagnostics.js";
import { fingerprintObjects } from "./hash.js";
import { planSchemaDiff } from "./planner.js";
import { renderMigration } from "./render.js";
import { extractSourceModel } from "./source.js";
import { extractObjectsFromSql } from "./sql/extract.js";
import { verifyMigration } from "./verify.js";

const fastIterations = Number(process.env.SUPASCHEMA_BENCHMARK_ITERATIONS ?? "5");
const databaseIterations = Number(process.env.SUPASCHEMA_DATABASE_BENCHMARK_ITERATIONS ?? "3");

const xlTables = numberEnv("SUPASCHEMA_XL_TABLES", 1000);
const xxlTables = numberEnv("SUPASCHEMA_XXL_TABLES", 2500);

const thresholds = {
  catalogSnapshotDiff: numberEnv("SUPASCHEMA_CATALOG_BENCHMARK_MS", 2000),
  dumpDiff: numberEnv("SUPASCHEMA_DUMP_BENCHMARK_MS", 2000),
  endToEndMigration: numberEnv("SUPASCHEMA_END_TO_END_BENCHMARK_MS", 10_000),
  endToEndMigrationLarge: numberEnv("SUPASCHEMA_END_TO_END_LARGE_BENCHMARK_MS", 60_000),
  endToEndMigrationXl: numberEnv("SUPASCHEMA_END_TO_END_XL_BENCHMARK_MS", 120_000),
  endToEndMigrationXxl: numberEnv("SUPASCHEMA_END_TO_END_XXL_BENCHMARK_MS", 300_000),
  largeInMemoryDiff: numberEnv("SUPASCHEMA_LARGE_BENCHMARK_MS", 10_000),
  liveCatalogDiff: numberEnv("SUPASCHEMA_LIVE_CATALOG_BENCHMARK_MS", 10_000),
  liveCatalogDiffXl: numberEnv("SUPASCHEMA_LIVE_CATALOG_XL_BENCHMARK_MS", 60_000),
  liveCatalogDiffXxl: numberEnv("SUPASCHEMA_LIVE_CATALOG_XXL_BENCHMARK_MS", 120_000),
  noDriftDiff: numberEnv("SUPASCHEMA_NO_DRIFT_BENCHMARK_MS", 10_000),
  realisticTreeDiff: numberEnv("SUPASCHEMA_REALISTIC_BENCHMARK_MS", 10_000),
  replayVerification: numberEnv("SUPASCHEMA_VERIFY_BENCHMARK_MS", 30_000),
  shadowRoundTripDiff: numberEnv("SUPASCHEMA_SHADOW_BENCHMARK_MS", 30_000),
  sourceTreeDiff: numberEnv("SUPASCHEMA_BENCHMARK_MS", 2000),
};

type BenchmarkResult =
  | {
      maxWarmMs: number;
      status: "passed";
      thresholdMs: number;
      timingsMs: number[];
    }
  | {
      reason: string;
      status: "skipped";
      thresholdMs: number;
    };

const tempRoot = await mkdtemp(join(tmpdir(), "supaschema-benchmark-"));
try {
  const basicSources = {
    from: "dir:tests/fixtures/basic/from",
    to: "dir:tests/fixtures/basic/to",
  };
  const addColumnSources = {
    from: "dir:tests/fixtures/add-column/from",
    to: "dir:tests/fixtures/add-column/to",
  };
  const basicSql = {
    from: await readSqlDirectory("tests/fixtures/basic/from"),
    to: await readSqlDirectory("tests/fixtures/basic/to"),
  };
  const addColumnSql = {
    from: await readSqlDirectory("tests/fixtures/add-column/from"),
    to: await readSqlDirectory("tests/fixtures/add-column/to"),
  };
  const dumpSources = await writeDumpSources(basicSql);
  const catalogSources = await writeCatalogSources(basicSources);
  const realisticSql = makeRealisticSqlFixture(60);
  const largeSql = makeRealisticSqlFixture(250);
  const xlSql = makeRealisticSqlFixture(xlTables);
  const xxlSql = makeRealisticSqlFixture(xxlTables);
  const realisticTreeSources = await writeTreeSources("realistic", realisticSql);
  const largeTreeSources = await writeTreeSources("large", largeSql);
  const xlTreeSources = await writeTreeSources("xl", xlSql);
  const xxlTreeSources = await writeTreeSources("xxl", xxlSql);
  const databaseUrl = process.env.SUPASCHEMA_BENCHMARK_DATABASE_URL ?? resolveDatabaseUrl();

  const results = {
    catalogSnapshotDiff: await benchmarkDiffSources(
      "catalogSnapshotDiff",
      thresholds.catalogSnapshotDiff,
      fastIterations,
      catalogSources
    ),
    database: {
      endToEndMigration: await benchmarkEndToEndMigration(
        "endToEndMigration",
        thresholds.endToEndMigration,
        databaseUrl,
        addColumnSources,
        addColumnSql
      ),
      endToEndMigrationLarge: await benchmarkEndToEndMigration(
        "endToEndMigrationLarge",
        thresholds.endToEndMigrationLarge,
        databaseUrl,
        largeTreeSources,
        largeSql
      ),
      endToEndMigrationXl: await benchmarkEndToEndMigration(
        "endToEndMigrationXl",
        thresholds.endToEndMigrationXl,
        databaseUrl,
        xlTreeSources,
        xlSql
      ),
      endToEndMigrationXxl: await benchmarkEndToEndMigration(
        "endToEndMigrationXxl",
        thresholds.endToEndMigrationXxl,
        databaseUrl,
        xxlTreeSources,
        xxlSql
      ),
      liveCatalogDiff: await benchmarkLiveCatalogDiff(
        "liveCatalogDiff",
        thresholds.liveCatalogDiff,
        databaseUrl,
        realisticSql
      ),
      liveCatalogDiffXl: await benchmarkLiveCatalogDiff(
        "liveCatalogDiffXl",
        thresholds.liveCatalogDiffXl,
        databaseUrl,
        xlSql
      ),
      liveCatalogDiffXxl: await benchmarkLiveCatalogDiff(
        "liveCatalogDiffXxl",
        thresholds.liveCatalogDiffXxl,
        databaseUrl,
        xxlSql
      ),
      replayVerification: await benchmarkReplayVerification(databaseUrl, addColumnSources),
      shadowRoundTripDiff: await benchmarkShadowRoundTripDiff(databaseUrl, realisticSql),
    },
    dumpDiff: await benchmarkDiffSources(
      "dumpDiff",
      thresholds.dumpDiff,
      fastIterations,
      dumpSources
    ),
    largeInMemoryDiff: await runBenchmark(
      "largeInMemoryDiff",
      thresholds.largeInMemoryDiff,
      fastIterations,
      async () => {
        const from = await modelFromSql("large:from", largeSql.from);
        const to = await modelFromSql("large:to", largeSql.to);
        diffModels("largeInMemoryDiff", from, to);
      }
    ),
    noDriftDiff: await runBenchmark(
      "noDriftDiff",
      thresholds.noDriftDiff,
      fastIterations,
      async () => {
        const from = await extractSourceModel(realisticTreeSources.from);
        const to = await extractSourceModel(realisticTreeSources.from);
        const plan = diffModels("noDriftDiff", from, to);
        if (plan.operations.length > 0) {
          throw new Error(
            `noDriftDiff expected an empty plan for identical sources, found ${plan.operations.length} operations`
          );
        }
      }
    ),
    realisticTreeDiff: await benchmarkDiffSources(
      "realisticTreeDiff",
      thresholds.realisticTreeDiff,
      fastIterations,
      realisticTreeSources
    ),
    sourceTreeDiff: await benchmarkDiffSources(
      "sourceTreeDiff",
      thresholds.sourceTreeDiff,
      fastIterations,
      basicSources
    ),
  };

  process.stdout.write(JSON.stringify(results, null, 2));
  process.stdout.write("\n");
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

function benchmarkDiffSources(
  name: string,
  thresholdMs: number,
  iterations: number,
  sources: { from: string; to: string }
): Promise<BenchmarkResult> {
  return runBenchmark(name, thresholdMs, iterations, async () => {
    const from = await extractSourceModel(sources.from);
    const to = await extractSourceModel(sources.to);
    diffModels(name, from, to);
  });
}

function benchmarkLiveCatalogDiff(
  name: string,
  thresholdMs: number,
  databaseUrl: string | undefined,
  sql: { from: string; to: string }
): Promise<BenchmarkResult> {
  if (!databaseUrl) {
    return skippedDatabaseBenchmark(thresholdMs);
  }
  return withTemporaryDatabases(databaseUrl, 2, async (databaseUrls) => {
    const [fromUrl, toUrl] = databasePair(databaseUrls);
    await applySql(fromUrl, sql.from);
    await applySql(toUrl, sql.to);
    return benchmarkDiffSources(name, thresholdMs, databaseIterations, {
      from: `database:${fromUrl}`,
      to: `database:${toUrl}`,
    });
  });
}

async function benchmarkReplayVerification(
  databaseUrl: string | undefined,
  sources: { from: string; to: string }
): Promise<BenchmarkResult> {
  if (!databaseUrl) {
    return skippedDatabaseBenchmark(thresholds.replayVerification);
  }
  const migrationPath = join(tempRoot, "add-column.sql");
  const from = await extractSourceModel(sources.from);
  const to = await extractSourceModel(sources.to);
  const plan = diffModels("replayVerification:plan", from, to);
  await writeFile(migrationPath, renderMigration(plan), "utf8");
  return runBenchmark(
    "replayVerification",
    thresholds.replayVerification,
    databaseIterations,
    async () => {
      const diagnostics = await verifyMigration({
        databaseUrl,
        from: sources.from,
        migrationPath,
        to: sources.to,
      });
      assertNoErrors("replayVerification", diagnostics);
    }
  );
}

function benchmarkEndToEndMigration(
  name: string,
  thresholdMs: number,
  databaseUrl: string | undefined,
  sources: { from: string; to: string },
  sql: { from: string; to: string }
): Promise<BenchmarkResult> {
  if (!databaseUrl) {
    return skippedDatabaseBenchmark(thresholdMs);
  }
  return withTemporaryDatabases(databaseUrl, 1, async (targetUrls) => {
    const [targetUrl] = targetUrls;
    if (!targetUrl) {
      throw new Error("expected a temporary target database");
    }
    await applySql(targetUrl, sql.to);
    const target = await extractSourceModel(`database:${targetUrl}`);
    assertNoErrors(`${name}:target`, target.diagnostics);
    return runMeasuredBenchmark(name, thresholdMs, databaseIterations, async () =>
      withTemporaryDatabases(databaseUrl, 1, async (migrationUrls) => {
        const [migrationUrl] = migrationUrls;
        if (!migrationUrl) {
          throw new Error("expected a temporary migration database");
        }
        await applySql(migrationUrl, sql.from);
        const started = performance.now();
        const from = await extractSourceModel(sources.from);
        const to = await extractSourceModel(sources.to);
        assertNoErrors(`${name}:from`, from.diagnostics);
        assertNoErrors(`${name}:to`, to.diagnostics);
        const plan = planSchemaDiff(from, to);
        assertNoErrors(`${name}:plan`, plan.diagnostics);
        await applyMigrationSql(migrationUrl, renderMigration(plan));
        const elapsedMs = performance.now() - started;
        const applied = await extractSourceModel(`database:${migrationUrl}`);
        assertNoErrors(`${name}:applied`, applied.diagnostics);
        if (applied.fingerprint !== target.fingerprint) {
          throw new Error(
            `${name} migrated catalog fingerprint does not match target: migration=${applied.fingerprint} target=${target.fingerprint}`
          );
        }
        return elapsedMs;
      })
    );
  });
}

function benchmarkShadowRoundTripDiff(
  databaseUrl: string | undefined,
  sql: { from: string; to: string }
): Promise<BenchmarkResult> {
  if (!databaseUrl) {
    return skippedDatabaseBenchmark(thresholds.shadowRoundTripDiff);
  }
  return runBenchmark(
    "shadowRoundTripDiff",
    thresholds.shadowRoundTripDiff,
    databaseIterations,
    async () => {
      await withTemporaryDatabases(databaseUrl, 2, async (databaseUrls) => {
        const [fromUrl, toUrl] = databasePair(databaseUrls);
        await applySql(fromUrl, sql.from);
        await applySql(toUrl, sql.to);
        const from = await extractSourceModel(`database:${fromUrl}`);
        const to = await extractSourceModel(`database:${toUrl}`);
        diffModels("shadowRoundTripDiff", from, to);
      });
    }
  );
}

function runBenchmark(
  name: string,
  thresholdMs: number,
  iterations: number,
  action: () => Promise<void>
): Promise<BenchmarkResult> {
  return runMeasuredBenchmark(name, thresholdMs, iterations, async () => {
    const start = performance.now();
    await action();
    return performance.now() - start;
  });
}

async function runMeasuredBenchmark(
  name: string,
  thresholdMs: number,
  iterations: number,
  measure: () => Promise<number>
): Promise<BenchmarkResult> {
  const timings: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    timings.push(await measure());
  }
  const warm = timings.slice(1);
  const maxWarm = Math.max(...(warm.length > 0 ? warm : timings));
  if (maxWarm > thresholdMs) {
    throw new Error(`${name} warm benchmark exceeded ${thresholdMs}ms`);
  }
  return {
    maxWarmMs: Math.round(maxWarm),
    status: "passed",
    thresholdMs,
    timingsMs: timings.map((value) => Math.round(value)),
  };
}

function diffModels(name: string, from: SchemaModel, to: SchemaModel) {
  assertNoErrors(`${name}:from`, from.diagnostics);
  assertNoErrors(`${name}:to`, to.diagnostics);
  const plan = planSchemaDiff(from, to);
  assertNoErrors(`${name}:plan`, plan.diagnostics);
  renderMigration(plan);
  return plan;
}

async function modelFromSql(source: string, sql: string): Promise<SchemaModel> {
  const extracted = await extractObjectsFromSql(sql, {
    config: { managedSchemas: [] },
    file: `${source}.sql`,
  });
  return {
    diagnostics: extracted.diagnostics,
    fingerprint: fingerprintObjects(extracted.objects),
    objects: extracted.objects,
    source,
  };
}

async function writeDumpSources(sql: {
  from: string;
  to: string;
}): Promise<{ from: string; to: string }> {
  const fromPath = join(tempRoot, "from.dump.sql");
  const toPath = join(tempRoot, "to.dump.sql");
  await writeFile(fromPath, sql.from, "utf8");
  await writeFile(toPath, sql.to, "utf8");
  return {
    from: `dump:${fromPath}`,
    to: `dump:${toPath}`,
  };
}

async function writeTreeSources(
  label: string,
  sql: { from: string; to: string }
): Promise<{ from: string; to: string }> {
  const fromDirectory = join(tempRoot, `${label}-from`);
  const toDirectory = join(tempRoot, `${label}-to`);
  await mkdir(fromDirectory, { recursive: true });
  await mkdir(toDirectory, { recursive: true });
  await writeFile(join(fromDirectory, "001_app.sql"), sql.from, "utf8");
  await writeFile(join(toDirectory, "001_app.sql"), sql.to, "utf8");
  return {
    from: `dir:${fromDirectory}`,
    to: `dir:${toDirectory}`,
  };
}

async function writeCatalogSources(sources: {
  from: string;
  to: string;
}): Promise<{ from: string; to: string }> {
  const from = await extractSourceModel(sources.from);
  const to = await extractSourceModel(sources.to);
  const fromPath = join(tempRoot, "from.catalog.json");
  const toPath = join(tempRoot, "to.catalog.json");
  await writeFile(fromPath, `${JSON.stringify(from, null, 2)}\n`, "utf8");
  await writeFile(toPath, `${JSON.stringify(to, null, 2)}\n`, "utf8");
  return {
    from: `catalog:${fromPath}`,
    to: `catalog:${toPath}`,
  };
}

async function readSqlDirectory(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (entry.isFile() && extname(entry.name) === ".sql") {
        files.push(path);
      }
    }
  }
  await walk(root);
  const chunks: string[] = [];
  for (const file of files.sort()) {
    chunks.push(await readFile(file, "utf8"));
  }
  return chunks.join("\n\n");
}

function assertNoErrors(name: string, diagnostics: Diagnostic[]): void {
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`${name} produced diagnostics:\n${formatDiagnostics(errors)}`);
  }
}

function skippedDatabaseBenchmark(thresholdMs: number): Promise<BenchmarkResult> {
  return Promise.resolve({
    reason: "set SUPASCHEMA_BENCHMARK_DATABASE_URL to a disposable PostgreSQL admin URL",
    status: "skipped",
    thresholdMs,
  });
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined ? fallback : Number(raw);
}
