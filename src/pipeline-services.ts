import type { FileHandle } from "node:fs/promises";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { SupaschemaConfig } from "./config.js";
import type { Diagnostic, MigrationPlan, SchemaModel } from "./core.js";
import { hasErrors } from "./diagnostics.js";
import { planSchemaDiff } from "./planner.js";
import {
  grantPack,
  grantPolicyRule,
  hygienePack,
  migrationSafetyPack,
  type RulePack,
  rlsPack,
  runRulePacks,
} from "./rules.js";
import { type ScanResult, scanModel } from "./scan.js";
import { extractSourceModel, filterModelBySchemas } from "./source.js";
import { diffTypeContract } from "./type-contract.js";
import { generateDatabaseTypes } from "./typegen.js";
import type { SchemaShapes } from "./typegen-model.js";
import { collectSchemaShapes } from "./typegen-model.js";
import { generateZodSchemas } from "./typegen-zod.js";

export const deployBlockingRlsDiagnosticCodes: string[] = [
  "SUPA_RULE_RLS_NO_POLICY",
  "SUPA_RULE_POLICY_NO_RLS",
  "SUPA_RULE_GRANT_TO_PUBLIC",
  "SUPA_RULE_GRANT_ALL_PRIVILEGES",
  "SUPA_RULE_GRANT_UNDECLARED_ROLE",
];

const deployBlockingRlsCodeSet = new Set<string>(deployBlockingRlsDiagnosticCodes);

interface SchemaDiffPlanOptions {
  config: SupaschemaConfig;
  from: string;
  schema?: string;
  timing?: boolean;
  to: string;
}

export interface TypeContractEvaluation {
  afterDiagnostics: Diagnostic[];
  beforeDiagnostics: Diagnostic[];
  diagnostics: Diagnostic[];
  sourceDiagnostics: Diagnostic[];
}

export interface DeploySafetyGateResult {
  blocked: boolean;
  blockingDiagnostics: Diagnostic[];
  diagnostics: Diagnostic[];
}

interface TypeSafetyGateOptions {
  config: SupaschemaConfig;
  fromSource?: string;
  toSource?: string;
}

