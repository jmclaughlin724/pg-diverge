import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkMigrationSql } from "../check/migration.js";
import { resolveConfig } from "../config/schema.js";
import {
  applyMigrationSql,
  applySql,
  assertLocalDatabaseUrl,
  catalogFingerprint,
  createTemporaryDatabases,
  dropTemporaryDatabases,
} from "../database/admin.js";
import { diagnostic, hasErrors } from "../diagnostics/diagnostics.js";
import { planSchemaDiff } from "../planner/schema.js";
import { renderMigrationSplit } from "../render/migration.js";
import { extractSourceModel } from "../source/extract.js";
import type { Diagnostic, SchemaModel, SupaschemaConfig } from "../types.js";

export interface CorpusOptions {
  corpusDir: string;
  databaseUrl: string;
}

export interface CorpusReport {
  appliedMigrations: string[];
  driftOperations: number;
  idempotent: boolean;
  reconvergenceResidual: string[];
  replayParityResidual: string[];
  stages: string[];
}

export async function runCorpus(
  options: CorpusOptions
): Promise<{ diagnostics: Diagnostic[]; report: CorpusReport }> {
  const diagnostics: Diagnostic[] = [];
  const report: CorpusReport = {
    appliedMigrations: [],
    driftOperations: 0,
    idempotent: false,
    reconvergenceResidual: [],
    replayParityResidual: [],
    stages: [],
  };
  const config = await loadCorpusConfig(options.corpusDir);
  assertLocalDatabaseUrl(options.databaseUrl, "SUPASCHEMA_CORPUS_ALLOW_REMOTE");
  const [corpusUrl] = await createTemporaryDatabases(options.databaseUrl, 1, {
    purpose: "corpus",
  });
  if (!corpusUrl) {
    throw new Error("could not create the corpus database");
  }
  try {
    const rolesSql = await readFile(join(options.corpusDir, "roles.sql"), "utf8").catch(
      () => undefined
    );
    if (rolesSql !== undefined) {
      await applySql(corpusUrl, rolesSql);
    }
    const migrationsDir = join(options.corpusDir, "migrations");
    const migrationFiles = (await readdir(migrationsDir))
      .filter(isMigrationFile)
      .sort((left, right) => left.localeCompare(right));
    for (const file of migrationFiles) {
      await applyMigrationSql(corpusUrl, await readFile(join(migrationsDir, file), "utf8"));
      report.appliedMigrations.push(file);
    }
    report.stages.push(`replayed ${migrationFiles.length} corpus migration(s)`);

    const treeSource = `dir:${join(options.corpusDir, "tree")}`;
    const fromModel = await extractSourceModel(`database:${corpusUrl}`, { config });
    const toModel = await extractSourceModel(treeSource, { config });

    diagnostics.push(...(await replayParityDiagnostics(migrationsDir, fromModel, config, report)));
    if (hasErrors(diagnostics)) {
      return { diagnostics, report };
    }

    const plan = planSchemaDiff(fromModel, toModel, { config });
    diagnostics.push(...plan.diagnostics.filter((item) => item.severity === "error"));
    if (hasErrors(diagnostics)) {
      report.stages.push("drift: blocked by diagnostics");
      return { diagnostics, report };
    }
    report.driftOperations = plan.operations.length;
    report.stages.push(`drift: ${plan.operations.length} operation(s) rendered`);
    const rendered = renderMigrationSplit(plan, { config, version: "corpus" });

    const checkDiagnostics = await checkMigrationSql(rendered.sql, { config });
    diagnostics.push(...checkDiagnostics.filter((item) => item.severity === "error"));
    if (hasErrors(diagnostics)) {
      report.stages.push("check: replay-safety errors");
      return { diagnostics, report };
    }
    report.stages.push("check: replay-safe");

    await applyMigrationSql(corpusUrl, rendered.sql);
    if (rendered.concurrentSql !== undefined) {
      await applySql(corpusUrl, rendered.concurrentSql);
    }
    const firstFingerprint = await catalogFingerprint(corpusUrl, "corpus:first-apply", config);
    await applyMigrationSql(corpusUrl, rendered.sql);
    if (rendered.concurrentSql !== undefined) {
      await applySql(corpusUrl, rendered.concurrentSql);
    }
    const secondFingerprint = await catalogFingerprint(corpusUrl, "corpus:second-apply", config);
    report.idempotent = firstFingerprint === secondFingerprint;
    if (!report.idempotent) {
      diagnostics.push(
        diagnostic(
          "SUPA_CORPUS_RECONVERGENCE",
          "error",
          "the second apply changed the catalog; the rendered migration is not idempotent on the corpus state"
        )
      );
    }
    report.stages.push(
      report.idempotent ? "apply-twice: idempotent" : "apply-twice: NOT idempotent"
    );

    const afterModel = await extractSourceModel(`database:${corpusUrl}`, { config });
    const reconvergence = planSchemaDiff(afterModel, toModel, { config });
    report.reconvergenceResidual = reconvergence.operations.map(
      (operation) => `${operation.kind} ${operation.key}`
    );
    if (report.reconvergenceResidual.length > 0) {
      diagnostics.push(
        diagnostic(
          "SUPA_CORPUS_RECONVERGENCE",
          "error",
          `${report.reconvergenceResidual.length} operation(s) remain after applying the reconciliation; the diff does not converge`,
          { hint: `residual: ${report.reconvergenceResidual.slice(0, 6).join(", ")}` }
        )
      );
    }
    report.stages.push(
      `reconvergence: ${report.reconvergenceResidual.length} residual operation(s)`
    );
    return { diagnostics, report };
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "SUPA_CORPUS_RECONVERGENCE",
        "error",
        `corpus pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
        { hint: "A replay or reconciliation apply failed against the corpus database." }
      )
    );
    report.stages.push("pipeline: failed");
    return { diagnostics, report };
  } finally {
    await dropTemporaryDatabases(options.databaseUrl, [corpusUrl]);
  }
}

async function replayParityDiagnostics(
  migrationsDir: string,
  databaseModel: SchemaModel,
  config: SupaschemaConfig,
  report: CorpusReport
): Promise<Diagnostic[]> {
  const replayModel = await extractSourceModel(`migrations:${migrationsDir}`, { config });
  const replayErrors = replayModel.diagnostics.filter((item) => item.severity === "error");
  if (replayErrors.length > 0) {
    report.stages.push("replay parity: replay failed");
    return replayErrors;
  }
  const databaseKeys = new Set(databaseModel.objects.map((object) => object.key));
  const replayKeys = new Set(replayModel.objects.map((object) => object.key));
  const byKey = (left: string, right: string): number => left.localeCompare(right);
  const replayOnly = [...replayKeys].filter((key) => !databaseKeys.has(key)).sort(byKey);
  const databaseOnly = [...databaseKeys].filter((key) => !replayKeys.has(key)).sort(byKey);
  report.replayParityResidual = [
    ...replayOnly.map((key) => `replay-only ${key}`),
    ...databaseOnly.map((key) => `database-only ${key}`),
  ];
  if (report.replayParityResidual.length === 0) {
    report.stages.push("replay parity: replay model matches the applied catalog");
    return [];
  }
  report.stages.push(`replay parity: ${report.replayParityResidual.length} divergent object(s)`);
  return [
    diagnostic(
      "SUPA_CORPUS_REPLAY_PARITY",
      "error",
      `${report.replayParityResidual.length} object(s) differ between the migration replay model and the catalog those migrations produced`,
      {
        hint: `divergent: ${report.replayParityResidual.slice(0, 6).join(", ")}`,
      }
    ),
  ];
}

function isMigrationFile(name: string): boolean {
  return name.endsWith(".sql") && migrationFileVersion(name) !== undefined;
}

function migrationFileVersion(name: string): string | undefined {
  let index = 0;
  while (index < name.length && isDigit(name[index] ?? "")) {
    index += 1;
  }
  return index >= 8 ? name.slice(0, index) : undefined;
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export function renderCorpusReport(report: CorpusReport): string {
  const lines = [
    `corpus: ${report.appliedMigrations.length} migration(s) replayed, drift ${report.driftOperations} op(s)`,
    ...report.stages.map((stage) => `  ${stage}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function loadCorpusConfig(corpusDir: string): Promise<SupaschemaConfig> {
  const raw = await readFile(join(corpusDir, "corpus.json"), "utf8");
  return resolveConfig(JSON.parse(raw));
}
