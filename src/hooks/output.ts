import { resolve } from "node:path";
import {
  checkFailureLoopReason,
  diffFailureLoopReason,
  runConfiguredHookCheck,
  runConfiguredHookVerify,
  syncFailureLoopReason,
} from "./checks.js";
import { head, resolveHookBinary, runHookCommand } from "./commands.js";
import { automaticSyncPlan, pathConfirmationMessage, readSchemaPathState } from "./config.js";
import {
  artifactTargetMatches,
  changedSchemaTargets,
  generatedArtifactEditTargets,
  generatedMigrationsIn,
  hookEditTargets,
  hookProjectDir,
  isGeneratedMigration,
  migrationOutputs,
  rel,
} from "./targets.js";

export interface AgentHookOutput {
  decision?: "block";
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: string;
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
  };
  reason?: string;
  systemMessage?: string;
}

export function schemaWriteHookOutput(payload: unknown): AgentHookOutput | undefined {
  const projectDir = hookProjectDir(payload);
  const targets = hookEditTargets(payload, projectDir);
  const pathState = readSchemaPathState(projectDir);
  if (pathState.pathConfirmationNeeded) {
    const pendingRoots = pathState.confirmationSchemaPaths.map((path) => ({
      display: rel(projectDir, path),
      root: path,
    }));
    const pending = changedSchemaTargets(targets, pendingRoots);
    if (pending.changed.length > 0) {
      return postToolUseHookOutput(pathConfirmationMessage(projectDir, pending.changed, pathState));
    }
  }
  const schemaRoots = pathState.schemaPaths.map((path) => ({
    display: rel(projectDir, path),
    root: path,
  }));
  const { changed, groups } = changedSchemaTargets(targets, schemaRoots);
  if (changed.length === 0) {
    return;
  }
  if (pathState.workflow.schema_diff !== "on_schema_write") {
    return postToolUseHookOutput(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(
          ", "
        )} because workflow.schema_diff is "${pathState.workflow.schema_diff}". Run \`supaschema diff\` manually when this schema change should produce a migration.`
    );
  }
  if (pathState.schemaPaths.length > 1) {
    return postToolUseHookOutput(
      `supaschema auto-diff skipped for ${changed
        .map((path) => rel(projectDir, path))
        .join(", ")} because the project has multi-root schemaPaths (${pathState.schemaPaths
        .map((path) => rel(projectDir, path))
        .join(", ")}) and automatic diff would only target the touched root (${groups
        .map((group) => group.display)
        .join(
          ", "
        )}). Run one reviewed \`supaschema diff\` from the intended current state, then run \`supaschema check\`; the hook avoids chaining partial migrations for multi-root configs.`
    );
  }
  const bin = resolveHookBinary(projectDir);
  const autoSync = automaticSyncPlan(pathState);
  if (autoSync.enabled) {
    const sync = runHookCommand(bin, ["sync"], projectDir);
    const diagnostics = head(sync.stderr || sync.stdout);
    const context =
      sync.code === 0
        ? `supaschema auto-sync completed for ${changed
            .map((path) => rel(projectDir, path))
            .join(
              ", "
            )} through \`supaschema sync\`. ${autoSync.line}. The sync pipeline generated the schema diff, selected one target, reconciled migration history, checked pending migrations, refreshed generated contracts, staged the schema closure when Git was available, ran type/RLS safety gates, verified pending migrations, applied the selected target, and reconciled final history.`
        : `supaschema auto-sync for ${changed
            .map((path) => rel(projectDir, path))
            .join(", ")} did not complete (exit ${sync.code}):\n${diagnostics}`;
    if (sync.code !== 0) {
      return postToolUseHookOutput(context, {
        decision: "block",
        reason: syncFailureLoopReason(projectDir, changed, diagnostics),
      });
    }
    return postToolUseHookOutput(context);
  }
  const written: string[] = [];
  for (const group of groups) {
    const diff = runHookCommand(bin, ["diff", "--to", `dir:${group.display}`], projectDir);
    if (diff.code !== 0) {
      const diagnostics = head(diff.stderr || diff.stdout);
      return postToolUseHookOutput(
        `supaschema auto-diff for ${group.changed
          .map((path) => rel(projectDir, path))
          .join(
            ", "
          )} did not complete (exit ${diff.code}):\n${diagnostics}\nResolve per the supaschema skill, for example add the exact object key to hints.destructive for a destructive change, or diff from the post-migration state when the lineage chain is broken, then re-run \`supaschema diff --to dir:${group.display}\`.`,
        {
          decision: "block",
          reason: diffFailureLoopReason(projectDir, group.changed, diagnostics),
        }
      );
    }
    written.push(...migrationOutputs(diff.stdout));
  }
  if (written.length === 0) {
    return postToolUseHookOutput(
      `supaschema: ${changed
        .map((path) => rel(projectDir, path))
        .join(
          ", "
        )} changed but produces no net schema change versus the current state; no migration written.`
    );
  }
  const checkResult = runConfiguredHookCheck(bin, projectDir, pathState.workflow, written);
  const verifyLine = runConfiguredHookVerify(
    bin,
    projectDir,
    pathState.workflow,
    checkResult.passed
  );
  const additionalContext = `supaschema auto-diff completed for ${changed
    .map((path) => rel(projectDir, path))
    .join(", ")}: generated ${written
    .map((path) => rel(projectDir, path))
    .join(
      ", "
    )}. Run \`supaschema sync\` for the full diff/check/types/stage/verify/apply workflow. ${checkResult.line}${
    verifyLine === "" ? "" : `. ${verifyLine}`
  }. Automatic sync skipped: ${autoSync.reason}. Commit the tree change, generated migration, and generated outputs together before a later apply.`;
  if (!checkResult.passed) {
    return postToolUseHookOutput(additionalContext, {
      decision: "block",
      reason: checkFailureLoopReason(projectDir, changed, checkResult),
    });
  }
  return postToolUseHookOutput(additionalContext);
}

