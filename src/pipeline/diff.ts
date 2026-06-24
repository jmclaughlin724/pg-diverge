import { performance } from "node:perf_hooks";
import type { SupaschemaConfig } from "../config/schema.js";
import type { MigrationPlan, SchemaModel } from "../core.js";
import { readMigrationIntent } from "../migrations/intent.js";
import { planSchemaDiff } from "../planner/schema.js";
import { migrationSafetyPack, runRulePacks } from "../scan/rules.js";
import { extractSourceModel, filterModelBySchemas } from "../source/extract.js";

interface SchemaDiffPlanOptions {
  config: SupaschemaConfig;
  cwd?: string;
  from: string;
  migrationsDir?: string;
  schema?: string;
  timing?: boolean;
  to: string;
}

export async function buildSchemaDiffPlan(options: SchemaDiffPlanOptions): Promise<MigrationPlan> {
  const extractOptions = {
    config: options.config,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
  const migrationIntentOptions = options.cwd === undefined ? {} : { cwd: options.cwd };
  const extractStart = performance.now();
  const from = filterModel(await extractSourceModel(options.from, extractOptions), options.schema);
  const fromMs = performance.now() - extractStart;
  const toStart = performance.now();
  const to = filterModel(await extractSourceModel(options.to, extractOptions), options.schema);
  const migrationIntent = await readMigrationIntent(
    options.migrationsDir ?? options.config.migrationsDir,
    migrationIntentOptions
  );
  const toMs = performance.now() - toStart;
  const planStart = performance.now();
  const plan = planSchemaDiff(from, to, { config: options.config, migrationIntent });

  plan.diagnostics.push(...runRulePacks([migrationSafetyPack], { model: to, plan }));
  if (options.timing) {
    process.stderr.write(
      `timing: extract-from ${Math.round(fromMs)}ms · extract-to ${Math.round(toMs)}ms · plan ${Math.round(performance.now() - planStart)}ms\n`
    );
  }
  return plan;
}

export function filterModel(model: SchemaModel, schemaFilter: string | undefined): SchemaModel {
  if (!schemaFilter) {
    return model;
  }
  const schemas = new Set(
    schemaFilter
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
  return filterModelBySchemas(model, schemas);
}
