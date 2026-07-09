import type { SupaschemaConfig } from "../core.js";
import { type HookCommand, head, runHookCommand } from "./commands.js";
import { rel } from "./targets.js";

export interface HookCheckResult {
  diagnostics?: string;
  line: string;
  passed: boolean;
}

export function runConfiguredHookCheck(
  bin: HookCommand,
  projectDir: string,
  workflow: SupaschemaConfig["workflow"],
  migrationPaths: string[]
): HookCheckResult {
  if (
    workflow.migration_check !== "after_schema_diff" &&
    workflow.migration_check !== "required_before_complete"
  ) {
    return {
      line: `supaschema check skipped because workflow.migration_check is "${workflow.migration_check}"`,
      passed: true,
    };
  }
  const check = runHookCommand(bin, ["check", ...migrationPaths], projectDir);
  const diagnostics = head(check.stderr || check.stdout);
  const checked = migrationPaths.join(", ");
  return check.code === 0
    ? {
        line:
          migrationPaths.length > 1
            ? `supaschema check passed for generated migrations: ${checked}`
            : `supaschema check passed for generated migration: ${checked}`,
        passed: true,
      }
    : {
        diagnostics,
        line: `supaschema check reported diagnostics:\n${diagnostics}`,
        passed: false,
      };
}

export function runConfiguredHookVerify(
  bin: HookCommand,
  projectDir: string,
  workflow: SupaschemaConfig["workflow"],
  checkPassed: boolean
): string {
  if (workflow.migration_verify !== "after_schema_diff") {
    return "";
  }
  if (!checkPassed) {
    return "supaschema verify skipped because check did not pass";
  }
  const verify = runHookCommand(bin, ["verify"], projectDir);
  return verify.code === 0
    ? "supaschema verify passed"
    : `supaschema verify reported diagnostics:\n${head(verify.stderr || verify.stdout)}`;
}

export function checkFailureLoopReason(
  projectDir: string,
  changed: string[],
  checkResult: HookCheckResult
): string {
  const changedList = changed.map((path) => rel(projectDir, path)).join(", ");
  const diagnostics =
    typeof checkResult.diagnostics === "string" && checkResult.diagnostics.length > 0
      ? `\n\nDiagnostics:\n${checkResult.diagnostics}`
      : "";
  return `supaschema check failed after editing ${changedList}. Continue the agent loop now: inspect the reported SUPA_* diagnostics, identify the canonical root source in the declarative schema tree or generated migration chain, search the migrations directory for similar or correlated failures, fix the canonical source instead of hand-editing generated lineage migrations, regenerate with \`supaschema diff\` when the tree changes, rerun \`supaschema check\`, and keep iterating until check passes or report the exact blocker. Do not apply migrations outside a config-gated \`supaschema sync\` workflow or explicit user request.${diagnostics}`;
}

export function syncFailureLoopReason(
  projectDir: string,
  changed: string[],
  diagnostics: string
): string {
  const changedList = changed.map((path) => rel(projectDir, path)).join(", ");
  const diagnosticText =
    typeof diagnostics === "string" && diagnostics.length > 0
      ? `\n\nDiagnostics:\n${diagnostics}`
      : "";
  return `supaschema sync failed after editing ${changedList}. Continue the agent loop now: inspect the reported SUPA_* diagnostics, fix the canonical schema/config/migration source, rerun \`supaschema sync\`, and keep iterating until the ordered source, diff, target-selection, history, check, generated-contract, schema-closure staging, safety, verify, runner, and reconciliation lanes pass or report the exact blocker.${diagnosticText}`;
}