interface RlsSafetyGateOptions {
  config: SupaschemaConfig;
  source?: string;
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

export async function refreshGeneratedOutputs(options: {
  config: SupaschemaConfig;
  schemaFilter?: string;
  toSource: string;
}): Promise<void> {
  const targets: {
    generate: (shapes: SchemaShapes) => string;
    policy: SupaschemaConfig["workflow"]["type_generation"];
    relative: string;
  }[] = [
    {
      generate: generateDatabaseTypes,
      policy: options.config.workflow.type_generation,
      relative: options.config.typesFile,
    },
    {
      generate: generateZodSchemas,
      policy: options.config.workflow.zod_generation,
      relative: options.config.zodFile,
    },
  ];
  let model: SchemaModel | undefined;
  let shapes: SchemaShapes | undefined;
  let shapesComputed = false;
  for (const target of targets) {
    if (target.policy === "disabled") {
      continue;
    }
    try {
      if (target.policy === "refresh_existing") {
        await refreshExistingGeneratedOutput(target, getShapes);
      } else {
        await createOrRefreshGeneratedOutput(target, getShapes);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  async function getModel(): Promise<SchemaModel | undefined> {
    model =
      model ??
      filterModel(
        await extractSourceModel(options.toSource, { config: options.config }),
        options.schemaFilter
      );
    return hasErrors(model.diagnostics) ? undefined : model;
  }

  async function getShapes(): Promise<SchemaShapes | undefined> {
    if (shapesComputed) {
      return shapes;
    }
    shapesComputed = true;
    const resolved = await getModel();
    shapes = resolved === undefined ? undefined : await collectSchemaShapes(resolved);
    return shapes;
  }
}

export async function evaluateTypeContract(options: {
  config: SupaschemaConfig;
  fromSource: string;
  toSource: string;
}): Promise<TypeContractEvaluation> {
  const [beforeModel, afterModel] = await Promise.all([
    extractSourceModel(options.fromSource, { config: options.config }),
    extractSourceModel(options.toSource, { config: options.config }),
  ]);
  const [before, after] = await Promise.all([
    collectSchemaShapes(beforeModel),
    collectSchemaShapes(afterModel),
  ]);
  const beforeDiagnostics = beforeModel.diagnostics;
  const afterDiagnostics = afterModel.diagnostics;
  return {
    afterDiagnostics,
    beforeDiagnostics,
    diagnostics: diffTypeContract(before, after),
    sourceDiagnostics: [...beforeDiagnostics, ...afterDiagnostics],
  };
}

export async function runTypeSafetyGate(
  options: TypeSafetyGateOptions
): Promise<DeploySafetyGateResult> {
  if (options.config.workflow.type_safety === "disabled") {
    return emptyGateResult();
  }
  const evaluation = await evaluateTypeContract({
    config: options.config,
    fromSource: options.fromSource ?? options.config.sources.from,
    toSource: options.toSource ?? options.config.sources.to,
  });
  const adjusted = applyDeploySafetyPolicy(
    evaluation.diagnostics,
    options.config.workflow.type_safety,
    (item) => item.code.startsWith("SUPA_TYPE_")
  );
  return gateResult([...evaluation.sourceDiagnostics, ...adjusted.diagnostics]);
}

export async function scanSchemaSafety(
  config: SupaschemaConfig,
  from: string | undefined
): Promise<{ result: ScanResult; source: string }> {
  const source = from ?? config.sources.to;
  const model = await extractSourceModel(source, { config });
  const rolePolicyPack: RulePack = {
    id: "role-policy",
    rules: [grantPolicyRule(config.hints.allowedGrantees)],
    version: "0.1.0",
  };
  return {
    result: scanModel(model, [grantPack, hygienePack, rlsPack, rolePolicyPack]),
    source,
  };
}

export async function runRlsSafetyGate(
  options: RlsSafetyGateOptions
): Promise<DeploySafetyGateResult> {
  if (options.config.workflow.rls_safety === "disabled") {
    return emptyGateResult();
  }
  const source = options.source ?? options.config.sources.to;
  const model = await extractSourceModel(source, { config: options.config });
  const rolePolicyPack: RulePack = {
    id: "role-policy",
    rules: [grantPolicyRule(options.config.hints.allowedGrantees)],
    version: "0.1.0",
  };
  const raw = scanModel(model, [rlsPack, grantPack, rolePolicyPack]).diagnostics;
  const adjusted = applyDeploySafetyPolicy(raw, options.config.workflow.rls_safety, (item) =>
    deployBlockingRlsCodeSet.has(item.code)
  );
  return gateResult(adjusted.diagnostics);
}

export function applyDeploySafetyPolicy(
  diagnostics: Diagnostic[],
  policy: SupaschemaConfig["workflow"]["type_safety"],
  isBlockable: (diagnostic: Diagnostic) => boolean
): DeploySafetyGateResult {
  if (policy === "disabled") {
    return emptyGateResult();
  }
  const adjusted = diagnostics.map((item) => {
    if (!isBlockable(item)) {
      return item;
    }
    if (policy === "report_only" && item.severity === "error") {
      const diagnostic: Diagnostic = { ...item, severity: "warning" };
      return diagnostic;
    }
    if (policy === "deploy_blocking" && item.severity !== "error") {
      const diagnostic: Diagnostic = { ...item, severity: "error" };
      return diagnostic;
    }
    return item;
  });
  return gateResult(adjusted);
}

async function refreshExistingGeneratedOutput(
  target: {
    generate: (shapes: SchemaShapes) => string;
    relative: string;
  },
  getShapes: () => Promise<SchemaShapes | undefined>
): Promise<void> {
  let handle: FileHandle;
  handle = await open(resolve(process.cwd(), target.relative), "r+");
  try {
    const shapes = await getShapes();
    if (shapes === undefined) {
      return;
    }
    const generated = target.generate(shapes);
    await handle.truncate(0);
    await handle.write(generated, 0);
    process.stderr.write(`types: ${target.relative} refreshed from configured workflow\n`);
  } finally {
    await handle.close();
  }
}

async function createOrRefreshGeneratedOutput(
  target: {
    generate: (shapes: SchemaShapes) => string;
    relative: string;
  },
  getShapes: () => Promise<SchemaShapes | undefined>
): Promise<void> {
  const shapes = await getShapes();
  if (shapes === undefined) {
    return;
  }
  const outPath = resolve(process.cwd(), target.relative);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, target.generate(shapes));
  process.stderr.write(`types: ${target.relative} created or refreshed from configured workflow\n`);
}

function gateResult(diagnostics: Diagnostic[]): DeploySafetyGateResult {
  const blockingDiagnostics = diagnostics.filter((item) => item.severity === "error");
  return {
    blocked: blockingDiagnostics.length > 0,
    blockingDiagnostics,
    diagnostics,
  };
}

function emptyGateResult(): DeploySafetyGateResult {
  return { blocked: false, blockingDiagnostics: [], diagnostics: [] };
}
