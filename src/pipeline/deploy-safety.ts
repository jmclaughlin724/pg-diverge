import type { SupaschemaConfig } from "../config/schema.js";
import type { Diagnostic } from "../core.js";
import { type ScanResult, scanModel } from "../scan/model.js";
import {
  grantPack,
  grantPolicyRule,
  hygienePack,
  policyRequiredColumnsRule,
  type RulePack,
  rlsPack,
  runRulePacks,
} from "../scan/rules.js";
import { extractSourceModel } from "../source/extract.js";
import { defaultTreeSource } from "../source/resolve.js";

interface RlsSafetyGateOptions {
  config: SupaschemaConfig;
  source?: string;
}

export interface DeploySafetyGateResult {
  blocked: boolean;
  blockingDiagnostics: Diagnostic[];
  diagnostics: Diagnostic[];
}

export async function scanSchemaSafety(
  config: SupaschemaConfig,
  from: string | undefined
): Promise<{ result: ScanResult; source: string }> {
  const source = from ?? defaultTreeSource(config);
  const model = await extractSourceModel(source, { config });
  return { result: scanModel(model, scanRulePacks(config)), source };
}

export async function runRlsSafetyGate(
  options: RlsSafetyGateOptions
): Promise<DeploySafetyGateResult> {
  if (options.config.workflow.rls_safety === "disabled") {
    return emptyDeploySafetyGateResult();
  }
  const source = options.source ?? defaultTreeSource(options.config);
  const model = await extractSourceModel(source, { config: options.config });
  const raw = runRulePacks(deploySafetyRulePacks(options.config), { model });
  const adjusted = applyDeploySafetyPolicy(raw, options.config.workflow.rls_safety);
  return gateDeploySafetyDiagnostics([...model.diagnostics, ...adjusted.diagnostics]);
}

export function applyDeploySafetyPolicy(
  diagnostics: Diagnostic[],
  policy: SupaschemaConfig["workflow"]["type_safety"]
): DeploySafetyGateResult {
  if (policy === "disabled") {
    return emptyDeploySafetyGateResult();
  }
  const adjusted = diagnostics.map((item) => {
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
  return gateDeploySafetyDiagnostics(adjusted);
}

export function gateDeploySafetyDiagnostics(diagnostics: Diagnostic[]): DeploySafetyGateResult {
  const blockingDiagnostics = diagnostics.filter((item) => item.severity === "error");
  return {
    blocked: blockingDiagnostics.length > 0,
    blockingDiagnostics,
    diagnostics,
  };
}

export function emptyDeploySafetyGateResult(): DeploySafetyGateResult {
  return { blocked: false, blockingDiagnostics: [], diagnostics: [] };
}

function scanRulePacks(config: SupaschemaConfig): RulePack[] {
  return [grantPack, hygienePack, rlsPack, ...configuredRulePacks(config)];
}

function deploySafetyRulePacks(config: SupaschemaConfig): RulePack[] {
  return [rlsPack, ...configuredRulePacks(config), grantPack];
}

function configuredRulePacks(config: SupaschemaConfig): RulePack[] {
  return [
    {
      id: "rls-required-columns",
      rules: [policyRequiredColumnsRule(config.hints.requiredPolicyColumns)],
      version: "0.1.0",
    },
    {
      id: "role-policy",
      rules: [grantPolicyRule(config.hints.allowedGrantees)],
      version: "0.1.0",
    },
  ];
}
