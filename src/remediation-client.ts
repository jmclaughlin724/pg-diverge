import type { Diagnostic } from "./core.js";
import { remediationCacheKey, remediationPrompt } from "./remediation.js";

export type RemediationTransport = (prompt: string, model: string) => Promise<string>;

export interface RemediationModels {
  capable: string;

  cheap: string;
}

export interface RemediationBudget {
  maxRequests: number;
}

export interface RemediationDraft {
  cached: boolean;
  cacheKey: string;
  fix: string;
  model: string;
}

export function selectRemediationModel(diagnostic: Diagnostic, models: RemediationModels): string {
  return diagnostic.severity === "error" ? models.capable : models.cheap;
}

export interface RemediationDrafter {
  draft: (diagnostic: Diagnostic) => Promise<RemediationDraft | null>;
  requestsUsed: () => number;
}

export function createRemediationDrafter(
  transport: RemediationTransport,
  models: RemediationModels,
  budget: RemediationBudget
): RemediationDrafter {
  const cache = new Map<string, string>();
  let requests = 0;
  return {
    draft: async (diagnostic) => {
      const cacheKey = remediationCacheKey(diagnostic);
      const model = selectRemediationModel(diagnostic, models);
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { cacheKey, cached: true, fix: cached, model };
      }
      if (requests >= budget.maxRequests) {
        return null;
      }
      requests += 1;
      const fix = await transport(remediationPrompt(diagnostic), model);
      cache.set(cacheKey, fix);
      return { cacheKey, cached: false, fix, model };
    },
    requestsUsed: () => requests,
  };
}