export function generatedArtifactEditHookOutput(
  payload: unknown,
  runtime: "claude" | "codex"
): AgentHookOutput | undefined {
  const projectDir = hookProjectDir(payload);
  const pathState = readSchemaPathState(projectDir);
  const generatedMigrations = generatedMigrationsIn(
    pathState.migrationsDir === undefined
      ? undefined
      : resolveProjectPath(projectDir, pathState.migrationsDir)
  );
  const contractArtifacts = [
    { kind: "generated TypeScript contract", path: pathState.typesFile },
    { kind: "generated Zod contract", path: pathState.zodFile },
  ];
  let blocked:
    | {
        artifact: { kind: string; path: string };
        target: { operation: "delete" | "write"; path: string };
      }
    | undefined;
  for (const target of generatedArtifactEditTargets(payload, projectDir)) {
    const contract = contractArtifacts.find((artifact) =>
      artifactTargetMatches(target.path, artifact.path)
    );
    if (contract) {
      blocked = { artifact: contract, target };
      break;
    }
    if (target.operation === "delete" && target.reviewedMigrationDelete === true) {
      continue;
    }
    const migration = isGeneratedMigration(target.path)
      ? target.path
      : generatedMigrations.find((path) => artifactTargetMatches(target.path, path));
    if (migration) {
      blocked = {
        artifact: { kind: "Supaschema-generated migration", path: migration },
        target,
      };
      break;
    }
  }
  if (blocked === undefined) {
    return runtime === "codex" ? {} : undefined;
  }
  const reason =
    `${blocked.artifact.path} is a ${blocked.artifact.kind}. ` +
    "Do not hand-edit generated artifacts. Change the declarative schema or generator config, " +
    "restore migration/source closure with `supaschema doctor`, then run `supaschema sync`; " +
    "run `supaschema types` only when the schema sources already match the intended state. " +
    "Review the generated diff and preserve unexplained drift. " +
    "Run `supaschema explain SUPA_GENERATED_ARTIFACT_EDIT` for the complete recovery procedure.";
  return generatedArtifactBlockOutput(reason, runtime);
}

export function generatedArtifactGuardFailureOutput(runtime: "claude" | "codex"): AgentHookOutput {
  const reason =
    "SUPA_GENERATED_ARTIFACT_GUARD_FAILED: generated-artifact protection could not classify this write. " +
    "The write is denied. Run `supaschema config validate`, repair the config or hook payload, and retry. " +
    "Do not bypass the hook or edit a generated artifact.";
  return generatedArtifactBlockOutput(reason, runtime);
}

function generatedArtifactBlockOutput(
  reason: string,
  runtime: "claude" | "codex"
): AgentHookOutput {
  if (runtime === "codex") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${reason} See .codex/rules/supaschema.rules.`,
      },
    };
  }
  return {
    hookSpecificOutput: {
      additionalContext: `${reason} See .claude/rules/supaschema.md.`,
      hookEventName: "PreToolUse",
    },
    reason: `${reason} See .claude/rules/supaschema.md.`,
  };
}

function resolveProjectPath(projectDir: string, path: string): string {
  return resolve(projectDir, path);
}

function postToolUseHookOutput(
  additionalContext: string,
  control: { decision?: "block"; reason?: string } = {}
): AgentHookOutput {
  const output: AgentHookOutput = {
    hookSpecificOutput: { additionalContext, hookEventName: "PostToolUse" },
  };
  if (control.decision === "block" && typeof control.reason === "string") {
    output.decision = "block";
    output.reason = control.reason;
  }
  return output;
}
