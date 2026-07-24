import type { SupaschemaConfig } from "../config/schema.js";
import { diffTypeContract } from "../contract/type-diff.js";
import { extractSourceModel } from "../source/extract.js";
import { defaultTreeSource } from "../source/resolve.js";
import { collectSchemaShapes } from "../typegen/model.js";
import type { Diagnostic } from "../types.js";
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
    toSource: options.toSource ?? defaultTreeSource(options.config),
  });
  const adjusted = applyDeploySafetyPolicy(
    evaluation.diagnostics,
    options.config.workflow.type_safety
  );
  return gateDeploySafetyDiagnostics([...evaluation.sourceDiagnostics, ...adjusted.diagnostics]);
}
