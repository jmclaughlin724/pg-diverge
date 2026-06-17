import type { Diagnostic } from "./core.js";
import { remediationCacheKey, remediationPrompt } from "./remediation.js";

/**
 * Remediation drafting client (plan `20-hands-off-stack.md`, task M33): caching,
 * severity-based model routing, and a hard request budget (cost cap). The LLM call
 * is an injected `RemediationTransport`, so the orchestration is fully testable
 * without a key or network; production supplies a transport that reads the API key
 * from env and calls the model. Prompt construction stays in `remediation.ts`.
 */

export type RemediationTransport = (prompt: string, model: string) => Promise<string>;

export interface RemediationModels {
  /** Higher-capability model for `error`-severity findings. */
  capable: string;
  /** Cheaper model for warnings/info. */
  cheap: string;
}

export interface RemediationBudget {
  /** Maximum number of transport (LLM) calls; caching does not count against it. */
  maxRequests: number;
}

export interface RemediationDraft {
  cached: boolean;
  cacheKey: string;
  fix: string;
  model: string;
}

/** Route by severity: errors get the capable model, everything else the cheap one. */
export function selectRemediationModel(diagnostic: Diagnostic, models: RemediationModels): string {
  return diagnostic.severity === "error" ? models.capable : models.cheap;
}

export interface RemediationDrafter {
  draft: (diagnostic: Diagnostic) => Promise<RemediationDraft | null>;
  requestsUsed: () => number;
}

/**
 * Build a drafter over an injected transport. Returns `null` once the request
 * budget is exhausted (so a noisy scan can't run up unbounded LLM spend); identical
 * findings reuse one cached draft and never re-spend.
 */
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
