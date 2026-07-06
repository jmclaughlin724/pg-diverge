import type { SupaschemaConfig } from "../config/schema.js";
import { diffTypeContract } from "../contract/type-diff.js";
import type { Diagnostic } from "../core.js";
import { extractSourceModel } from "../source/extract.js";
import { migrationsTypegenOnlyDiagnostic } from "../source/policy.js";
import { collectSchemaShapes } from "../typegen/model.js";
import {
  applyDeploySafetyPolicy,
  type DeploySafetyGateResult,
  emptyDeploySafetyGateResult,
  gateDeploySafetyDiagnostics,
} from "./deploy-safety.js";

export interface TypeContractEvaluation {
  afterDiagnostics: Diagnostic[];
  beforeDiagnostics: Diagnostic[];
  diagnostics: Diagnostic[];
  sourceDiagnostics: Diagnostic[];
}

interface TypeSafetyGateOptions {
  config: SupaschemaConfig;
  fromSource?: string;
  toSource?: string;
}

export async function evaluateTypeContract(options: {
  config: SupaschemaConfig;
  fromSource: string;
  toSource: string;
}): Promise<TypeContractEvaluation> {
  const beforePolicyDiagnostic = migrationsTypegenOnlyDiagnostic(
    "type-contract drift",
    "from",
    options.fromSource
  );
  const afterPolicyDiagnostic = migrationsTypegenOnlyDiagnostic(
    "type-contract drift",
    "to",
    options.toSource
  );
  if (beforePolicyDiagnostic !== undefined || afterPolicyDiagnostic !== undefined) {
    const beforeDiagnostics = beforePolicyDiagnostic === undefined ? [] : [beforePolicyDiagnostic];
    const afterDiagnostics = afterPolicyDiagnostic === undefined ? [] : [afterPolicyDiagnostic];
    return {
      afterDiagnostics,
      beforeDiagnostics,
      diagnostics: [],
      sourceDiagnostics: [...beforeDiagnostics, ...afterDiagnostics],
    };
  }
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
    return emptyDeploySafetyGateResult();
  }
  const evaluation = await evaluateTypeContract({
    config: options.config,
    fromSource: options.fromSource ?? options.config.sources.from,
    toSource: options.toSource ?? options.config.sources.to,
  });
  const adjusted = applyDeploySafetyPolicy(
    evaluation.diagnostics,
    options.config.workflow.type_safety
  );
  return gateDeploySafetyDiagnostics([...evaluation.sourceDiagnostics, ...adjusted.diagnostics]);
}
