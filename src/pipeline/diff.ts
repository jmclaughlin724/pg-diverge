import { performance } from "node:perf_hooks";
import type { SupaschemaConfig } from "../config/schema.js";
import type { MigrationPlan, SchemaModel } from "../core.js";
import { planSchemaDiff } from "../planner/schema.js";
import { migrationSafetyPack, runRulePacks } from "../scan/rules.js";
import { extractSourceModel, filterModelBySchemas } from "../source/extract.js";

interface SchemaDiffPlanOptions {
  config: SupaschemaConfig;
  from: string;
  schema?: string;
  timing?: boolean;
  to: string;
}

export async function buildSchemaDiffPlan(options: SchemaDiffPlanOptions): Promise<MigrationPlan> {
  const extractStart = performance.now();
  const from = filterModel(
    await extractSourceModel(options.from, { config: options.config }),
    options.schema
  );
  const fromMs = performance.now() - extractStart;
  const toStart = performance.now();
  const to = filterModel(
    await extractSourceModel(options.to, { config: options.config }),
    options.schema
  );
  const toMs = performance.now() - toStart;
  const planStart = performance.now();
  const plan = planSchemaDiff(from, to, { config: options.config });

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
